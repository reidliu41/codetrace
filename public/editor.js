const params = new URLSearchParams(window.location.search);
const state = {
  projectId: params.get("projectId") || "",
  fileId: Number(params.get("fileId") || 0),
  line: Number(params.get("line") || 0),
  file: null,
  content: "",
  contentHash: "",
  editing: false,
  query: "",
  hits: [],
  hitIndex: -1,
};

const els = {
  title: document.getElementById("editorTitle"),
  meta: document.getElementById("editorMeta"),
  search: document.getElementById("editorSearchInput"),
  prev: document.getElementById("editorPrevButton"),
  next: document.getElementById("editorNextButton"),
  reload: document.getElementById("editorReloadButton"),
  edit: document.getElementById("editorEditButton"),
  save: document.getElementById("editorSaveButton"),
  cancel: document.getElementById("editorCancelButton"),
  view: document.getElementById("editorCodeTraceView"),
  editor: document.getElementById("editorCodeEditor"),
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed with ${response.status}`);
  }
  return payload;
}

function apiUrl(path, values) {
  const url = new URL(path, window.location.origin);
  for (const [key, value] of Object.entries(values || {})) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  }
  return `${url.pathname}${url.search}`;
}

async function loadFile() {
  const payload = await fetchJson(apiUrl("/api/file", { projectId: state.projectId, fileId: state.fileId }));
  state.file = payload.file;
  state.content = payload.content;
  state.contentHash = payload.contentHash;
  state.editing = false;
  recomputeHits();
  render();
}

function render() {
  if (!state.file) {
    return;
  }
  els.title.textContent = state.file.relativePath;
  els.meta.textContent = `${state.file.moduleName} - ${state.file.lineCount} lines`;
  document.title = `${state.file.relativePath} - CodeTrace`;
  els.editor.value = state.content;
  els.view.innerHTML = `<code>${state.content
    .split(/\r?\n/)
    .map((line, index) => renderLine(line, index + 1))
    .join("")}</code>`;
  syncMode();
  const targetLine = state.hits[state.hitIndex] || state.line;
  if (targetLine) {
    setTimeout(() => scrollToLine(targetLine), 0);
  }
}

function renderLine(line, lineNumber) {
  const classes = ["code-line"];
  if (lineNumber === state.line) {
    classes.push("highlight");
  }
  if (state.hits.includes(lineNumber)) {
    classes.push("search-hit");
  }
  if (state.hits[state.hitIndex] === lineNumber) {
    classes.push("current-hit");
  }
  return `<span class="${classes.join(" ")}" id="line-${lineNumber}"><span class="line-no">${lineNumber}</span><span class="line-text">${highlightPythonLine(line) || " "}</span></span>`;
}

function highlightPythonLine(line) {
  const tokenPattern =
    /(#.*$)|([rRuUbBfF]{0,3}(?:"""[^"]*"""|'''[^']*'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'))|(@[A-Za-z_][\w.]*)|\b(False|None|True|and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield)\b|\b(self|cls)\b|\b(\d+(?:\.\d+)?)\b/g;
  let output = "";
  let cursor = 0;
  let match;
  while ((match = tokenPattern.exec(line)) !== null) {
    output += escapeHtml(line.slice(cursor, match.index));
    const value = match[0];
    const kind = match[1]
      ? "comment"
      : match[2]
        ? "string"
        : match[3]
          ? "decorator"
          : match[4]
            ? "keyword"
            : match[5]
              ? "self"
              : match[6]
                ? "number"
                : "";
    output += kind ? `<span class="syntax-${kind}">${escapeHtml(value)}</span>` : escapeHtml(value);
    cursor = match.index + value.length;
  }
  output += escapeHtml(line.slice(cursor));
  return output;
}

function syncMode() {
  els.view.classList.toggle("hidden", state.editing);
  els.editor.classList.toggle("hidden", !state.editing);
  els.edit.classList.toggle("hidden", state.editing);
  els.save.classList.toggle("hidden", !state.editing);
  els.cancel.classList.toggle("hidden", !state.editing);
}

function recomputeHits() {
  state.query = els.search.value.trim();
  state.hits = [];
  state.hitIndex = -1;
  if (!state.query) {
    return;
  }
  const lower = state.query.toLowerCase();
  state.content.split(/\r?\n/).forEach((line, index) => {
    if (line.toLowerCase().includes(lower)) {
      state.hits.push(index + 1);
    }
  });
  if (state.hits.length) {
    state.hitIndex = 0;
  }
}

function moveHit(direction) {
  if (!state.hits.length) {
    recomputeHits();
  }
  if (!state.hits.length) {
    render();
    return;
  }
  state.hitIndex = (state.hitIndex + direction + state.hits.length) % state.hits.length;
  render();
}

function scrollToLine(lineNumber) {
  const line = document.getElementById(`line-${lineNumber}`);
  if (line) {
    line.scrollIntoView({ block: "center" });
  }
}

async function saveFile() {
  const content = els.editor.value;
  const payload = await fetchJson("/api/file", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: state.projectId,
      fileId: state.fileId,
      content,
      contentHash: state.contentHash,
    }),
  });
  state.content = content;
  state.contentHash = payload.contentHash;
  state.file = payload.file;
  state.editing = false;
  recomputeHits();
  render();
}

function bind() {
  els.reload.addEventListener("click", () => loadFile().catch(showError));
  els.edit.addEventListener("click", () => {
    state.editing = true;
    render();
    els.editor.focus();
  });
  els.cancel.addEventListener("click", () => {
    state.editing = false;
    render();
  });
  els.save.addEventListener("click", () => saveFile().catch(showError));
  els.search.addEventListener("input", () => {
    recomputeHits();
    render();
  });
  els.search.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      moveHit(event.shiftKey ? -1 : 1);
    }
  });
  els.prev.addEventListener("click", () => moveHit(-1));
  els.next.addEventListener("click", () => moveHit(1));
}

function showError(error) {
  els.meta.textContent = error.message || String(error);
}

bind();
loadFile().catch(showError);
