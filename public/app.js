const state = {
  projects: [],
  project: null,
  mode: "trace",
  graph: { nodes: [], edges: [] },
  expandedDirs: new Set(["."]),
  selectedSymbolId: null,
  selectedFileId: null,
  selectedRange: null,
  currentFile: null,
  currentContent: "",
  currentContentHash: "",
  currentSymbols: [],
  codeSearchQuery: "",
  codeSearchHits: [],
  codeSearchIndex: -1,
  graphSearchQuery: "",
  graphSearchMatches: [],
  graphSearchIndex: -1,
  traceEvents: [],
  traceEventSeq: 0,
  activeTraceNodeId: "",
  traceFilters: {
    repoOnly: true,
    calls: true,
    lines: false,
    imports: true,
    returns: true,
    output: true,
    exceptions: true,
  },
  stepReplay: false,
  traceReplayIndex: -1,
  traceRunning: false,
  traceEventSource: null,
  traceRenderTimer: null,
  editing: false,
  indexing: false,
  graphZoom: 1,
  nodePositions: new Map(),
  renderedPositions: new Map(),
  nodeSizes: new Map(),
  graphNodeById: new Map(),
  dragging: null,
  pendingGraphClick: null,
  canvasPan: null,
  drawerDrag: null,
  drawerResize: null,
  terminalEvents: null,
  terminal: null,
  terminalFitAddon: null,
  terminalResizeObserver: null,
  terminalResize: null,
  terminalInputBuffer: "",
  shellCaptureActive: false,
  shellTraceJsonMode: false,
  shellTraceLineBuffer: "",
  shellTraceReceived: 0,
  shellEventId: 0,
  projectMenuOpenId: "",
  fileTreeExpanded: new Set([""]),
  browsePath: "",
  browseHome: "",
};

const STORAGE_KEYS = {
  stepReplay: "codetrace.stepReplay",
  traceFilters: "codetrace.traceFilters",
};

const els = {
  pathForm: document.getElementById("pathForm"),
  workspace: document.getElementById("workspace"),
  graphPane: document.getElementById("graphPane"),
  rootPathInput: document.getElementById("rootPathInput"),
  addProjectButton: document.getElementById("addProjectButton"),
  sidebarToggleButton: document.getElementById("sidebarToggleButton"),
  indexButton: document.getElementById("indexButton"),
  statusPill: document.getElementById("statusPill"),
  projectSubtitle: document.getElementById("projectSubtitle"),
  projectCount: document.getElementById("projectCount"),
  projectList: document.getElementById("projectList"),
  recentList: document.getElementById("recentList"),
  searchInput: document.getElementById("searchInput"),
  resultList: document.getElementById("resultList"),
  fileList: document.getElementById("fileList"),
  fileTree: document.getElementById("fileTree"),
  symbolCount: document.getElementById("symbolCount"),
  fileCount: document.getElementById("fileCount"),
  graphTitle: document.getElementById("graphTitle"),
  graphMeta: document.getElementById("graphMeta"),
  graphLegend: document.getElementById("graphLegend"),
  graphFrame: document.querySelector(".graph-frame"),
  graphSvg: document.getElementById("graphSvg"),
  modeTabs: document.getElementById("modeTabs"),
  overviewButton: document.getElementById("overviewButton"),
  zoomOutButton: document.getElementById("zoomOutButton"),
  zoomInButton: document.getElementById("zoomInButton"),
  zoomResetButton: document.getElementById("zoomResetButton"),
  zoomValue: document.getElementById("zoomValue"),
  graphSearchInput: document.getElementById("graphSearchInput"),
  graphSearchPrevButton: document.getElementById("graphSearchPrevButton"),
  graphSearchNextButton: document.getElementById("graphSearchNextButton"),
  graphSearchMeta: document.getElementById("graphSearchMeta"),
  traceForm: document.getElementById("traceForm"),
  traceFilterRow: document.getElementById("traceFilterRow"),
  traceFilterMeta: document.getElementById("traceFilterMeta"),
  tracePositionRow: document.getElementById("tracePositionRow"),
  tracePositionSlider: document.getElementById("tracePositionSlider"),
  tracePositionInput: document.getElementById("tracePositionInput"),
  tracePositionMeta: document.getElementById("tracePositionMeta"),
  traceDetail: document.getElementById("traceDetail"),
  filterRepoOnlyInput: document.getElementById("filterRepoOnlyInput"),
  filterCallsInput: document.getElementById("filterCallsInput"),
  filterLinesInput: document.getElementById("filterLinesInput"),
  filterImportsInput: document.getElementById("filterImportsInput"),
  filterReturnsInput: document.getElementById("filterReturnsInput"),
  filterOutputInput: document.getElementById("filterOutputInput"),
  filterExceptionsInput: document.getElementById("filterExceptionsInput"),
  traceCommandInput: document.getElementById("traceCommandInput"),
  traceCommandClearButton: document.getElementById("traceCommandClearButton"),
  traceRunButton: document.getElementById("traceRunButton"),
  traceStepReplayInput: document.getElementById("traceStepReplayInput"),
  tracePrevButton: document.getElementById("tracePrevButton"),
  traceNextButton: document.getElementById("traceNextButton"),
  traceStopButton: document.getElementById("traceStopButton"),
  traceMeta: document.getElementById("traceMeta"),
  editorDrawer: document.getElementById("editorDrawer"),
  editorDragHandle: document.getElementById("editorDragHandle"),
  editorResizeHandle: document.getElementById("editorResizeHandle"),
  editorCloseButton: document.getElementById("editorCloseButton"),
  editorPopoutButton: document.getElementById("editorPopoutButton"),
  codeTitle: document.getElementById("codeTitle"),
  codeMeta: document.getElementById("codeMeta"),
  codeView: document.getElementById("codeView"),
  codeEditor: document.getElementById("codeEditor"),
  codeSearchInput: document.getElementById("codeSearchInput"),
  codeSearchPrevButton: document.getElementById("codeSearchPrevButton"),
  codeSearchNextButton: document.getElementById("codeSearchNextButton"),
  editButton: document.getElementById("editButton"),
  saveButton: document.getElementById("saveButton"),
  cancelButton: document.getElementById("cancelButton"),
  outline: document.getElementById("outline"),
  inspector: document.getElementById("inspector"),
  inspectorResizeHandle: document.getElementById("inspectorResizeHandle"),
  terminalOutput: document.getElementById("terminalOutput"),
  terminalToggleButton: document.getElementById("terminalToggleButton"),
  terminalCloseButton: document.getElementById("terminalCloseButton"),
  terminalStartButton: document.getElementById("terminalStartButton"),
  terminalClearButton: document.getElementById("terminalClearButton"),
  browseModal: document.getElementById("browseModal"),
  browseBackdrop: document.getElementById("browseBackdrop"),
  browseCloseButton: document.getElementById("browseCloseButton"),
  browseHomeButton: document.getElementById("browseHomeButton"),
  browseUpButton: document.getElementById("browseUpButton"),
  browsePathInput: document.getElementById("browsePathInput"),
  browseGoButton: document.getElementById("browseGoButton"),
  browseUseButton: document.getElementById("browseUseButton"),
  browseIndexButton: document.getElementById("browseIndexButton"),
  browseEntries: document.getElementById("browseEntries"),
  browseMeta: document.getElementById("browseMeta"),
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function compactPath(value) {
  if (!value) {
    return "";
  }
  const home = window.CODETRACE_HOME || "";
  if (home && value.startsWith(home)) {
    return `~${value.slice(home.length)}`;
  }
  return value;
}

function truncate(value, max = 44) {
  const text = String(value || "");
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 1)}...`;
}

function badge(kind, external = false) {
  const label = external ? "external" : kind || "symbol";
  return `<span class="kind ${escapeHtml(label)}">${escapeHtml(label)}</span>`;
}

function apiUrl(path, params = {}) {
  const url = new URL(path, window.location.origin);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "") {
      url.searchParams.set(key, value);
    }
  }
  return `${url.pathname}${url.search}`;
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed with ${response.status}`);
  }
  return payload;
}

function setStatus(text, mode = "") {
  els.statusPill.textContent = text;
  els.statusPill.className = `status-pill ${mode}`.trim();
}

function setIndexing(enabled) {
  state.indexing = enabled;
  els.indexButton.disabled = enabled;
  els.indexButton.textContent = enabled ? "Indexing" : "Index";
}

function projectId() {
  return state.project?.id || "";
}

function setMode(mode) {
  state.mode = "trace";
  if (els.modeTabs) {
    for (const button of els.modeTabs.querySelectorAll("button")) {
      button.classList.toggle("active", button.dataset.mode === "trace");
    }
  }
  els.traceForm.classList.remove("hidden");
  els.traceFilterRow.classList.remove("hidden");
  els.tracePositionRow.classList.remove("hidden");
  renderLegend();
}

function legendItem(kind, label) {
  return `<span><i class="legend-swatch" style="background:${colorForKind(kind)}"></i>${escapeHtml(label)}</span>`;
}

function renderLegend() {
  els.graphLegend.innerHTML = [
    legendItem("trace-start", "Start"),
    legendItem("trace-import", "Import"),
    legendItem("trace-call", "Call"),
    legendItem("trace-line", "Line"),
    legendItem("trace-return", "Return"),
    legendItem("trace-output", "Output"),
    legendItem("trace-exception", "Exception"),
    legendItem("trace-fatal", "Fatal"),
  ].join("");
}

function clearSelection() {
  state.selectedSymbolId = null;
  state.selectedFileId = null;
  state.selectedRange = null;
}

function renderProjectList() {
  els.projectCount.textContent = `${state.projects.length} loaded`;
  if (!state.projects.length) {
    els.projectList.innerHTML = `<div class="empty-state">No loaded projects</div>`;
    return;
  }

  els.projectList.innerHTML = state.projects
    .map(
      (project) => `
        <div class="project-item-wrap ${project.id === projectId() ? "active" : ""}" data-id="${project.id}">
          <button class="project-item" data-id="${project.id}">
            <span class="item-main">${escapeHtml(project.name || "Project")}</span>
            <span class="item-sub">${escapeHtml(compactPath(project.rootPath))}</span>
          </button>
          <button class="project-menu-button" data-id="${project.id}" type="button" title="Project actions">...</button>
          ${
            state.projectMenuOpenId === project.id
              ? `<div class="project-menu" data-id="${project.id}">
                  <button data-action="rename" type="button">Rename</button>
                  <button data-action="remove" type="button">Remove</button>
                </div>`
              : ""
          }
        </div>
      `,
    )
    .join("");

  for (const button of els.projectList.querySelectorAll(".project-item")) {
    button.addEventListener("click", () => switchProject(button.dataset.id));
  }
  for (const button of els.projectList.querySelectorAll(".project-menu-button")) {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      state.projectMenuOpenId = state.projectMenuOpenId === button.dataset.id ? "" : button.dataset.id;
      renderProjectList();
    });
  }
  for (const menuButton of els.projectList.querySelectorAll(".project-menu button")) {
    menuButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const wrapper = menuButton.closest(".project-item-wrap");
      const id = wrapper?.dataset.id || "";
      state.projectMenuOpenId = "";
      if (menuButton.dataset.action === "rename") {
        renameProject(id).catch(showError);
      } else if (menuButton.dataset.action === "remove") {
        removeProject(id).catch(showError);
      }
    });
  }
}

function renderRecent(projects = []) {
  if (!projects.length) {
    els.recentList.innerHTML = `<div class="empty-state">No recent projects</div>`;
    return;
  }

  els.recentList.innerHTML = projects
    .map(
      (project) => `
        <button class="recent-item" data-path="${escapeHtml(project)}">
          <span class="item-main">${escapeHtml(truncate(project, 54))}</span>
        </button>
      `,
    )
    .join("");

  for (const button of els.recentList.querySelectorAll("button")) {
    button.addEventListener("click", () => {
      els.rootPathInput.value = button.dataset.path;
      startIndex(button.dataset.path);
    });
  }
}

function updateProject(project) {
  state.project = project && project.id ? project : null;
  clearSelection();
  state.expandedDirs = new Set(["."]);
  state.fileTreeExpanded = new Set([""]);
  state.nodePositions.clear();
  state.editing = false;

  const hasProject = Boolean(state.project?.rootPath);
  els.projectSubtitle.textContent = hasProject ? state.project.rootPath : "No project indexed";
  els.rootPathInput.value = hasProject ? state.project.rootPath : els.rootPathInput.value;
  els.symbolCount.textContent = `${state.project?.stats?.symbols || 0} symbols`;
  els.fileCount.textContent = `${state.project?.stats?.files || 0} files`;

  renderProjectList();
  renderFileList();
  renderFileTree();
  renderLegend();
  renderInitialResults();
  resetCodePane();

  if (hasProject && !els.inspector.classList.contains("collapsed")) {
    connectTerminal();
  }
  connectTraceEvents();
  loadGraph().catch(showError);
}

function resetCodePane() {
  state.currentFile = null;
  state.currentContent = "";
  state.currentContentHash = "";
  state.currentSymbols = [];
  state.codeSearchQuery = "";
  state.codeSearchHits = [];
  state.codeSearchIndex = -1;
  state.editing = false;
  els.codeTitle.textContent = "Code";
  els.codeMeta.textContent = "No file selected";
  els.outline.innerHTML = `<div class="empty-state">No file selected</div>`;
  els.codeView.innerHTML = `<code></code>`;
  els.codeEditor.value = "";
  els.codeSearchInput.value = "";
  els.editButton.disabled = true;
  els.editorDrawer.classList.add("hidden");
  syncEditorMode();
}

function renderInitialResults() {
  const files = state.project?.files || [];
  const preferred = files
    .slice(0, 80)
    .map((file) => ({ type: "file", item: file }));
  renderResults(preferred);
}

function renderResults(results) {
  if (!results.length) {
    els.resultList.innerHTML = `<div class="empty-state">No matches</div>`;
    return;
  }

  els.resultList.innerHTML = results
    .map((result) => {
      const item = result.item;
      if (result.type === "file") {
        return `
          <button class="result-item" data-type="file" data-id="${item.id}">
            ${badge("file")}
            <span class="item-main">${escapeHtml(item.relativePath || item.name)}</span>
            <span class="item-sub">${escapeHtml(item.moduleName || "")}</span>
          </button>
        `;
      }
      return `
        <button class="result-item" data-type="symbol" data-id="${item.id}">
          ${badge(item.kind, item.external)}
          <span class="item-main">${escapeHtml(item.name)}</span>
          <span class="item-sub">${escapeHtml(item.qualifiedName)}</span>
        </button>
      `;
    })
    .join("");

  for (const button of els.resultList.querySelectorAll("button")) {
    button.addEventListener("click", () => {
      if (button.dataset.type === "file") {
        openFile(Number(button.dataset.id)).catch(showError);
      } else {
        selectSymbol(Number(button.dataset.id)).catch(showError);
      }
    });
  }
}

function renderFileList() {
  const files = state.project?.files || [];
  if (!files.length) {
    els.fileList.innerHTML = `<div class="empty-state">No Python files indexed</div>`;
    return;
  }

  els.fileList.innerHTML = files
    .slice(0, 500)
    .map(
      (file) => `
        <button class="file-item ${file.id === state.selectedFileId ? "active" : ""}" data-id="${file.id}">
          <span class="item-main">${escapeHtml(file.relativePath)}</span>
          <span class="item-sub">${escapeHtml(file.moduleName)} - ${file.lineCount} lines</span>
        </button>
      `,
    )
    .join("");

  for (const button of els.fileList.querySelectorAll("button")) {
    button.addEventListener("click", () => openFile(Number(button.dataset.id)).catch(showError));
  }
}

function buildFileTree(files) {
  const root = {
    type: "directory",
    name: state.project?.name || "root",
    path: "",
    directories: new Map(),
    files: [],
  };

  for (const file of files) {
    const parts = String(file.relativePath || file.name || "").split("/").filter(Boolean);
    if (!parts.length) {
      continue;
    }
    let dir = root;
    for (const part of parts.slice(0, -1)) {
      const nextPath = dir.path ? `${dir.path}/${part}` : part;
      if (!dir.directories.has(part)) {
        dir.directories.set(part, {
          type: "directory",
          name: part,
          path: nextPath,
          directories: new Map(),
          files: [],
        });
      }
      dir = dir.directories.get(part);
    }
    dir.files.push({ ...file, name: parts[parts.length - 1] });
  }

  return root;
}

function sortFileTreeDirectory(dir) {
  const directories = [...dir.directories.values()].sort((a, b) => a.name.localeCompare(b.name));
  const files = [...dir.files].sort((a, b) => a.name.localeCompare(b.name));
  return { directories, files };
}

function renderFileTreeDirectory(dir, depth) {
  const { directories, files } = sortFileTreeDirectory(dir);
  const rows = [];

  for (const child of directories) {
    const expanded = state.fileTreeExpanded.has(child.path);
    rows.push(`
      <button class="tree-row directory ${expanded ? "expanded" : ""}" data-type="directory" data-path="${escapeHtml(
        child.path,
      )}" style="--depth:${depth}">
        <span class="tree-arrow">${expanded ? "v" : ">"}</span>
        <span class="tree-icon">[]</span>
        <span class="tree-name">${escapeHtml(child.name)}</span>
      </button>
    `);
    if (expanded) {
      rows.push(renderFileTreeDirectory(child, depth + 1));
    }
  }

  for (const file of files) {
    rows.push(`
      <button class="tree-row file ${file.id === state.selectedFileId ? "active" : ""}" data-type="file" data-id="${
        file.id
      }" style="--depth:${depth}">
        <span class="tree-arrow"></span>
        <span class="tree-icon">py</span>
        <span class="tree-name">${escapeHtml(file.name)}</span>
      </button>
    `);
  }

  return rows.join("");
}

function renderFileTree() {
  const files = state.project?.files || [];
  if (!els.fileTree) {
    return;
  }
  if (!files.length) {
    els.fileTree.innerHTML = `<div class="empty-state">No Python files indexed</div>`;
    return;
  }

  const tree = buildFileTree(files);
  els.fileTree.innerHTML = renderFileTreeDirectory(tree, 0);

  for (const button of els.fileTree.querySelectorAll("button")) {
    if (button.dataset.type === "directory") {
      button.addEventListener("click", () => {
        const pathValue = button.dataset.path || "";
        if (state.fileTreeExpanded.has(pathValue)) {
          state.fileTreeExpanded.delete(pathValue);
        } else {
          state.fileTreeExpanded.add(pathValue);
        }
        renderFileTree();
      });
    } else if (button.dataset.type === "file") {
      button.addEventListener("click", () => openFile(Number(button.dataset.id), null, false, true).catch(showError));
    }
  }
  scrollFileTreeSelection();
}

function scrollFileTreeSelection() {
  const active = els.fileTree.querySelector(".tree-row.file.active");
  if (active) {
    active.scrollIntoView({ block: "nearest" });
  }
}

function selectFileInTree(relativePath) {
  const file = state.project?.files?.find((item) => item.relativePath === relativePath);
  if (!file) {
    return null;
  }
  state.selectedFileId = file.id;
  expandFileTreeForPath(file.relativePath || "");
  renderFileTree();
  return file;
}

async function loadProjects() {
  const payload = await fetchJson("/api/projects");
  state.projects = payload.projects || [];
  renderProjectList();
  return payload;
}

async function loadRecent() {
  const payload = await fetchJson("/api/recent");
  renderRecent(payload.projects || []);
}

async function switchProject(id) {
  state.projectMenuOpenId = "";
  await fetchJson("/api/projects/active", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId: id }),
  });
  await loadActiveProject(id);
}

async function renameProject(id) {
  const project = state.projects.find((item) => item.id === id);
  if (!project) {
    return;
  }
  const nextName = window.prompt("Rename project", project.name || "");
  if (nextName === null) {
    return;
  }
  const name = nextName.trim();
  if (!name) {
    return;
  }
  const payload = await fetchJson("/api/projects/rename", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId: id, name }),
  });
  state.projects = payload.projects || state.projects;
  if (payload.project?.id === projectId()) {
    state.project = { ...state.project, name: payload.project.name };
    els.projectSubtitle.textContent = state.project.rootPath;
    renderFileTree();
  }
  renderProjectList();
  setStatus("Renamed", "ready");
}

async function removeProject(id) {
  const project = state.projects.find((item) => item.id === id);
  if (!project) {
    return;
  }
  if (!window.confirm(`Remove project "${project.name || project.rootPath}" from CodeTrace?`)) {
    return;
  }
  const payload = await fetchJson("/api/projects/remove", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId: id }),
  });
  state.projects = payload.projects || [];
  if (payload.activeProjectId) {
    await loadActiveProject(payload.activeProjectId);
  } else {
    updateProject(null);
    clearTraceView();
  }
  setStatus("Removed", "ready");
}

async function loadActiveProject(id = "") {
  const project = await fetchJson(apiUrl("/api/project", { projectId: id, include: "files" }));
  updateProject(project);
}

async function search(query) {
  if (!state.project?.rootPath) {
    renderResults([]);
    return;
  }

  if (!query.trim()) {
    renderInitialResults();
    return;
  }

  const payload = await fetchJson(
    apiUrl("/api/search", {
      projectId: projectId(),
      q: query,
    }),
  );
  renderResults(payload.results || []);
}

async function startIndex(rootPath) {
  const selectedPath = String(rootPath || "").trim();
  if (!selectedPath) {
    setStatus("Error", "error");
    els.graphMeta.textContent = "Choose a project directory.";
    return;
  }

  setIndexing(true);
  setStatus("Indexing");
  els.graphMeta.textContent = "Scanning project";

  try {
    await fetchJson("/api/index", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rootPath: selectedPath }),
    });
  } catch (error) {
    setIndexing(false);
    setStatus("Error", "error");
    els.graphMeta.textContent = error.message;
  }
}

function graphParams() {
  const params = {
    projectId: projectId(),
    mode: state.mode,
  };

  if (state.mode === "tree") {
    params.expanded = [...state.expandedDirs].join("|");
  } else {
    if (state.selectedSymbolId) {
      params.symbolId = state.selectedSymbolId;
    }
    if (state.selectedFileId) {
      params.fileId = state.selectedFileId;
    }
  }

  return params;
}

async function loadGraph() {
  if (!state.project?.rootPath) {
    state.graph = { nodes: [], edges: [] };
    renderGraph();
    return;
  }

  if (state.mode === "trace") {
    state.graph = buildTraceGraph();
    els.graphTitle.textContent = "Runtime Trace";
    els.graphMeta.textContent = traceGraphMetaText();
    renderGraph();
    return;
  }

  persistCurrentNodePositions();
  const graph = await fetchJson(apiUrl("/api/graph", graphParams()));
  state.graph = graph;
  els.graphTitle.textContent = graph.title || modeTitle(state.mode);
  els.graphMeta.textContent = `${graph.nodes.length} nodes, ${graph.edges.length} edges${
    graph.limited ? " - limited" : ""
  }`;
  renderGraph();
}

function persistCurrentNodePositions() {
  for (const [id, position] of state.renderedPositions.entries()) {
    state.nodePositions.set(id, { ...position });
  }
}

function modeTitle(mode) {
  if (mode === "modules") {
    return "Modules";
  }
  if (mode === "functions") {
    return "Functions";
  }
  if (mode === "classes") {
    return "Classes";
  }
  if (mode === "trace") {
    return "Runtime Trace";
  }
  return "Structure";
}

async function selectSymbol(symbolId) {
  let symbol = state.project?.symbols?.find((item) => item.id === symbolId);
  if (!symbol && state.project?.id) {
    const payload = await fetchJson(apiUrl(`/api/symbol/${symbolId}`, { projectId: projectId() }));
    symbol = payload.symbol;
  }
  if (!symbol) {
    return;
  }

  state.selectedSymbolId = symbolId;
  state.selectedFileId = symbol.fileId || state.selectedFileId;
  state.selectedRange = {
    startLine: symbol.startLine,
    endLine: symbol.endLine,
  };

  if (symbol.kind === "class") {
    setMode("classes");
  } else if (symbol.kind === "function" || symbol.kind === "method") {
    setMode("functions");
  }

  await loadGraph();

  if (symbol.fileId) {
    await openFile(symbol.fileId, state.selectedRange, false);
  } else {
    els.codeTitle.textContent = symbol.name;
    els.codeMeta.textContent = symbol.qualifiedName;
  }
}

async function openFile(fileId, range = null, refreshGraph = true, showEditor = true) {
  if (!state.project?.id) {
    return;
  }

  const payload = await fetchJson(
    apiUrl("/api/file", {
      projectId: projectId(),
      fileId,
    }),
  );
  state.selectedFileId = fileId;
  state.selectedRange = range;
  state.selectedSymbolId = range ? state.selectedSymbolId : null;
  state.currentFile = payload.file;
  state.currentContent = payload.content;
  state.currentContentHash = payload.contentHash;
  state.currentSymbols = payload.symbols || [];
  expandFileTreeForPath(payload.file.relativePath || "");
  recomputeCodeSearchHits();
  state.editing = false;
  renderFileList();
  renderFileTree();
  renderCode();
  if (showEditor) {
    els.editorDrawer.classList.remove("hidden");
  }
  if (refreshGraph && state.mode !== "tree") {
    await loadGraph();
  }
}

function expandFileTreeForPath(relativePath) {
  const parts = String(relativePath || "").split("/").filter(Boolean);
  let current = "";
  for (const part of parts.slice(0, -1)) {
    current = current ? `${current}/${part}` : part;
    state.fileTreeExpanded.add(current);
  }
}

function renderCode() {
  const file = state.currentFile;
  if (!file) {
    resetCodePane();
    return;
  }

  els.codeTitle.textContent = file.relativePath;
  els.codeMeta.textContent = `${file.moduleName} - ${file.lineCount} lines`;
  els.editButton.disabled = false;

  const symbols = state.currentSymbols;
  if (symbols.length) {
    els.outline.innerHTML = symbols
      .filter((symbol) => symbol.kind !== "module")
      .slice(0, 60)
      .map(
        (symbol) => `
          <button class="outline-item" data-id="${symbol.id}">
            ${badge(symbol.kind)}
            <span class="item-main">${escapeHtml(symbol.name)}</span>
            <span class="item-sub">line ${symbol.startLine}</span>
          </button>
        `,
      )
      .join("");
  } else {
    els.outline.innerHTML = `<div class="empty-state">No symbols in file</div>`;
  }

  for (const button of els.outline.querySelectorAll("button")) {
    button.addEventListener("click", () => focusCodeSymbol(Number(button.dataset.id)));
  }

  const selected = state.selectedRange;
  const lines = state.currentContent.split(/\r?\n/);
  const searchLine = state.codeSearchHits[state.codeSearchIndex] || 0;
  els.codeView.innerHTML = `<code>${lines
    .map((line, index) => renderCodeLine(line, index + 1, selected, searchLine))
    .join("")}</code>`;

  els.codeEditor.value = state.currentContent;
  syncEditorMode();

  if (searchLine) {
    scrollToCodeLine(searchLine);
  } else if (selected) {
    const line = document.getElementById(`line-${selected.startLine}`);
    if (line) {
      line.scrollIntoView({ block: "center" });
    }
  }
}

async function openTraceFile(filePath, lineNumber) {
  if (!state.project?.id || !filePath) {
    return;
  }
  const payload = await fetchJson(
    apiUrl("/api/trace-file", {
      projectId: projectId(),
      path: filePath,
    }),
  );
  state.selectedFileId = null;
  state.selectedSymbolId = null;
  state.selectedRange = lineNumber
    ? {
        startLine: lineNumber,
        endLine: lineNumber,
      }
    : null;
  state.currentFile = payload.file;
  state.currentContent = payload.content;
  state.currentContentHash = payload.contentHash;
  state.currentSymbols = payload.symbols || [];
  recomputeCodeSearchHits();
  state.editing = false;
  renderFileList();
  renderCode();
  els.editorDrawer.classList.remove("hidden");
  setStatus("Edit available", "ready");
}

function recomputeCodeSearchHits() {
  const normalized = state.codeSearchQuery.toLowerCase();
  state.codeSearchHits = [];
  state.codeSearchIndex = -1;
  if (!normalized) {
    return;
  }
  const lines = state.currentContent.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (line.toLowerCase().includes(normalized)) {
      state.codeSearchHits.push(index + 1);
    }
  });
  if (state.codeSearchHits.length) {
    state.codeSearchIndex = 0;
  }
}

function renderCodeLine(line, lineNumber, selected, searchLine) {
  const highlighted = selected && lineNumber >= selected.startLine && lineNumber <= selected.endLine;
  const searchHit = state.codeSearchHits.includes(lineNumber);
  const currentHit = lineNumber === searchLine;
  const classes = ["code-line"];
  if (highlighted) {
    classes.push("highlight");
  }
  if (searchHit) {
    classes.push("search-hit");
  }
  if (currentHit) {
    classes.push("current-hit");
  }
  return `<span class="${classes.join(" ")}" id="line-${lineNumber}"><span class="line-no">${lineNumber}</span><span class="line-text">${highlightPythonLine(line) || " "}</span></span>`;
}

function focusCodeSymbol(symbolId) {
  const symbol = state.currentSymbols.find((item) => item.id === symbolId);
  if (!symbol) {
    return;
  }
  state.selectedRange = {
    startLine: symbol.startLine,
    endLine: symbol.endLine,
  };
  renderCode();
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
    let kind = "";
    if (match[1]) {
      kind = "comment";
    } else if (match[2]) {
      kind = "string";
    } else if (match[3]) {
      kind = "decorator";
    } else if (match[4]) {
      kind = "keyword";
    } else if (match[5]) {
      kind = "self";
    } else if (match[6]) {
      kind = "number";
    }

    output += kind
      ? `<span class="syntax-${kind}">${escapeHtml(value)}</span>`
      : escapeHtml(value);
    cursor = match.index + value.length;
  }

  output += escapeHtml(line.slice(cursor));
  return output;
}

function updateCodeSearch(query, move = 0) {
  state.codeSearchQuery = query;
  recomputeCodeSearchHits();
  if (state.codeSearchHits.length && move < 0) {
    state.codeSearchIndex = state.codeSearchHits.length - 1;
  }
  renderCode();
}

function moveCodeSearch(direction) {
  if (!state.codeSearchHits.length) {
    updateCodeSearch(els.codeSearchInput.value, direction);
    return;
  }
  const next = state.codeSearchIndex + direction;
  state.codeSearchIndex = (next + state.codeSearchHits.length) % state.codeSearchHits.length;
  renderCode();
}

function scrollToCodeLine(lineNumber) {
  const line = document.getElementById(`line-${lineNumber}`);
  if (line) {
    line.scrollIntoView({ block: "center" });
  }
}

function syncEditorMode() {
  els.codeView.classList.toggle("hidden", state.editing);
  els.codeEditor.classList.toggle("hidden", !state.editing);
  els.saveButton.classList.toggle("hidden", !state.editing);
  els.cancelButton.classList.toggle("hidden", !state.editing);
  els.editButton.classList.toggle("hidden", state.editing);
}

async function saveCurrentFile() {
  if (!state.currentFile || !state.project?.id) {
    return;
  }

  const content = els.codeEditor.value;
  const isTraceFile = state.currentFile.isTraceFile || !state.currentFile.id;
  const payload = await fetchJson(isTraceFile ? "/api/trace-file" : "/api/file", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      isTraceFile
        ? {
            projectId: projectId(),
            path: state.currentFile.tracePath || state.currentFile.path,
            content,
            contentHash: state.currentContentHash,
          }
        : {
            projectId: projectId(),
            fileId: state.currentFile.id,
            content,
            contentHash: state.currentContentHash,
          },
    ),
  });

  state.currentContent = content;
  state.currentContentHash = payload.contentHash;
  state.currentFile = payload.file;
  recomputeCodeSearchHits();
  state.editing = false;
  setStatus("Saved", "ready");
  renderCode();
  renderFileList();
}

function openEditorWindow() {
  if (!state.project?.id || !state.currentFile?.id) {
    return;
  }
  const params = new URLSearchParams({
    projectId: projectId(),
    fileId: String(state.currentFile.id),
  });
  if (state.selectedRange?.startLine) {
    params.set("line", String(state.selectedRange.startLine));
  }
  window.open(`/editor.html?${params.toString()}`, "_blank", "noopener,noreferrer");
}

function traceKind(eventType) {
  if (eventType === "start" || eventType === "trace_session" || eventType === "shell_session") {
    return "trace-start";
  }
  if (eventType === "import") {
    return "trace-import";
  }
  if (eventType === "call") {
    return "trace-call";
  }
  if (eventType === "line") {
    return "trace-line";
  }
  if (eventType === "return") {
    return "trace-return";
  }
  if (eventType === "exception") {
    return "trace-exception";
  }
  if (eventType === "fatal" || eventType === "tracer_stderr") {
    return "trace-fatal";
  }
  if (eventType === "output") {
    return "trace-output";
  }
  if (eventType === "finish" || eventType === "process_close" || eventType === "system_exit") {
    return "trace-finish";
  }
  if (eventType === "trace_total") {
    return "trace-total";
  }
  if (eventType === "trace_wait") {
    return "trace-wait";
  }
  if (eventType === "trace_omitted") {
    return "trace-omitted";
  }
  return "trace-line";
}

function traceLabel(event) {
  if (event.type === "trace_session") {
    return `trace ${event.command || ""}`;
  }
  if (event.type === "shell_session") {
    return `shell ${event.command || ""}`;
  }
  if (event.type === "start") {
    return event.script || event.module || "start";
  }
  if (event.type === "import") {
    return `import ${event.module}`;
  }
  if (event.type === "call") {
    return `call ${event.function}()`;
  }
  if (event.type === "line") {
    return `line ${event.line}  ${compactCode(event.source) || "(blank)"}`;
  }
  if (event.type === "return") {
    return `return ${event.function}()`;
  }
  if (event.type === "exception") {
    return `${event.exceptionType}: ${event.message || ""}`;
  }
  if (event.type === "output") {
    return `${event.stream}: ${String(event.text || "").trim() || "output"}`;
  }
  if (event.type === "fatal") {
    return `${event.exceptionType || "fatal"}: ${event.message || ""}`;
  }
  if (event.type === "finish") {
    return `finish ${event.exitCode}`;
  }
  if (event.type === "process_close") {
    return `process close ${event.exitCode ?? ""}`;
  }
  if (event.type === "trace_total") {
    return "trace complete";
  }
  if (event.type === "trace_wait") {
    return "waiting...";
  }
  if (event.type === "trace_omitted") {
    return `... ${event.omittedCount || 0} events ...`;
  }
  return event.type || "trace";
}

function compactCode(value, max = 74) {
  return truncate(String(value || "").replace(/\s+/g, " ").trim(), max);
}

function formatDuration(ms) {
  if (ms < 1000) {
    return `${ms < 10 ? ms.toFixed(1) : Math.round(ms)}ms`;
  }
  return `${(ms / 1000).toFixed(3)}s`;
}

function traceValueSummary(value) {
  if (!value || typeof value !== "object") {
    return "";
  }
  if (Object.prototype.hasOwnProperty.call(value, "value")) {
    return truncate(JSON.stringify(value.value), 34);
  }
  return truncate(value.repr || value.type || "", 42);
}

function isImportSource(source) {
  return /^(import\s+\S+|from\s+\S+\s+import\s+)/.test(String(source || "").trim());
}

function isRepoRelativeFile(filePath) {
  const text = String(filePath || "");
  return Boolean(text) && !text.startsWith("/") && !text.startsWith("<") && !/^[A-Za-z]:[\\/]/.test(text);
}

function isAlwaysVisibleTraceEvent(event) {
  return ["trace_session", "shell_session", "start", "trace_wait", "trace_omitted", "trace_total"].includes(event.type);
}

function traceFilterAllows(event) {
  const filters = state.traceFilters;
  if (filters.repoOnly && event.file && !isRepoRelativeFile(event.file)) {
    return isAlwaysVisibleTraceEvent(event) || ["output", "fatal"].includes(event.type);
  }
  if (event.type === "call") {
    return filters.calls;
  }
  if (event.type === "line") {
    return filters.lines;
  }
  if (event.type === "import") {
    return filters.imports;
  }
  if (event.type === "return") {
    return filters.returns;
  }
  if (event.type === "output") {
    return filters.output;
  }
  if (["exception", "fatal", "system_exit", "limit"].includes(event.type)) {
    return filters.exceptions;
  }
  return true;
}

function baseTraceGraphEvents(events) {
  return events.filter((event, index) => {
    if (["finish", "process_close"].includes(event.type)) {
      return false;
    }
    if (event.type !== "line" || !isImportSource(event.source)) {
      return true;
    }
    const next = events[index + 1];
    return !(next && next.type === "import" && next.file === event.file && next.line === event.line);
  });
}

function traceGraphEvents(events) {
  return baseTraceGraphEvents(events).filter(traceFilterAllows);
}

function traceFilterStats() {
  const base = baseTraceGraphEvents(state.traceEvents);
  const shown = base.filter(traceFilterAllows);
  return { base: base.length, shown: shown.length, hidden: Math.max(0, base.length - shown.length) };
}

function decorateTraceWindow(events, start, total, focusIndex) {
  const decorated = events.map((event, index) => ({ ...event, __traceIndex: start + index }));
  decorated.windowStart = start;
  decorated.windowEnd = start + decorated.length;
  decorated.windowTotal = total;
  decorated.windowFocus = focusIndex;
  decorated.windowLimited = total > decorated.length;
  return decorated;
}

function visibleTraceWindow(events, limit = 420, focusIndex = -1) {
  if (events.length <= limit) {
    return decorateTraceWindow(events, 0, events.length, focusIndex);
  }
  const focus = Number.isInteger(focusIndex) && focusIndex >= 0 ? Math.min(focusIndex, events.length - 1) : events.length - 1;
  const before = Math.floor(limit * 0.45);
  const start = clamp(focus - before, 0, events.length - limit);
  return decorateTraceWindow(events.slice(start, start + limit), start, events.length, focus);
}

function traceNodeIdForEvent(event, index) {
  return `trace:${event?.__traceIndex ?? event?.id ?? index}`;
}

function traceEventKey(event, index) {
  return event?.__traceIndex ?? `${event?.id ?? "event"}:${index}`;
}

function normalizeTraceReplayIndex(events) {
  if (!state.stepReplay) {
    return events.length - 1;
  }
  if (!events.length) {
    state.traceReplayIndex = -1;
    return -1;
  }
  if (!Number.isInteger(state.traceReplayIndex) || state.traceReplayIndex < 0) {
    state.traceReplayIndex = 0;
  }
  state.traceReplayIndex = Math.min(state.traceReplayIndex, events.length - 1);
  return state.traceReplayIndex;
}

function traceFocusIndex(events, replayIndex) {
  if (state.stepReplay) {
    return replayIndex;
  }
  if (state.activeTraceNodeId) {
    const index = events.findIndex((event, eventIndex) => traceNodeIdForEvent(event, eventIndex) === state.activeTraceNodeId);
    if (index >= 0) {
      return index;
    }
  }
  return events.length - 1;
}

function currentTraceEventIndex(events = traceGraphEvents(state.traceEvents)) {
  if (!events.length) {
    return -1;
  }
  if (state.stepReplay) {
    return clamp(Number.isInteger(state.traceReplayIndex) ? state.traceReplayIndex : 0, 0, events.length - 1);
  }
  if (state.activeTraceNodeId) {
    const index = events.findIndex((event, eventIndex) => traceNodeIdForEvent(event, eventIndex) === state.activeTraceNodeId);
    if (index >= 0) {
      return index;
    }
  }
  return events.length - 1;
}

function updateTracePositionControls() {
  const events = traceGraphEvents(state.traceEvents);
  const count = events.length;
  const index = currentTraceEventIndex(events);
  const disabled = count <= 0;
  els.tracePositionSlider.disabled = disabled;
  els.tracePositionInput.disabled = disabled;
  els.tracePositionSlider.max = String(Math.max(1, count));
  els.tracePositionInput.max = String(Math.max(1, count));
  els.tracePositionSlider.value = String(Math.max(1, index + 1));
  els.tracePositionInput.value = String(Math.max(1, index + 1));
  els.tracePositionMeta.textContent = count ? `${index + 1}/${count}` : "0 steps";
}

function traceMetaText() {
  const stats = traceFilterStats();
  const filterSuffix = stats.hidden ? ` (${stats.shown}/${stats.base} shown)` : "";
  if (state.stepReplay) {
    const events = traceGraphEvents(state.traceEvents);
    const current = events.length ? Math.min(Math.max(state.traceReplayIndex, 0), events.length - 1) + 1 : 0;
    const suffix = state.traceRunning ? " - buffering" : "";
    return `${current}/${events.length} steps${suffix}${filterSuffix}`;
  }
  return `${state.traceEvents.length} events${state.traceRunning ? " - running" : state.traceEvents.length ? " - last run" : ""}${filterSuffix}`;
}

function traceGraphMetaText() {
  const graph = state.graph || {};
  const stats = traceFilterStats();
  const parts = [`${state.traceEvents.length} trace events`];
  if (state.traceRunning) {
    parts.push("running");
  }
  if (stats.hidden) {
    parts.push(`${stats.shown}/${stats.base} shown after filters`);
  }
  if (graph.windowTotal && graph.windowTotal > (graph.windowEnd || 0) - (graph.windowStart || 0)) {
    parts.push(`drawing ${graph.windowStart + 1}-${graph.windowEnd} of ${graph.windowTotal}`);
  }
  return parts.join(" - ");
}

function traceSubtitle(event, startTs) {
  const location = event.line ? `${event.file || ""}:${event.line}` : event.file || "";
  if (event.type === "line") {
    const changed = event.changed ? Object.keys(event.changed) : [];
    const removed = event.removed || [];
    const parts = [];
    if (changed.length) {
      parts.push(`after prev step: ${changed.slice(0, 4).join(", ")}`);
    }
    if (removed.length) {
      parts.push(`removed after prev: ${removed.slice(0, 3).join(", ")}`);
    }
    return parts.join(" | ");
  }
  if (event.type === "call") {
    const args = event.args ? Object.keys(event.args) : [];
    return args.length ? `${location} | args: ${args.slice(0, 4).join(", ")}` : location;
  }
  if (event.type === "return") {
    const value = traceValueSummary(event.returnValue);
    return value ? `${location} | ${value}` : location;
  }
  if (event.type === "import") {
    return event.source ? `line ${event.line}  ${compactCode(event.source)}` : location;
  }
  if (event.type === "output") {
    return event.stream || "";
  }
  if (event.type === "fatal" && event.traceback) {
    return "open terminal/logs for traceback";
  }
  if (event.type === "start") {
    return event.mode || "";
  }
  if (event.type === "shell_session") {
    return "captured from interactive shell";
  }
  if (event.type === "trace_total") {
    const parts = [];
    if (event.exitCode !== undefined && event.exitCode !== null) {
      parts.push(`exit ${event.exitCode}`);
    }
    parts.push(`${event.eventCount || 0} events`);
    parts.push("probe overhead included");
    return parts.join(" | ");
  }
  if (event.type === "trace_wait") {
    return event.location || "waiting for Next";
  }
  if (event.type === "trace_omitted") {
    return "middle events hidden to keep the graph readable";
  }
  return location;
}

function buildTraceGraph() {
  const sourceEvents = traceGraphEvents(state.traceEvents);
  const replayIndex = normalizeTraceReplayIndex(sourceEvents);
  const replayComplete = !state.stepReplay || replayIndex >= sourceEvents.length - 1;
  const hiddenByReplay = state.stepReplay && replayIndex >= 0 && replayIndex < sourceEvents.length - 1;
  const displayedEvents = state.stepReplay && replayIndex >= 0 ? sourceEvents.slice(0, replayIndex + 1) : sourceEvents;
  const focusIndex = traceFocusIndex(displayedEvents, replayIndex);
  const events = visibleTraceWindow(displayedEvents, 420, focusIndex);
  const allEvents = state.traceEvents;
  const startTs = allEvents[0]?.ts || sourceEvents[0]?.ts || events[0]?.ts || 0;
  const nodes = [];
  const edges = [];
  const eventNodeByTraceId = new Map();

  events.forEach((event, index) => {
    const id = traceNodeIdForEvent(event, index);
    eventNodeByTraceId.set(traceEventKey(event, index), id);
    nodes.push({
      id,
      entityType: "trace",
      kind: traceKind(event.type),
      name: traceLabel(event),
      subtitle: traceSubtitle(event, startTs),
      qualifiedName: `${event.file || ""}${event.line ? `:${event.line}` : ""} ${event.source || ""}`,
      external: false,
      selected: false,
      fileId: null,
      symbolId: null,
      relativePath: event.file || null,
      line: event.line || null,
      depth: Math.min(event.depth || 0, 8),
      childCount: 0,
      traceEvent: event,
    });

    if (index > 0) {
      edges.push({
        id: `trace-edge:${index}`,
        type: "trace-seq",
        sourceId: traceNodeIdForEvent(events[index - 1], index - 1),
        targetId: id,
        label: "next",
      });
    }
  });

  const lastVisible = events[events.length - 1] || null;
  const lastVisibleNodeId = lastVisible ? eventNodeByTraceId.get(lastVisible.id) : null;
  const endEvent = [...allEvents].reverse().find((event) => ["finish", "process_close", "system_exit"].includes(event.type));
  if (state.stepReplay && lastVisibleNodeId && (hiddenByReplay || state.traceRunning)) {
    const waitEvent = {
      id: "wait",
      type: "trace_wait",
      ts: Date.now() / 1000,
      depth: Math.min(lastVisible.depth || 0, 8),
      location: hiddenByReplay ? "press Next to reveal buffered trace" : "waiting for next trace event",
    };
    const id = "trace:wait";
    nodes.push({
      id,
      entityType: "trace",
      kind: traceKind(waitEvent.type),
      name: traceLabel(waitEvent),
      subtitle: traceSubtitle(waitEvent, startTs),
      qualifiedName: "waiting for step replay",
      external: false,
      selected: false,
      fileId: null,
      symbolId: null,
      relativePath: null,
      line: null,
      depth: waitEvent.depth,
      childCount: 0,
      traceEvent: waitEvent,
    });
    edges.push({
      id: "trace-edge:wait",
      type: "trace-seq",
      sourceId: lastVisibleNodeId,
      targetId: id,
      label: "wait",
    });
  } else if (!state.traceRunning && replayComplete && endEvent && lastVisibleNodeId) {
    const endTs = endEvent.ts || allEvents[allEvents.length - 1]?.ts || startTs;
    const exitEvent = [...allEvents].reverse().find((event) => event.exitCode !== undefined || event.code !== undefined);
    const totalEvent = {
      id: "total",
      type: "trace_total",
      ts: endTs,
      durationMs: Math.max(0, (endTs - startTs) * 1000),
      eventCount: allEvents.length,
      exitCode: exitEvent?.exitCode ?? exitEvent?.code ?? null,
      depth: Math.min(lastVisible.depth || 0, 8),
    };
    const id = "trace:total";
    nodes.push({
      id,
      entityType: "trace",
      kind: traceKind(totalEvent.type),
      name: traceLabel(totalEvent),
      subtitle: traceSubtitle(totalEvent, startTs),
      qualifiedName: "total runtime",
      external: false,
      selected: false,
      fileId: null,
      symbolId: null,
      relativePath: null,
      line: null,
      depth: totalEvent.depth,
      childCount: 0,
      traceEvent: totalEvent,
    });
    edges.push({
      id: "trace-edge:total",
      type: "trace-seq",
      sourceId: lastVisibleNodeId,
      targetId: id,
      label: "total",
    });
  } else if (!state.stepReplay && state.traceRunning && lastVisibleNodeId) {
    const nowTs = Date.now() / 1000;
    const waitEvent = {
      id: "wait",
      type: "trace_wait",
      ts: nowTs,
      waitMs: Math.max(0, (nowTs - (lastVisible.ts || startTs)) * 1000),
      depth: Math.min(lastVisible.depth || 0, 8),
      location: lastVisible.line ? `${lastVisible.file || ""}:${lastVisible.line}` : lastVisible.file || "",
    };
    const id = "trace:wait";
    nodes.push({
      id,
      entityType: "trace",
      kind: traceKind(waitEvent.type),
      name: traceLabel(waitEvent),
      subtitle: traceSubtitle(waitEvent, startTs),
      qualifiedName: "waiting for next trace event",
      external: false,
      selected: false,
      fileId: null,
      symbolId: null,
      relativePath: null,
      line: null,
      depth: waitEvent.depth,
      childCount: 0,
      traceEvent: waitEvent,
    });
    edges.push({
      id: "trace-edge:wait",
      type: "trace-seq",
      sourceId: lastVisibleNodeId,
      targetId: id,
      label: "wait",
    });
  }

  const lastByFrame = new Map();
  for (const [index, event] of events.entries()) {
    const nodeId = eventNodeByTraceId.get(traceEventKey(event, index));
    if (!nodeId || !event.frameId) {
      continue;
    }
    if (event.parentFrameId && lastByFrame.has(event.parentFrameId) && event.type === "call") {
      edges.push({
        id: `trace-parent:${traceEventKey(event, index)}`,
        type: "trace-parent",
        sourceId: lastByFrame.get(event.parentFrameId),
        targetId: nodeId,
        label: "call",
      });
    }
    lastByFrame.set(event.frameId, nodeId);
  }

  const activeNodeExists = state.activeTraceNodeId && nodes.some((node) => node.id === state.activeTraceNodeId);
  const fallbackNode = [...nodes].reverse().find((node) => node.kind !== "trace-wait") || nodes[nodes.length - 1];
  const selectedNodeId = activeNodeExists ? state.activeTraceNodeId : fallbackNode?.id || "";
  for (const node of nodes) {
    node.selected = node.id === selectedNodeId;
  }

  return {
    mode: "trace",
    title: "Runtime Trace",
    nodes,
    edges,
    limited: sourceEvents.length > displayedEvents.length || Boolean(events.windowLimited),
    windowStart: events.windowStart || 0,
    windowEnd: events.windowEnd || events.length,
    windowTotal: events.windowTotal || events.length,
  };
}

function handleTraceEvent(event) {
  if (!event || event.projectId !== projectId()) {
    return;
  }
  if (event.type === "trace_session") {
    state.traceEvents = [];
    resetTraceEventSequence();
    state.activeTraceNodeId = "";
    state.traceReplayIndex = state.stepReplay ? 0 : -1;
    state.nodePositions.clear();
    state.traceRunning = true;
    if (event.command) {
      els.traceCommandInput.value = event.command;
    }
  }
  state.traceEvents.push(prepareTraceEvent(event));
  if (state.traceEvents.length > 30000) {
    state.traceEvents.shift();
  }
  if (["finish", "process_close", "fatal"].includes(event.type)) {
    state.traceRunning = false;
    state.shellCaptureActive = false;
    state.shellTraceJsonMode = false;
  }
  scheduleTraceRender();
}

function applyTraceState(payload) {
  if (!payload || payload.projectId !== projectId()) {
    return;
  }
  state.traceEvents = prepareTraceEvents(payload.events || []);
  state.traceRunning = Boolean(payload.running);
  if (payload.command) {
    els.traceCommandInput.value = payload.command;
  }
  els.traceMeta.textContent = traceMetaText();
  if (state.mode === "trace") {
    state.graph = buildTraceGraph();
    els.graphTitle.textContent = "Runtime Trace";
    els.graphMeta.textContent = traceGraphMetaText();
    renderGraph();
    updateTraceFilterMeta();
  }
}

async function refreshTraceState() {
  if (!state.project?.id) {
    return;
  }
  const payload = await fetchJson(apiUrl("/api/trace/state", { projectId: projectId() }));
  applyTraceState(payload);
}

function scheduleTraceRender() {
  els.traceMeta.textContent = traceMetaText();
  if (state.mode !== "trace") {
    return;
  }
  if (state.traceRenderTimer) {
    return;
  }
  state.traceRenderTimer = setTimeout(() => {
    state.traceRenderTimer = null;
    state.graph = buildTraceGraph();
    els.graphTitle.textContent = "Runtime Trace";
    els.graphMeta.textContent = traceGraphMetaText();
    renderGraph();
    updateTraceFilterMeta();
    if (state.traceRunning && !state.activeTraceNodeId && !state.stepReplay) {
      els.graphFrame.scrollTop = els.graphFrame.scrollHeight;
    }
  }, 120);
}

function connectTraceEvents() {
  if (state.traceEventSource) {
    state.traceEventSource.close();
    state.traceEventSource = null;
  }
  if (!state.project?.id) {
    return;
  }
  const events = new EventSource(apiUrl("/api/trace/events", { projectId: projectId() }));
  state.traceEventSource = events;
  events.addEventListener("hello", (event) => {
    const payload = JSON.parse(event.data);
    if (!payload.running && state.traceRunning && state.traceEvents.length) {
      return;
    }
    state.traceRunning = Boolean(payload.running);
    els.traceMeta.textContent = traceMetaText();
  });
  events.addEventListener("trace", (event) => {
    handleTraceEvent(JSON.parse(event.data));
  });
}

async function startTraceRun(command) {
  if (!state.project?.id) {
    return;
  }
  const trimmed = String(command || "").trim();
  if (!trimmed || trimmed === "python" || trimmed === "python3") {
    els.traceMeta.textContent = "Enter a script or module";
    throw new Error("Trace command needs a Python script or module, for example: python app.py");
  }
  setMode("trace");
  state.activeTraceNodeId = "";
  state.traceReplayIndex = state.stepReplay ? 0 : -1;
  resetTraceEventSequence();
  state.traceEvents = prepareTraceEvents([
    {
      id: `pending-${Date.now()}`,
      type: "trace_session",
      projectId: projectId(),
      command: trimmed,
      ts: Date.now() / 1000,
    },
  ]);
  state.traceRunning = true;
  state.nodePositions.clear();
  state.graph = buildTraceGraph();
  renderGraph();
  els.traceMeta.textContent = "starting";
  connectTraceEvents();
  try {
    await fetchJson("/api/trace/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: projectId(),
        command: trimmed,
      }),
    });
  } catch (error) {
    state.traceRunning = false;
    els.traceMeta.textContent = "failed";
    scheduleTraceRender();
    throw error;
  }
  await refreshTraceState().catch(() => {});
}

async function stopTraceRun() {
  if (!state.project?.id) {
    return;
  }
  await fetchJson("/api/trace/stop", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId: projectId() }),
  });
}

function colorForKind(kind, external) {
  if (external) {
    return "#6f7787";
  }
  switch (kind) {
    case "directory":
      return "#9bbf55";
    case "file":
      return "#79a8ff";
    case "module":
      return "#79a8ff";
    case "class":
      return "#f2b84b";
    case "method":
      return "#8fd17f";
    case "function":
      return "#35d0ba";
    case "parameter":
      return "#cfd6df";
    case "variable":
      return "#b9c1cc";
    case "trace-start":
      return "#79a8ff";
    case "trace-import":
      return "#9bbf55";
    case "trace-call":
      return "#35d0ba";
    case "trace-line":
      return "#cfd6df";
    case "trace-return":
      return "#8fd17f";
    case "trace-exception":
      return "#f2b84b";
    case "trace-fatal":
      return "#ef718d";
    case "trace-output":
      return "#f2b84b";
    case "trace-finish":
      return "#b9c1cc";
    case "trace-total":
      return "#f2b84b";
    case "trace-wait":
      return "#2c3542";
    case "trace-omitted":
      return "#343943";
    default:
      return "#c9d0da";
  }
}

function edgeClass(type) {
  if (type === "trace-seq") {
    return "trace-seq";
  }
  if (type === "trace-parent") {
    return "trace-parent";
  }
  if (type === "calls") {
    return "calls";
  }
  if (type === "import") {
    return "import";
  }
  if (type === "inherits") {
    return "inherits";
  }
  if (type === "contains") {
    return "contains";
  }
  if (type === "uses_class") {
    return "uses-class";
  }
  return "";
}

function layoutGraph(nodes, edges, width, height) {
  const positions = new Map();
  const stored = state.nodePositions;
  const isTree = state.mode === "tree";
  const isTrace = state.mode === "trace";

  for (const node of nodes) {
    if (stored.has(node.id)) {
      positions.set(node.id, stored.get(node.id));
    }
  }

  if (isTrace) {
    const rowH = 92;
    const colW = 420;
    nodes.forEach((node, index) => {
      if (!positions.has(node.id)) {
        positions.set(node.id, {
          x: 190 + Math.min(node.depth || 0, 7) * colW,
          y: 90 + index * rowH,
        });
      }
    });
    normalizePositions(positions);
    return positions;
  }

  if (isTree) {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const childrenByParent = new Map();
    for (const edge of edges) {
      if (!nodeById.has(edge.sourceId) || !nodeById.has(edge.targetId)) {
        continue;
      }
      const list = childrenByParent.get(edge.sourceId) || [];
      list.push(nodeById.get(edge.targetId));
      childrenByParent.set(edge.sourceId, list);
    }

    let placed = true;
    while (placed) {
      placed = false;
      for (const [parentId, children] of childrenByParent.entries()) {
        const parentPosition = positions.get(parentId);
        if (!parentPosition) {
          continue;
        }
        const unplaced = children.filter((node) => !positions.has(node.id));
        if (!unplaced.length) {
          continue;
        }
        const placement = childPlacement(unplaced, parentPosition, width, height);
        unplaced.forEach((node, index) => {
          positions.set(node.id, placement[index]);
        });
        placed = true;
      }
    }

    const byDepth = new Map();
    for (const node of nodes) {
      if (positions.has(node.id)) {
        continue;
      }
      const list = byDepth.get(node.depth || 0) || [];
      list.push(node);
      byDepth.set(node.depth || 0, list);
    }

    for (const [depth, list] of byDepth.entries()) {
      list.sort(compareTreeNodes);
      const x = 150 + depth * 300;
      const step = Math.max(74, Math.min(104, (height - 120) / Math.max(list.length, 1)));
      const startY = Math.max(74, height / 2 - ((list.length - 1) * step) / 2);
      list.forEach((node, index) => {
        positions.set(node.id, { x, y: startY + index * step });
      });
    }
    normalizePositions(positions);
    return positions;
  }

  const selected = nodes.find((node) => node.selected);
  if (selected && !positions.has(selected.id)) {
    positions.set(selected.id, { x: width / 2, y: height / 2 });
  }

  if (selected) {
    const outgoing = new Set(edges.filter((edge) => edge.sourceId === selected.id).map((edge) => edge.targetId));
    const incoming = new Set(edges.filter((edge) => edge.targetId === selected.id).map((edge) => edge.sourceId));
    const groups = [
      nodes.filter((node) => node.id !== selected.id && incoming.has(node.id) && !positions.has(node.id)),
      nodes.filter((node) => node.id !== selected.id && outgoing.has(node.id) && !positions.has(node.id)),
      nodes.filter(
        (node) =>
          node.id !== selected.id && !incoming.has(node.id) && !outgoing.has(node.id) && !positions.has(node.id),
      ),
    ];
    const anchors = [
      { x: width * 0.25, y: height * 0.5 },
      { x: width * 0.75, y: height * 0.5 },
      { x: width * 0.5, y: height * 0.78 },
    ];

    groups.forEach((group, groupIndex) => {
      const anchor = anchors[groupIndex];
      group.forEach((node, index) => {
        const angle = (Math.PI * 2 * index) / Math.max(group.length, 1);
        const radius = Math.min(190, 78 + group.length * 7);
        positions.set(node.id, {
          x: anchor.x + Math.cos(angle) * radius,
          y: anchor.y + Math.sin(angle) * radius * 0.72,
        });
      });
    });
  } else {
    const remaining = nodes.filter((node) => !positions.has(node.id));
    const columns = Math.max(4, Math.ceil(Math.sqrt(nodes.length || 1)));
    const cellW = width / columns;
    const rows = Math.ceil((remaining.length || 1) / columns);
    const cellH = height / Math.max(rows, 1);
    remaining.forEach((node, index) => {
      positions.set(node.id, {
        x: cellW * (index % columns) + cellW / 2,
        y: cellH * Math.floor(index / columns) + cellH / 2,
      });
    });
  }

  return positions;
}

function childPlacement(children, parentPosition, width, height) {
  const sorted = [...children].sort(compareTreeNodes);
  const stepY = 74;
  const stepX = 280;
  const marginTop = 92;
  const marginBottom = 92;
  const availableHeight = Math.max(360, height - marginTop - marginBottom);
  const maxRows = Math.max(5, Math.floor(availableHeight / stepY));
  const columns = Math.max(1, Math.ceil(sorted.length / maxRows));
  const positions = [];

  for (let column = 0; column < columns; column += 1) {
    const start = column * maxRows;
    const columnItems = sorted.slice(start, start + maxRows);
    const columnHeight = (columnItems.length - 1) * stepY;
    const preferredTop = parentPosition.y - columnHeight / 2;
    const top = clamp(preferredTop, marginTop, Math.max(marginTop, height - marginBottom - columnHeight));

    columnItems.forEach((node, row) => {
      positions[children.indexOf(node)] = {
        x: parentPosition.x + stepX + column * stepX,
        y: top + row * stepY,
      };
    });
  }

  return positions;
}

function normalizePositions(positions) {
  let minX = Infinity;
  let minY = Infinity;
  for (const position of positions.values()) {
    minX = Math.min(minX, position.x);
    minY = Math.min(minY, position.y);
  }
  const shiftX = minX < 90 ? 90 - minX : 0;
  const shiftY = minY < 90 ? 90 - minY : 0;
  if (!shiftX && !shiftY) {
    return;
  }
  for (const position of positions.values()) {
    position.x += shiftX;
    position.y += shiftY;
  }
}

function compareTreeNodes(a, b) {
  const typeWeight = {
    directory: 1,
    file: 2,
    symbol: 3,
  };
  const aWeight = typeWeight[a.entityType] || 9;
  const bWeight = typeWeight[b.entityType] || 9;
  if (aWeight !== bWeight) {
    return aWeight - bWeight;
  }
  return String(a.name).localeCompare(String(b.name));
}

function svgEl(name, attrs = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attrs)) {
    element.setAttribute(key, value);
  }
  return element;
}

function graphDimensions(nodes) {
  const frameWidth = Math.max(1240, Math.floor(els.graphFrame?.clientWidth || 0) - 20);
  if (state.mode === "trace") {
    const maxDepth = nodes.reduce((max, node) => Math.max(max, node.depth || 0), 0);
    return {
      width: Math.max(frameWidth, 560 + (maxDepth + 1) * 420),
      height: Math.max(820, 190 + nodes.length * 92),
    };
  }
  if (state.mode !== "tree") {
    return { width: frameWidth, height: 820 };
  }
  const maxDepth = nodes.reduce((max, node) => Math.max(max, node.depth || 0), 0);
  const counts = new Map();
  for (const node of nodes) {
    counts.set(node.depth || 0, (counts.get(node.depth || 0) || 0) + 1);
  }
  const maxRows = Math.max(1, ...counts.values());
  return {
    width: Math.max(frameWidth, 260 + (maxDepth + 1) * 300),
    height: Math.max(820, 130 + maxRows * 86),
  };
}

function nodeSize(node) {
  const labelMax = node.entityType === "trace" ? 58 : node.entityType === "directory" ? 28 : 38;
  const label = truncate(node.name || node.qualifiedName, labelMax);
  const subtitle = truncate(node.subtitle || "", node.entityType === "trace" ? 62 : 38);
  const textUnits = Math.max(label.length, subtitle.length * 0.78);
  const width = Math.max(138, Math.min(node.entityType === "trace" ? 560 : 320, textUnits * 8 + 58));
  return {
    width,
    height: node.entityType === "trace" && subtitle ? 66 : node.entityType === "trace" ? 54 : 48,
    label,
    subtitle,
  };
}

function appendArrowDefs(svg) {
  const defs = svgEl("defs");
  const marker = svgEl("marker", {
    id: "graph-arrow",
    markerWidth: 8,
    markerHeight: 8,
    refX: 7,
    refY: 4,
    orient: "auto",
    markerUnits: "strokeWidth",
  });
  marker.appendChild(
    svgEl("path", {
      d: "M 0 0 L 8 4 L 0 8 z",
      fill: "#697386",
    }),
  );
  defs.appendChild(marker);
  svg.appendChild(defs);
}

function edgeEndpoint(from, to, size) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (!dx && !dy) {
    return { ...from };
  }
  const scaleX = size.width / 2 / Math.max(Math.abs(dx), 1);
  const scaleY = size.height / 2 / Math.max(Math.abs(dy), 1);
  const scale = Math.min(scaleX, scaleY);
  return {
    x: from.x + dx * scale,
    y: from.y + dy * scale,
  };
}

function edgeLinePoints(sourceId, targetId) {
  const from = state.renderedPositions.get(sourceId);
  const to = state.renderedPositions.get(targetId);
  const fromSize = state.nodeSizes.get(sourceId);
  const toSize = state.nodeSizes.get(targetId);
  if (!from || !to || !fromSize || !toSize) {
    return null;
  }
  return {
    from: edgeEndpoint(from, to, fromSize),
    to: edgeEndpoint(to, from, toSize),
  };
}

function renderGraph() {
  const svg = els.graphSvg;
  svg.replaceChildren();

  const nodes = state.graph.nodes || [];
  const edges = state.graph.edges || [];
  let { width, height } = graphDimensions(nodes);
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  applyGraphZoom(width, height);

  if (!nodes.length) {
    const text = svgEl("text", {
      x: width / 2,
      y: height / 2,
      "text-anchor": "middle",
      fill: "#9aa5b5",
      "font-size": "18",
      "font-weight": "700",
    });
    text.textContent = state.project?.id ? "No graph data for this layer" : "No project indexed";
    svg.appendChild(text);
    renderTraceDetail(null);
    updateTracePositionControls();
    return;
  }

  state.renderedPositions = layoutGraph(nodes, edges, width, height);
  const bounds = graphBounds(state.renderedPositions, nodes);
  width = Math.max(width, bounds.width);
  height = Math.max(height, bounds.height);
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  applyGraphZoom(width, height);
  state.nodeSizes = new Map(nodes.map((node) => [node.id, nodeSize(node)]));
  state.graphNodeById = new Map(nodes.map((node) => [node.id, node]));
  computeGraphSearchMatches();
  const matchIds = new Set(state.graphSearchMatches);
  const currentMatchId = state.graphSearchMatches[state.graphSearchIndex] || "";

  appendArrowDefs(svg);
  const edgeLayer = svgEl("g", { class: "edge-layer" });
  const nodeLayer = svgEl("g", { class: "node-layer" });
  svg.appendChild(edgeLayer);
  svg.appendChild(nodeLayer);

  for (const edge of edges) {
    const points = edgeLinePoints(edge.sourceId, edge.targetId);
    if (!points) {
      continue;
    }
    edgeLayer.appendChild(
      svgEl("line", {
        class: `graph-edge ${edgeClass(edge.type)}`,
        "data-source": edge.sourceId,
        "data-target": edge.targetId,
        x1: points.from.x,
        y1: points.from.y,
        x2: points.to.x,
        y2: points.to.y,
        "marker-end": "url(#graph-arrow)",
      }),
    );
  }

  for (const node of nodes) {
    const position = state.renderedPositions.get(node.id);
    if (!position) {
      continue;
    }
    const size = state.nodeSizes.get(node.id) || nodeSize(node);

    const group = svgEl("g", {
      class: `graph-node ${node.entityType} ${node.kind || ""} ${node.external ? "external" : ""} ${
        node.selected ? "selected" : ""
      } ${matchIds.has(node.id) ? "search-match" : ""} ${node.id === currentMatchId ? "current-search" : ""}`,
      transform: `translate(${position.x - size.width / 2}, ${position.y - size.height / 2})`,
      role: "button",
      tabindex: "0",
      "data-node-id": node.id,
    });

    group.appendChild(
      svgEl("rect", {
        width: size.width,
        height: size.height,
        rx: 7,
        fill: colorForKind(node.kind, node.external),
      }),
    );

    if (node.childCount > 0) {
      const marker = svgEl("text", {
        x: 18,
        y: 30,
        "text-anchor": "middle",
        class: "node-marker",
      });
      marker.textContent = node.expanded ? "-" : "+";
      group.appendChild(marker);
    }

    if (node.kind === "trace-wait") {
      group.appendChild(
        svgEl("circle", {
          class: "node-spinner",
          cx: 22,
          cy: 22,
          r: 8,
        }),
      );
    }

    const text = svgEl("text", {
      x: node.childCount > 0 ? size.width / 2 + 10 : size.width / 2,
      y: size.subtitle ? 28 : size.height / 2 + 5,
      "text-anchor": "middle",
    });
    text.textContent = size.label;
    group.appendChild(text);

    if (size.subtitle) {
      const subtext = svgEl("text", {
        x: node.childCount > 0 ? size.width / 2 + 10 : size.width / 2,
        y: 47,
        "text-anchor": "middle",
        class: "node-sublabel",
      });
      subtext.textContent = size.subtitle;
      group.appendChild(subtext);
    }

    group.addEventListener("pointerdown", (event) => startNodeDrag(event, node.id));
    group.addEventListener("click", (event) => {
      if (Date.now() < (state.suppressClickUntil || 0)) {
        return;
      }
      const pending = state.pendingGraphClick;
      state.pendingGraphClick = null;
      if (!pending || (pending.nodeId === node.id && Date.now() - pending.time < 800)) {
        event.preventDefault();
        event.stopPropagation();
        handleGraphNode(node, { openCode: pending ? pending.openCode : isOpenableTraceNode(node) }).catch(showError);
      }
    });
    nodeLayer.appendChild(group);
  }

  if (state.mode === "trace") {
    renderTraceDetail(nodes.find((node) => node.selected && node.entityType === "trace") || null);
    updateTracePositionControls();
  }
}

function graphBounds(positions, nodes) {
  let width = 0;
  let height = 0;
  for (const node of nodes) {
    const position = positions.get(node.id);
    if (!position) {
      continue;
    }
    const size = nodeSize(node);
    width = Math.max(width, position.x + size.width / 2 + 120);
    height = Math.max(height, position.y + size.height / 2 + 120);
  }
  return { width, height };
}

function applyGraphZoom(width, height) {
  const zoom = state.graphZoom;
  const frameWidth = Math.max(720, Math.floor(els.graphFrame?.clientWidth || 0) - 20);
  els.graphSvg.style.width = `${Math.max(frameWidth, Math.round(width * zoom))}px`;
  els.graphSvg.style.height = `${Math.max(520, Math.round(height * zoom))}px`;
  els.zoomValue.textContent = `${Math.round(zoom * 100)}%`;
}

function setGraphZoom(nextZoom) {
  state.graphZoom = Math.max(0.35, Math.min(2.5, nextZoom));
  const viewBox = els.graphSvg.getAttribute("viewBox") || "0 0 1240 820";
  const parts = viewBox.split(/\s+/).map(Number);
  applyGraphZoom(parts[2] || 1240, parts[3] || 820);
}

function computeGraphSearchMatches() {
  const query = state.graphSearchQuery.trim().toLowerCase();
  const previousId = state.graphSearchMatches[state.graphSearchIndex] || "";
  state.graphSearchMatches = [];
  state.graphSearchIndex = -1;

  if (!query) {
    els.graphSearchMeta.textContent = "0";
    return;
  }

  for (const node of state.graph.nodes || []) {
    const text = `${node.name || ""} ${node.qualifiedName || ""} ${node.kind || ""}`.toLowerCase();
    if (text.includes(query)) {
      state.graphSearchMatches.push(node.id);
    }
  }

  if (state.graphSearchMatches.length) {
    const previousIndex = previousId ? state.graphSearchMatches.indexOf(previousId) : -1;
    state.graphSearchIndex = previousIndex >= 0 ? previousIndex : 0;
  }
  updateGraphSearchMeta();
}

function updateGraphSearch(query) {
  state.graphSearchQuery = query;
  renderGraph();
  scrollToCurrentGraphSearch();
}

function moveGraphSearch(direction) {
  if (!state.graphSearchMatches.length) {
    computeGraphSearchMatches();
  }
  if (!state.graphSearchMatches.length) {
    updateGraphSearchMeta();
    return;
  }
  state.graphSearchIndex =
    (state.graphSearchIndex + direction + state.graphSearchMatches.length) % state.graphSearchMatches.length;
  updateGraphSearchMeta();
  renderGraph();
  scrollToCurrentGraphSearch();
}

function updateGraphSearchMeta() {
  if (!state.graphSearchMatches.length) {
    els.graphSearchMeta.textContent = state.graphSearchQuery ? "0" : "0";
    return;
  }
  els.graphSearchMeta.textContent = `${state.graphSearchIndex + 1}/${state.graphSearchMatches.length}`;
}

function scrollToCurrentGraphSearch() {
  const nodeId = state.graphSearchMatches[state.graphSearchIndex];
  scrollToGraphNode(nodeId);
}

function scrollToGraphNode(nodeId) {
  if (!nodeId) {
    return;
  }
  const position = state.renderedPositions.get(nodeId);
  if (!position) {
    return;
  }
  const zoom = state.graphZoom;
  els.graphFrame.scrollTo({
    left: Math.max(0, position.x * zoom - els.graphFrame.clientWidth / 2),
    top: Math.max(0, position.y * zoom - els.graphFrame.clientHeight / 2),
    behavior: "smooth",
  });
}

function traceNavigationNodes() {
  return (state.graph.nodes || []).filter((node) => node.entityType === "trace");
}

function selectedTraceNodeId() {
  const nodes = traceNavigationNodes();
  if (!nodes.length) {
    return "";
  }
  if (state.activeTraceNodeId && nodes.some((node) => node.id === state.activeTraceNodeId)) {
    return state.activeTraceNodeId;
  }
  return nodes.find((node) => node.selected)?.id || nodes[nodes.length - 1]?.id || "";
}

function applyTraceSelection(nodeId) {
  if (state.mode !== "trace") {
    return;
  }
  for (const node of state.graph.nodes || []) {
    node.selected = node.entityType === "trace" && node.id === nodeId;
  }
}

async function openTraceNodeSource(node) {
  const event = node?.traceEvent || {};
  if (!event.file || !event.line) {
    return false;
  }
  const file = selectFileInTree(event.file);
  if (file) {
    await openFile(
      file.id,
      {
        startLine: event.line,
        endLine: event.line,
      },
      false,
      true,
    );
  } else {
    await openTraceFile(event.file, event.line);
  }
  return true;
}

function detailValue(value) {
  if (!value || typeof value !== "object") {
    return escapeHtml(String(value ?? ""));
  }
  const parts = [];
  if (value.type) {
    parts.push(String(value.type));
  }
  if (Object.prototype.hasOwnProperty.call(value, "value")) {
    parts.push(JSON.stringify(value.value));
  } else if (value.repr) {
    parts.push(value.repr);
  }
  if (value.len !== undefined) {
    parts.push(`len=${value.len}`);
  }
  return escapeHtml(truncate(parts.filter(Boolean).join(" "), 140));
}

function detailChip(label, value) {
  return `<span class="trace-detail-chip"><b>${escapeHtml(label)}</b> ${value}</span>`;
}

function renderTraceDetail(node) {
  if (state.mode !== "trace" || !node || node.kind === "trace-wait") {
    els.traceDetail.classList.add("hidden");
    els.traceDetail.innerHTML = "";
    return;
  }
  const event = node.traceEvent || {};
  const title = traceLabel(event);
  const location = event.line ? `${event.file || ""}:${event.line}` : event.file || event.module || event.type || "";
  const chips = [];
  if (event.function) {
    chips.push(detailChip("function", escapeHtml(event.function)));
  }
  if (event.module) {
    chips.push(detailChip("module", escapeHtml(event.module)));
  }
  if (event.source) {
    chips.push(detailChip("source", escapeHtml(truncate(event.source, 160))));
  }
  if (event.args) {
    for (const [name, value] of Object.entries(event.args).slice(0, 8)) {
      chips.push(detailChip(`arg ${name}`, detailValue(value)));
    }
  }
  if (event.changed) {
    for (const [name, value] of Object.entries(event.changed).slice(0, 10)) {
      chips.push(detailChip(name, detailValue(value)));
    }
  }
  if (event.removed?.length) {
    chips.push(detailChip("removed", escapeHtml(event.removed.slice(0, 8).join(", "))));
  }
  if (event.returnValue) {
    chips.push(detailChip("return", detailValue(event.returnValue)));
  }
  if (event.text) {
    chips.push(detailChip(event.stream || "output", escapeHtml(truncate(String(event.text).trim(), 180))));
  }
  if (event.exceptionType) {
    chips.push(detailChip("exception", escapeHtml(`${event.exceptionType}: ${event.message || ""}`)));
  }

  els.traceDetail.innerHTML = `
    <div class="trace-detail-title">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(location)}</span>
    </div>
    ${
      chips.length
        ? `<div class="trace-detail-grid">${chips.join("")}</div>`
        : `<div class="trace-detail-empty">No variable or event details captured for this step.</div>`
    }
  `;
  els.traceDetail.classList.remove("hidden");
}

async function selectTraceNode(nodeOrId, options = {}) {
  let node =
    typeof nodeOrId === "string" ? (state.graph.nodes || []).find((item) => item.id === nodeOrId) : nodeOrId;
  if (!node || node.entityType !== "trace") {
    return;
  }

  state.activeTraceNodeId = node.id;
  if (state.stepReplay && node.kind !== "trace-wait") {
    const events = traceGraphEvents(state.traceEvents);
    const replayIndex = events.findIndex((event, index) => traceNodeIdForEvent(event, index) === node.id);
    if (replayIndex >= 0) {
      state.traceReplayIndex = replayIndex;
      state.graph = buildTraceGraph();
      node = (state.graph.nodes || []).find((item) => item.id === state.activeTraceNodeId) || node;
    }
  }
  applyTraceSelection(node.id);
  const nodes = traceNavigationNodes();
  const index = nodes.findIndex((item) => item.id === node.id);
  if (index >= 0) {
    els.traceMeta.textContent = state.stepReplay
      ? traceMetaText()
      : `${index + 1}/${nodes.length} trace nodes${state.traceRunning ? " - running" : ""}`;
  }
  renderGraph();
  scrollToGraphNode(node.id);

  const event = node.traceEvent || {};
  if (event.file) {
    selectFileInTree(event.file);
  }
  if (options.openCode && isOpenableTraceNode(node)) {
    await openTraceNodeSource(node);
  } else if (options.syncCode) {
    state.editing = false;
    els.editorDrawer.classList.add("hidden");
    syncEditorMode();
  }
}

async function moveTraceStep(direction) {
  if (state.mode !== "trace" && state.traceEvents.length) {
    setMode("trace");
  }

  if (state.stepReplay) {
    const events = traceGraphEvents(state.traceEvents);
    if (!events.length) {
      els.traceMeta.textContent = "No trace";
      return;
    }
    const currentIndex = normalizeTraceReplayIndex(events);
    const nextIndex = clamp(currentIndex + direction, 0, events.length - 1);
    if (nextIndex === currentIndex && direction > 0 && state.traceRunning) {
      els.traceMeta.textContent = `${currentIndex + 1}/${events.length} steps - waiting`;
      return;
    }
    state.traceReplayIndex = nextIndex;
    state.activeTraceNodeId = traceNodeIdForEvent(events[nextIndex], nextIndex);
    state.graph = buildTraceGraph();
    els.graphMeta.textContent = traceGraphMetaText();
    renderGraph();
    const nextNode = (state.graph.nodes || []).find((node) => node.id === state.activeTraceNodeId);
    if (nextNode) {
      await selectTraceNode(nextNode, { openCode: isOpenableTraceNode(nextNode), syncCode: true });
    }
    els.traceMeta.textContent = traceMetaText();
    return;
  }

  const events = traceGraphEvents(state.traceEvents);
  if (!events.length) {
    els.traceMeta.textContent = "No trace";
    return;
  }
  const currentId = state.activeTraceNodeId || selectedTraceNodeId();
  const currentIndex = Math.max(
    0,
    events.findIndex((event, index) => traceNodeIdForEvent(event, index) === currentId),
  );
  const nextIndex = clamp(currentIndex + direction, 0, events.length - 1);
  state.activeTraceNodeId = traceNodeIdForEvent(events[nextIndex], nextIndex);
  state.graph = buildTraceGraph();
  els.graphMeta.textContent = traceGraphMetaText();
  renderGraph();
  const nextNode = (state.graph.nodes || []).find((node) => node.id === state.activeTraceNodeId);
  if (!nextNode) {
    return;
  }
  els.traceMeta.textContent = `${nextIndex + 1}/${events.length} trace nodes`;
  await selectTraceNode(nextNode, { openCode: isOpenableTraceNode(nextNode), syncCode: true });
}

async function jumpTraceToIndex(index) {
  const events = traceGraphEvents(state.traceEvents);
  if (!events.length) {
    updateTracePositionControls();
    return;
  }
  const nextIndex = clamp(Number(index) || 0, 0, events.length - 1);
  if (state.stepReplay) {
    state.traceReplayIndex = nextIndex;
  }
  state.activeTraceNodeId = traceNodeIdForEvent(events[nextIndex], nextIndex);
  state.graph = buildTraceGraph();
  els.graphMeta.textContent = traceGraphMetaText();
  renderGraph();
  const node = (state.graph.nodes || []).find((item) => item.id === state.activeTraceNodeId);
  if (node) {
    await selectTraceNode(node, { openCode: isOpenableTraceNode(node), syncCode: true });
  }
  els.traceMeta.textContent = traceMetaText();
  updateTracePositionControls();
}

function setStepReplay(enabled) {
  state.stepReplay = Boolean(enabled);
  els.traceStepReplayInput.checked = state.stepReplay;
  try {
    localStorage.setItem(STORAGE_KEYS.stepReplay, state.stepReplay ? "1" : "0");
  } catch {
    // Ignore storage failures in private or restricted browser contexts.
  }
  state.activeTraceNodeId = "";
  state.traceReplayIndex = state.stepReplay && traceGraphEvents(state.traceEvents).length ? 0 : -1;
  if (state.mode === "trace") {
    state.graph = buildTraceGraph();
    els.graphMeta.textContent = traceGraphMetaText();
    renderGraph();
  }
  els.traceMeta.textContent = traceMetaText();
}

function syncTraceFilterInputs() {
  els.filterRepoOnlyInput.checked = state.traceFilters.repoOnly;
  els.filterCallsInput.checked = state.traceFilters.calls;
  els.filterLinesInput.checked = state.traceFilters.lines;
  els.filterImportsInput.checked = state.traceFilters.imports;
  els.filterReturnsInput.checked = state.traceFilters.returns;
  els.filterOutputInput.checked = state.traceFilters.output;
  els.filterExceptionsInput.checked = state.traceFilters.exceptions;
}

function persistTraceFilters() {
  try {
    localStorage.setItem(STORAGE_KEYS.traceFilters, JSON.stringify(state.traceFilters));
  } catch {
    // Ignore storage failures in private or restricted browser contexts.
  }
}

function updateTraceFilterMeta() {
  const stats = traceFilterStats();
  els.traceFilterMeta.textContent = stats.hidden ? `${stats.hidden} hidden` : "";
}

function setTraceFilters(nextFilters) {
  state.traceFilters = { ...state.traceFilters, ...nextFilters };
  syncTraceFilterInputs();
  persistTraceFilters();
  state.activeTraceNodeId = "";
  state.traceReplayIndex = state.stepReplay && traceGraphEvents(state.traceEvents).length ? 0 : -1;
  if (state.mode === "trace") {
    state.graph = buildTraceGraph();
    els.graphMeta.textContent = traceGraphMetaText();
    renderGraph();
  }
  updateTraceFilterMeta();
  els.traceMeta.textContent = traceMetaText();
}

function loadTraceFilterSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.traceFilters);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        state.traceFilters = { ...state.traceFilters, ...parsed };
      }
    }
  } catch {
    // Keep defaults if stored data is unavailable or malformed.
  }
  syncTraceFilterInputs();
}

function svgPoint(event) {
  const svg = els.graphSvg;
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  return point.matrixTransform(svg.getScreenCTM().inverse());
}

function startNodeDrag(event, nodeId) {
  if (event.button !== 0) {
    return;
  }
  const position = state.renderedPositions.get(nodeId);
  if (!position) {
    return;
  }
  const point = svgPoint(event);
  state.dragging = {
    nodeId,
    pointerId: event.pointerId,
    captureTarget: event.currentTarget,
    offsetX: point.x - position.x,
    offsetY: point.y - position.y,
    moved: false,
  };
  if (event.currentTarget?.setPointerCapture) {
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Some SVG implementations reject capture after synthetic events.
    }
  }
}

function startCanvasPan(event) {
  if (event.button !== 0 || event.target !== els.graphSvg) {
    return;
  }
  state.canvasPan = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    scrollLeft: els.graphFrame.scrollLeft,
    scrollTop: els.graphFrame.scrollTop,
  };
  els.graphFrame.classList.add("panning");
  if (els.graphSvg.setPointerCapture) {
    els.graphSvg.setPointerCapture(event.pointerId);
  }
  event.preventDefault();
}

function updateGraphPositions() {
  for (const group of els.graphSvg.querySelectorAll(".graph-node")) {
    const nodeId = group.dataset.nodeId;
    const position = state.renderedPositions.get(nodeId);
    const size = state.nodeSizes.get(nodeId);
    if (position && size) {
      group.setAttribute("transform", `translate(${position.x - size.width / 2}, ${position.y - size.height / 2})`);
    }
  }
  for (const line of els.graphSvg.querySelectorAll(".graph-edge")) {
    const points = edgeLinePoints(line.dataset.source, line.dataset.target);
    if (points) {
      line.setAttribute("x1", points.from.x);
      line.setAttribute("y1", points.from.y);
      line.setAttribute("x2", points.to.x);
      line.setAttribute("y2", points.to.y);
    }
  }
}

function handlePointerMove(event) {
  if (state.canvasPan) {
    const pan = state.canvasPan;
    els.graphFrame.scrollLeft = pan.scrollLeft - (event.clientX - pan.x);
    els.graphFrame.scrollTop = pan.scrollTop - (event.clientY - pan.y);
    return;
  }

  if (!state.dragging) {
    return;
  }
  const point = svgPoint(event);
  const next = {
    x: point.x - state.dragging.offsetX,
    y: point.y - state.dragging.offsetY,
  };
  const previous = state.renderedPositions.get(state.dragging.nodeId);
  if (previous && Math.hypot(next.x - previous.x, next.y - previous.y) > 2) {
    state.dragging.moved = true;
  }
  state.renderedPositions.set(state.dragging.nodeId, next);
  state.nodePositions.set(state.dragging.nodeId, next);
  updateGraphPositions();
}

function handlePointerUp(event) {
  if (state.canvasPan) {
    const pan = state.canvasPan;
    state.canvasPan = null;
    els.graphFrame.classList.remove("panning");
    if (els.graphSvg.releasePointerCapture && pan.pointerId !== undefined) {
      try {
        els.graphSvg.releasePointerCapture(pan.pointerId);
      } catch {
        // Pointer capture may already be released by the browser.
      }
    }
    return;
  }

  if (!state.dragging) {
    return;
  }
  const dragging = state.dragging;
  state.dragging = null;
  const captureTarget = dragging.captureTarget || els.graphSvg;
  if (captureTarget.releasePointerCapture && dragging.pointerId !== undefined) {
    try {
      captureTarget.releasePointerCapture(dragging.pointerId);
    } catch {
      // Pointer capture may already be released by the browser.
    }
  }
  if (dragging.moved || event.type === "pointerleave") {
    state.suppressClickUntil = Date.now() + 160;
    return;
  }
  const node = state.graphNodeById.get(dragging.nodeId);
  if (node) {
    state.pendingGraphClick = {
      nodeId: node.id,
      openCode: isOpenableTraceNode(node),
      time: Date.now(),
    };
    const pending = state.pendingGraphClick;
    setTimeout(() => {
      if (state.pendingGraphClick !== pending) {
        return;
      }
      state.pendingGraphClick = null;
      const currentNode = state.graphNodeById.get(pending.nodeId);
      if (currentNode) {
        handleGraphNode(currentNode, { openCode: pending.openCode }).catch(showError);
      }
    }, 120);
  }
}

function startDrawerDrag(event) {
  if (event.target.closest("button,input,textarea")) {
    return;
  }
  const rect = els.editorDrawer.getBoundingClientRect();
  state.drawerDrag = {
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top,
    width: rect.width,
    height: rect.height,
  };
  els.editorDrawer.style.left = `${rect.left}px`;
  els.editorDrawer.style.top = `${rect.top}px`;
  els.editorDrawer.style.right = "auto";
  els.editorDrawer.style.bottom = "auto";
  els.editorDrawer.style.width = `${rect.width}px`;
  els.editorDrawer.style.height = `${rect.height}px`;
  event.preventDefault();
}

function startDrawerResize(event) {
  const rect = els.editorDrawer.getBoundingClientRect();
  state.drawerResize = {
    startX: event.clientX,
    startY: event.clientY,
    width: rect.width,
    height: rect.height,
  };
  event.preventDefault();
  event.stopPropagation();
}

function handleDocumentPointerMove(event) {
  if (state.drawerDrag) {
    const drag = state.drawerDrag;
    const visibleHandle = 120;
    const minLeft = Math.min(8, visibleHandle - drag.width);
    const maxLeft = Math.max(8, window.innerWidth - visibleHandle);
    const minTop = 8;
    const maxTop = Math.max(8, window.innerHeight - 72);
    const left = clamp(event.clientX - drag.offsetX, minLeft, maxLeft);
    const top = clamp(event.clientY - drag.offsetY, minTop, maxTop);
    els.editorDrawer.style.left = `${left}px`;
    els.editorDrawer.style.top = `${top}px`;
    return;
  }

  if (state.drawerResize) {
    const resize = state.drawerResize;
    const width = clamp(resize.width + event.clientX - resize.startX, 420, Math.max(1200, window.innerWidth * 1.4));
    const height = clamp(resize.height + event.clientY - resize.startY, 280, Math.max(900, window.innerHeight * 1.4));
    els.editorDrawer.style.width = `${width}px`;
    els.editorDrawer.style.height = `${height}px`;
    return;
  }

  if (state.terminalResize) {
    const nextWidth = clamp(state.terminalResize.startWidth - (event.clientX - state.terminalResize.startX), 360, 980);
    els.workspace.style.setProperty("--shell-width", `${Math.round(nextWidth)}px`);
    fitTerminal();
  }
}

function handleDocumentPointerUp() {
  state.drawerDrag = null;
  state.drawerResize = null;
  state.terminalResize = null;
  els.inspector.classList.remove("resizing");
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function isOpenableTraceNode(node) {
  const event = node?.traceEvent || {};
  return node?.entityType === "trace" && Boolean(event.file) && Number(event.line || 0) > 0;
}

async function handleGraphNode(node, options = {}) {
  const openCode = Boolean(options.openCode);
  if (state.mode === "tree" && node.childCount > 0) {
    const key = node.entityType === "directory" ? node.relativePath || "." : node.id;
    if (state.expandedDirs.has(key) && key !== ".") {
      state.expandedDirs.delete(key);
    } else {
      state.expandedDirs.add(key);
    }
    await loadGraph();
    return;
  }

  if (node.entityType === "directory") {
    const relativePath = node.relativePath || ".";
    if (state.expandedDirs.has(relativePath) && relativePath !== ".") {
      state.expandedDirs.delete(relativePath);
    } else {
      state.expandedDirs.add(relativePath);
    }
    await loadGraph();
    return;
  }

  if (node.entityType === "file") {
    await openFile(node.fileId);
    if (state.mode === "tree") {
      setStatus("Edit available", "ready");
      els.graphMeta.textContent = "No deeper structure under this file. Use Edit in the drawer if needed.";
    }
    return;
  }

  if (node.entityType === "symbol") {
    if (state.mode === "tree") {
      const symbol = state.project?.symbols?.find((item) => item.id === node.symbolId);
      if (symbol?.fileId) {
        state.selectedSymbolId = symbol.id;
        state.selectedRange = {
          startLine: symbol.startLine,
          endLine: symbol.endLine,
        };
        await openFile(symbol.fileId, state.selectedRange, false, true);
        setStatus("Edit available", "ready");
        els.graphMeta.textContent = "No deeper structure under this node. Use Edit in the drawer if needed.";
      }
      return;
    }
    await selectSymbol(node.symbolId);
    return;
  }

  if (node.entityType === "trace") {
    await selectTraceNode(node, { openCode });
    if (!openCode) {
      els.graphMeta.textContent = "Click a trace code node to open the editable source.";
    }
  }
}

function showError(error) {
  setStatus("Error", "error");
  els.graphMeta.textContent = error.message || String(error);
}

async function openBrowse(startPath = "") {
  els.browseModal.classList.remove("hidden");
  await loadBrowsePath(startPath || els.rootPathInput.value || "~");
}

function closeBrowse() {
  els.browseModal.classList.add("hidden");
}

async function loadBrowsePath(targetPath) {
  const payload = await fetchJson(apiUrl("/api/fs", { path: targetPath || "~" }));
  state.browsePath = payload.path;
  state.browseHome = payload.homePath;
  els.browsePathInput.value = payload.path;
  els.browseMeta.textContent = `${payload.entries.length} entries`;
  renderBrowseEntries(payload.entries || []);
}

function renderBrowseEntries(entries) {
  if (!entries.length) {
    els.browseEntries.innerHTML = `<div class="empty-state">Empty directory</div>`;
    return;
  }

  els.browseEntries.innerHTML = entries
    .map(
      (entry) => `
        <button class="browse-entry ${entry.type} ${entry.excluded ? "excluded" : ""}" data-type="${
          entry.type
        }" data-path="${escapeHtml(entry.path)}">
          <span class="entry-name">${escapeHtml(entry.name)}</span>
          <span class="entry-type">${entry.type === "directory" ? "dir" : entry.python ? "python" : "file"}</span>
        </button>
      `,
    )
    .join("");

  for (const button of els.browseEntries.querySelectorAll("button")) {
    button.addEventListener("click", () => {
      if (button.dataset.type === "directory") {
        loadBrowsePath(button.dataset.path).catch(showError);
      }
    });
  }
}

function ensureTerminal() {
  if (state.terminal) {
    return state.terminal;
  }
  if (!window.Terminal) {
    throw new Error("xterm.js failed to load.");
  }
  const terminal = new window.Terminal({
    cursorBlink: true,
    convertEol: true,
    fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
    fontSize: 12.5,
    lineHeight: 1.22,
    scrollback: 8000,
    tabStopWidth: 8,
    theme: {
      background: "#0b0d10",
      foreground: "#d9dee7",
      cursor: "#35d0ba",
      selectionBackground: "#2b5960",
      black: "#0b0d10",
      red: "#ef718d",
      green: "#9bbf55",
      yellow: "#f2b84b",
      blue: "#79a8ff",
      magenta: "#b894ff",
      cyan: "#35d0ba",
      white: "#d9dee7",
      brightBlack: "#747e8e",
      brightRed: "#ff8ea5",
      brightGreen: "#b2d66b",
      brightYellow: "#ffd36a",
      brightBlue: "#9dbfff",
      brightMagenta: "#c7a8ff",
      brightCyan: "#5de4d0",
      brightWhite: "#f2f4f6",
    },
  });
  if (window.FitAddon?.FitAddon) {
    state.terminalFitAddon = new window.FitAddon.FitAddon();
    terminal.loadAddon(state.terminalFitAddon);
  }
  terminal.open(els.terminalOutput);
  terminal.onData((data) => {
    sendTerminalInput(data).catch(showError);
  });
  state.terminal = terminal;
  if (window.ResizeObserver) {
    state.terminalResizeObserver = new ResizeObserver(() => fitTerminal());
    state.terminalResizeObserver.observe(els.terminalOutput);
  }
  fitTerminal();
  return terminal;
}

function fitTerminal() {
  if (!state.terminal || !state.terminalFitAddon || els.workspace.classList.contains("shell-collapsed")) {
    return;
  }
  requestAnimationFrame(() => {
    try {
      state.terminalFitAddon.fit();
    } catch {
      // The terminal may still be hidden during layout changes.
    }
  });
}

function appendTerminal(text, stream = "stdout") {
  const visibleText = consumeShellTraceJson(String(text || ""), stream);
  if (!visibleText) {
    return;
  }
  ensureTerminal().write(visibleText);
}

function isCtraceRunCommand(command) {
  return /(^|\s)(?:\S*\/)?ctrace(?:\.js)?\s+run(\s|$)/.test(String(command || ""));
}

function startShellCapture(command) {
  if (!isCtraceRunCommand(command)) {
    state.shellCaptureActive = false;
    state.shellTraceJsonMode = false;
    state.shellTraceLineBuffer = "";
    state.shellTraceReceived = 0;
    return;
  }
  state.shellCaptureActive = true;
  state.shellTraceJsonMode = isCtraceRunCommand(command);
  state.shellTraceLineBuffer = "";
  state.shellTraceReceived = 0;
  state.shellEventId += 1;
  state.traceRunning = false;
  state.activeTraceNodeId = "";
  state.traceReplayIndex = state.stepReplay ? 0 : -1;
  state.nodePositions.clear();
  resetTraceEventSequence();
  state.traceEvents = prepareTraceEvents([
    {
      id: `shell-session-${state.shellEventId}`,
      type: "shell_session",
      projectId: projectId(),
      command,
      ts: Date.now() / 1000,
      depth: 0,
    },
  ]);
  setMode("trace");
  els.traceMeta.textContent = traceMetaText();
  state.graph = buildTraceGraph();
  renderGraph();
}

function parseTraceJsonLine(line) {
  const text = String(line || "").trim();
  if (!text.startsWith("{") || !text.endsWith("}")) {
    return null;
  }
  try {
    const event = JSON.parse(text);
    if (!event || typeof event !== "object" || typeof event.type !== "string" || event.id === undefined) {
      return null;
    }
    return event;
  } catch {
    return null;
  }
}

function resetTraceEventSequence() {
  state.traceEventSeq = 0;
}

function prepareTraceEvent(event) {
  if (!event || typeof event !== "object") {
    return event;
  }
  if (event.__traceIndex === undefined) {
    state.traceEventSeq += 1;
    event.__traceIndex = state.traceEventSeq;
  } else {
    state.traceEventSeq = Math.max(state.traceEventSeq, Number(event.__traceIndex) || 0);
  }
  return event;
}

function prepareTraceEvents(events) {
  resetTraceEventSequence();
  return (events || []).map((event) => prepareTraceEvent(event));
}

function ingestShellTraceEvent(event) {
  if (!state.project?.id) {
    return;
  }
  if (!state.shellTraceReceived) {
    state.traceEvents = [];
    resetTraceEventSequence();
    state.activeTraceNodeId = "";
    state.traceReplayIndex = state.stepReplay ? 0 : -1;
    state.nodePositions.clear();
    state.traceRunning = true;
    setMode("trace");
  }
  state.shellTraceReceived += 1;
  state.shellEventId += 1;
  state.traceEvents.push(prepareTraceEvent({
    projectId: projectId(),
    traceId: "shell-ctrace",
    ...event,
  }));
  if (state.traceEvents.length > 30000) {
    state.traceEvents.shift();
  }
  if (["finish", "process_close", "fatal"].includes(event.type)) {
    state.traceRunning = false;
    state.shellCaptureActive = false;
    state.shellTraceJsonMode = false;
  }
  els.traceMeta.textContent = traceMetaText();
  scheduleTraceRender();
}

function consumeShellTraceJson(text, stream = "stdout") {
  if (!state.shellTraceJsonMode || stream !== "stdout") {
    return text;
  }

  const visible = [];
  state.shellTraceLineBuffer += String(text || "");
  const parts = state.shellTraceLineBuffer.split(/\n/);
  state.shellTraceLineBuffer = parts.pop() || "";

  for (const part of parts) {
    const line = part.replace(/\r$/, "");
    const event = parseTraceJsonLine(line);
    if (event) {
      ingestShellTraceEvent(event);
    } else if (line.trim()) {
      visible.push(`${line}\n`);
    }
  }

  const pending = state.shellTraceLineBuffer;
  if (pending && !pending.trim().startsWith("{")) {
    visible.push(pending);
    state.shellTraceLineBuffer = "";
  }

  return visible.join("");
}

function clearTraceView() {
  state.traceEvents = [];
  state.activeTraceNodeId = "";
  state.traceReplayIndex = -1;
  state.traceRunning = false;
  state.shellCaptureActive = false;
  state.shellTraceJsonMode = false;
  state.shellTraceLineBuffer = "";
  state.shellTraceReceived = 0;
  state.nodePositions.clear();
  state.renderedPositions.clear();
  state.graph = buildTraceGraph();
  els.traceMeta.textContent = "No trace";
  els.graphMeta.textContent = "Trace cleared";
  updateTraceFilterMeta();
  renderTraceDetail(null);
  renderGraph();
}

function trackTerminalInput(input) {
  if (typeof input !== "string") {
    return;
  }
  if (input === "\x03" || input === "\x04" || input === "\x0c") {
    state.terminalInputBuffer = "";
    return;
  }
  if (input === "\x7f") {
    state.terminalInputBuffer = state.terminalInputBuffer.slice(0, -1);
    return;
  }
  if (input === "\n" || input === "\r") {
    const command = state.terminalInputBuffer.trim();
    state.terminalInputBuffer = "";
    if (command) {
      startShellCapture(command);
    }
    return;
  }
  if (input.includes("\n") || input.includes("\r")) {
    const parts = input.replaceAll("\r", "\n").split("\n");
    state.terminalInputBuffer += parts[0];
    const command = state.terminalInputBuffer.trim();
    state.terminalInputBuffer = parts[parts.length - 1] || "";
    if (command) {
      startShellCapture(command);
    }
    return;
  }
  if (/^[\x20-\x7e]+$/.test(input)) {
    state.terminalInputBuffer += input;
  }
}

function connectTerminal() {
  if (!state.project?.id) {
    return;
  }
  if (state.terminalEvents) {
    state.terminalEvents.close();
    state.terminalEvents = null;
  }
  const terminal = ensureTerminal();
  terminal.clear();
  const events = new EventSource(apiUrl("/api/terminal/events", { projectId: projectId() }));
  state.terminalEvents = events;

  events.addEventListener("output", (event) => {
    const payload = JSON.parse(event.data);
    appendTerminal(payload.text || "", payload.stream || "stdout");
  });

  events.onerror = () => {
    appendTerminal("\n[terminal disconnected]\n", "system");
  };
}

function openShellPanel() {
  els.inspector.classList.remove("collapsed");
  els.workspace.classList.remove("shell-collapsed");
  els.terminalToggleButton.classList.add("active");
  els.terminalToggleButton.textContent = "Hide Shell";
  ensureTerminal().focus();
  fitTerminal();
  setTimeout(fitTerminal, 60);
  setTimeout(fitTerminal, 220);
  if (state.project?.id && !state.terminalEvents) {
    connectTerminal();
  }
}

function closeShellPanel() {
  els.inspector.classList.add("collapsed");
  els.workspace.classList.add("shell-collapsed");
  els.terminalToggleButton.classList.remove("active");
  els.terminalToggleButton.textContent = "Shell";
}

function toggleShellPanel() {
  if (els.workspace.classList.contains("shell-collapsed")) {
    openShellPanel();
  } else {
    closeShellPanel();
  }
}

function startInspectorResize(event) {
  if (event.button !== 0) {
    return;
  }
  state.terminalResize = {
    startX: event.clientX,
    startWidth: els.inspector.getBoundingClientRect().width,
  };
  els.inspector.classList.add("resizing");
  event.preventDefault();
}

async function sendTerminalInput(input) {
  if (!state.project?.id || input === undefined || input === null) {
    return;
  }
  trackTerminalInput(input);
  await fetchJson("/api/terminal/input", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: projectId(),
      input,
    }),
  });
}

function terminalKeyPayload(event) {
  if (event.ctrlKey && event.key.toLowerCase() === "c") {
    return "\x03";
  }
  if (event.ctrlKey && event.key.toLowerCase() === "d") {
    return "\x04";
  }
  if (event.ctrlKey && event.key.toLowerCase() === "l") {
    els.terminalOutput.textContent = "";
    return "\x0c";
  }
  if (event.key === "Enter") {
    return "\n";
  }
  if (event.key === "Backspace") {
    return "\x7f";
  }
  if (event.key === "Tab") {
    return "\t";
  }
  if (event.key === "ArrowUp") {
    return "\x1b[A";
  }
  if (event.key === "ArrowDown") {
    return "\x1b[B";
  }
  if (event.key === "ArrowRight") {
    return "\x1b[C";
  }
  if (event.key === "ArrowLeft") {
    return "\x1b[D";
  }
  if (!event.ctrlKey && !event.metaKey && event.key.length === 1) {
    return event.key;
  }
  return "";
}

function debounce(fn, wait) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

function connectEvents() {
  const events = new EventSource("/api/events");

  events.addEventListener("indexing", (event) => {
    const payload = JSON.parse(event.data);
    setIndexing(true);
    setStatus("Indexing");
    els.graphMeta.textContent = payload.message || payload.phase || "Indexing";
  });

  events.addEventListener("ready", async (event) => {
    const payload = JSON.parse(event.data);
    setIndexing(false);
    setStatus("Ready", "ready");
    await loadProjects().catch(() => {});
    updateProject(payload);
    loadRecent().catch(() => {});
  });

  events.addEventListener("index-error", (event) => {
    const payload = JSON.parse(event.data);
    setIndexing(false);
    setStatus("Error", "error");
    els.graphMeta.textContent = payload.error || "Indexing failed";
  });
}

function bindEvents() {
  els.pathForm.addEventListener("submit", (event) => {
    event.preventDefault();
    startIndex(els.rootPathInput.value);
  });

  els.addProjectButton.addEventListener("click", () => openBrowse().catch(showError));
  els.indexButton.addEventListener("click", () => startIndex(state.project?.rootPath || els.rootPathInput.value));

  els.sidebarToggleButton.addEventListener("click", () => {
    const collapsed = els.workspace.classList.toggle("sidebar-collapsed");
    els.sidebarToggleButton.textContent = collapsed ? ">" : "<";
    els.sidebarToggleButton.title = collapsed ? "Expand sidebar" : "Collapse sidebar";
  });

  els.searchInput.addEventListener(
    "input",
    debounce(() => {
      search(els.searchInput.value).catch(showError);
    }, 120),
  );

  els.overviewButton.addEventListener("click", () => {
    clearSelection();
    state.expandedDirs = new Set(["."]);
    setMode("trace");
    clearTraceView();
    if (state.project?.id) {
      fetchJson("/api/trace/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: projectId() }),
      }).catch(showError);
    }
  });

  els.zoomOutButton.addEventListener("click", () => setGraphZoom(state.graphZoom - 0.15));
  els.zoomInButton.addEventListener("click", () => setGraphZoom(state.graphZoom + 0.15));
  els.zoomResetButton.addEventListener("click", () => setGraphZoom(1));

  els.graphSearchInput.addEventListener(
    "input",
    debounce(() => updateGraphSearch(els.graphSearchInput.value), 120),
  );

  els.graphSearchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      moveGraphSearch(event.shiftKey ? -1 : 1);
    }
  });

  els.graphSearchPrevButton.addEventListener("click", () => moveGraphSearch(-1));
  els.graphSearchNextButton.addEventListener("click", () => moveGraphSearch(1));

  els.traceForm.addEventListener("submit", (event) => {
    event.preventDefault();
    startTraceRun(els.traceCommandInput.value).catch(showError);
  });

  els.traceCommandClearButton.addEventListener("click", () => {
    els.traceCommandInput.value = "";
    els.traceCommandInput.focus();
  });

  els.traceStepReplayInput.addEventListener("change", () => {
    setStepReplay(els.traceStepReplayInput.checked);
  });

  els.filterRepoOnlyInput.addEventListener("change", () => {
    setTraceFilters({ repoOnly: els.filterRepoOnlyInput.checked });
  });
  els.filterCallsInput.addEventListener("change", () => {
    setTraceFilters({ calls: els.filterCallsInput.checked });
  });
  els.filterLinesInput.addEventListener("change", () => {
    setTraceFilters({ lines: els.filterLinesInput.checked });
  });
  els.filterImportsInput.addEventListener("change", () => {
    setTraceFilters({ imports: els.filterImportsInput.checked });
  });
  els.filterReturnsInput.addEventListener("change", () => {
    setTraceFilters({ returns: els.filterReturnsInput.checked });
  });
  els.filterOutputInput.addEventListener("change", () => {
    setTraceFilters({ output: els.filterOutputInput.checked });
  });
  els.filterExceptionsInput.addEventListener("change", () => {
    setTraceFilters({ exceptions: els.filterExceptionsInput.checked });
  });

  els.tracePositionSlider.addEventListener("input", () => {
    jumpTraceToIndex(Number(els.tracePositionSlider.value) - 1).catch(showError);
  });

  els.tracePositionInput.addEventListener("change", () => {
    jumpTraceToIndex(Number(els.tracePositionInput.value) - 1).catch(showError);
  });

  els.tracePositionInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      jumpTraceToIndex(Number(els.tracePositionInput.value) - 1).catch(showError);
    }
  });

  els.tracePrevButton.addEventListener("click", () => {
    moveTraceStep(-1).catch(showError);
  });

  els.traceNextButton.addEventListener("click", () => {
    moveTraceStep(1).catch(showError);
  });

  els.traceStopButton.addEventListener("click", () => {
    stopTraceRun().catch(showError);
  });

  els.editButton.addEventListener("click", () => {
    if (!state.currentFile) {
      return;
    }
    state.editing = true;
    els.codeEditor.value = state.currentContent;
    syncEditorMode();
    els.codeEditor.focus();
  });

  els.cancelButton.addEventListener("click", () => {
    state.editing = false;
    els.codeEditor.value = state.currentContent;
    syncEditorMode();
  });

  els.editorCloseButton.addEventListener("click", () => {
    state.editing = false;
    els.editorDrawer.classList.add("hidden");
    syncEditorMode();
  });

  els.saveButton.addEventListener("click", () => {
    saveCurrentFile().catch(showError);
  });

  els.editorPopoutButton.addEventListener("click", openEditorWindow);

  els.codeSearchInput.addEventListener(
    "input",
    debounce(() => updateCodeSearch(els.codeSearchInput.value), 120),
  );

  els.codeSearchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      moveCodeSearch(event.shiftKey ? -1 : 1);
    }
  });

  els.codeSearchPrevButton.addEventListener("click", () => moveCodeSearch(-1));
  els.codeSearchNextButton.addEventListener("click", () => moveCodeSearch(1));

  els.editorDragHandle.addEventListener("pointerdown", startDrawerDrag);
  els.editorResizeHandle.addEventListener("pointerdown", startDrawerResize);
  els.inspectorResizeHandle.addEventListener("pointerdown", startInspectorResize);

  els.terminalToggleButton.addEventListener("click", toggleShellPanel);
  els.terminalCloseButton.addEventListener("click", closeShellPanel);

  els.terminalStartButton.addEventListener("click", () => {
    openShellPanel();
    connectTerminal();
  });

  els.terminalClearButton.addEventListener("click", () => {
    ensureTerminal().clear();
  });

  els.graphSvg.addEventListener("pointerdown", startCanvasPan);
  els.graphSvg.addEventListener("pointermove", handlePointerMove);
  els.graphSvg.addEventListener("pointerup", handlePointerUp);
  els.graphSvg.addEventListener("pointerleave", handlePointerUp);
  document.addEventListener("pointermove", handleDocumentPointerMove);
  document.addEventListener("pointerup", handleDocumentPointerUp);
  window.addEventListener("resize", fitTerminal);

  els.browseCloseButton.addEventListener("click", closeBrowse);
  els.browseBackdrop.addEventListener("click", closeBrowse);
  els.browseHomeButton.addEventListener("click", () => loadBrowsePath(state.browseHome || "~").catch(showError));
  els.browseUpButton.addEventListener("click", () => {
    const current = state.browsePath || els.browsePathInput.value || "~";
    const parent = current.replace(/\/+$/, "").split("/").slice(0, -1).join("/") || "/";
    loadBrowsePath(parent).catch(showError);
  });
  els.browseGoButton.addEventListener("click", () => loadBrowsePath(els.browsePathInput.value).catch(showError));
  els.browseUseButton.addEventListener("click", () => {
    els.rootPathInput.value = state.browsePath;
    closeBrowse();
  });
  els.browseIndexButton.addEventListener("click", () => {
    els.rootPathInput.value = state.browsePath;
    closeBrowse();
    startIndex(state.browsePath);
  });
  els.browsePathInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      loadBrowsePath(els.browsePathInput.value).catch(showError);
    }
  });
}

async function boot() {
  bindEvents();
  loadTraceFilterSettings();
  try {
    setStepReplay(localStorage.getItem(STORAGE_KEYS.stepReplay) === "1");
  } catch {
    setStepReplay(false);
  }
  connectEvents();
  setMode("trace");

  try {
    await Promise.all([loadRecent(), loadProjects()]);
    await loadActiveProject();
    setStatus("Idle");
  } catch (error) {
    setStatus("Error", "error");
    els.graphMeta.textContent = error.message;
  }
}

boot();
