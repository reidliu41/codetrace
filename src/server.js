const crypto = require("crypto");
const fs = require("fs");
const fsp = fs.promises;
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const PUBLIC_ROOT = path.join(PROJECT_ROOT, "public");
const ANALYZER_PATH = path.join(PROJECT_ROOT, "src", "python", "analyze.py");
const TRACER_PATH = path.join(PROJECT_ROOT, "src", "python", "trace_run.py");
const RECENT_PATH = path.join(os.homedir(), ".codetrace", "recent.json");
const XTERM_JS_PATH = require.resolve("@xterm/xterm/lib/xterm.js");
const XTERM_CSS_PATH = path.join(path.dirname(path.dirname(XTERM_JS_PATH)), "css", "xterm.css");
const XTERM_FIT_JS_PATH = require.resolve("@xterm/addon-fit/lib/addon-fit.js");
const TRACE_EVENT_STORE_LIMIT = 30000;
const TRACE_EVENT_CAPTURE_LIMIT = 20000;

const EXCLUDED_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  ".tox",
  ".venv",
  "venv",
  "env",
  "__pycache__",
  "node_modules",
  "dist",
  "build",
  "site-packages",
]);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const projects = new Map();
const eventClients = new Set();
const terminalSessions = new Map();
const traceSessions = new Map();

let activeProjectId = null;
let indexingJob = null;

function hashText(text) {
  return crypto.createHash("sha1").update(text).digest("hex");
}

function projectIdForRoot(rootPath) {
  return hashText(rootPath).slice(0, 12);
}

function expandPath(inputPath) {
  if (!inputPath || typeof inputPath !== "string") {
    throw new Error("Directory is required.");
  }

  let normalized = inputPath.trim();
  if (!normalized) {
    throw new Error("Directory is required.");
  }

  if (normalized === "~") {
    normalized = os.homedir();
  } else if (normalized.startsWith("~/")) {
    normalized = path.join(os.homedir(), normalized.slice(2));
  }

  return path.resolve(normalized);
}

function compactProjectName(rootPath) {
  return path.basename(rootPath) || rootPath;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function readRequestJson(req, maxBytes = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;

    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error("Request body is too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("Invalid JSON request body."));
      }
    });

    req.on("error", reject);
  });
}

function emitEvent(type, payload) {
  const data = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of eventClients) {
    try {
      res.write(data);
    } catch {
      eventClients.delete(res);
    }
  }
}

async function loadRecentProjects() {
  try {
    const text = await fsp.readFile(RECENT_PATH, "utf8");
    const parsed = JSON.parse(text);
    return Array.isArray(parsed.projects) ? parsed.projects.slice(0, 20) : [];
  } catch {
    return [];
  }
}

async function saveRecentProject(rootPath) {
  const projectsList = await loadRecentProjects();
  const next = [rootPath, ...projectsList.filter((project) => project !== rootPath)].slice(0, 20);
  await fsp.mkdir(path.dirname(RECENT_PATH), { recursive: true });
  await fsp.writeFile(RECENT_PATH, JSON.stringify({ projects: next }, null, 2), "utf8");
  return next;
}

function isPythonFile(filePath) {
  return filePath.endsWith(".py") || filePath.endsWith(".pyw");
}

async function scanPythonFiles(rootPath, onProgress) {
  const files = [];
  const rootRealPath = await fsp.realpath(rootPath);

  async function walk(directory) {
    let entries;
    try {
      entries = await fsp.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRS.has(entry.name)) {
          await walk(fullPath);
        }
      } else if (entry.isFile() && isPythonFile(entry.name)) {
        files.push(fullPath);
        if (files.length % 100 === 0) {
          onProgress({
            phase: "scan",
            message: `Found ${files.length} Python files`,
            fileCount: files.length,
          });
        }
      }
    }
  }

  await walk(rootRealPath);
  return files;
}

function runPythonAnalyzer(rootPath, files, onProgress) {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", [ANALYZER_PATH], {
      cwd: PROJECT_ROOT,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const stdout = [];
    const stderr = [];
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill("SIGTERM");
        reject(new Error("Python analyzer timed out."));
      }
    }, 10 * 60 * 1000);

    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    });

    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);

      const errorText = Buffer.concat(stderr).toString("utf8").trim();
      if (code !== 0) {
        reject(new Error(errorText || `Python analyzer exited with code ${code}.`));
        return;
      }

      try {
        resolve(JSON.parse(Buffer.concat(stdout).toString("utf8")));
      } catch (error) {
        reject(new Error(`Python analyzer returned invalid JSON. ${errorText || error.message}`));
      }
    });

    onProgress({
      phase: "analyze",
      message: `Analyzing ${files.length} Python files`,
      fileCount: files.length,
    });

    child.stdin.end(JSON.stringify({ rootPath, files }));
  });
}

function createSearchText(item) {
  return `${item.name || ""} ${item.qualifiedName || ""} ${item.relativePath || ""}`.toLowerCase();
}

function scoreSearch(item, query) {
  if (!query) {
    return 1;
  }

  const haystack = item.searchText || createSearchText(item);
  const name = (item.name || "").toLowerCase();
  const qualifiedName = (item.qualifiedName || "").toLowerCase();

  if (name === query || qualifiedName === query) {
    return 1000;
  }
  if (name.startsWith(query)) {
    return 800 - name.length;
  }
  if (qualifiedName.includes(`.${query}`)) {
    return 650 - qualifiedName.length;
  }
  if (haystack.includes(query)) {
    return 400 - haystack.length / 20;
  }

  let cursor = 0;
  for (const char of query) {
    cursor = haystack.indexOf(char, cursor);
    if (cursor === -1) {
      return 0;
    }
    cursor += 1;
  }
  return 120 - haystack.length / 50;
}

function normalizeKindForTarget(edgeType, targetName = "") {
  if (edgeType === "import") {
    return "module";
  }
  if (edgeType === "inherits" || edgeType === "uses_class") {
    return "class";
  }
  const last = targetName.split(".").filter(Boolean).pop() || "";
  return last && /^[A-Z]/.test(last) ? "class" : "function";
}

function normalizeGraphId(id) {
  return String(id).replace(/[^a-zA-Z0-9_.:/-]/g, "_");
}

function symbolGraphId(symbolId) {
  return `symbol:${symbolId}`;
}

function fileGraphId(fileId) {
  return `file:${fileId}`;
}

function dirGraphId(relativePath) {
  return `dir:${relativePath || "."}`;
}

function parseGraphSymbolId(value) {
  const text = String(value || "");
  if (text.startsWith("symbol:")) {
    return Number(text.slice("symbol:".length)) || 0;
  }
  return Number(text) || 0;
}

function buildDirectoryTree(files) {
  const dirs = new Map();

  function ensureDir(relativePath) {
    const key = relativePath || ".";
    if (dirs.has(key)) {
      return dirs.get(key);
    }

    const parts = key === "." ? [] : key.split("/");
    const parentPath = parts.length <= 1 ? "." : parts.slice(0, -1).join("/");
    const dir = {
      relativePath: key,
      name: parts.length ? parts[parts.length - 1] : "",
      parentPath: key === "." ? null : parentPath,
      childDirs: new Set(),
      files: [],
    };
    dirs.set(key, dir);

    if (key !== ".") {
      const parent = ensureDir(parentPath);
      parent.childDirs.add(key);
    }

    return dir;
  }

  ensureDir(".");

  for (const file of files) {
    const relativePath = file.relativePath.replaceAll(path.sep, "/");
    const parts = relativePath.split("/");
    const dirPath = parts.length > 1 ? parts.slice(0, -1).join("/") : ".";
    const dir = ensureDir(dirPath);
    dir.files.push(file.id);
  }

  for (const dir of dirs.values()) {
    dir.childDirs = [...dir.childDirs].sort((a, b) => a.localeCompare(b));
    dir.files.sort((a, b) => a - b);
  }

  return dirs;
}

function buildIndex(rootPath, analysis) {
  let nextFileId = 1;
  let nextSymbolId = 1;
  let nextEdgeId = 1;

  const files = [];
  const fileByPath = new Map();
  const fileByModuleName = new Map();

  for (const file of analysis.files || []) {
    const item = {
      id: nextFileId++,
      path: file.path,
      relativePath: file.relativePath,
      moduleName: file.moduleName,
      lineCount: file.lineCount || 0,
      hash: file.hash || "",
    };
    item.searchText = `${item.relativePath} ${item.moduleName}`.toLowerCase();
    files.push(item);
    fileByPath.set(item.path, item);
    fileByModuleName.set(item.moduleName, item);
  }

  const symbols = [];
  const symbolByQualifiedName = new Map();
  const symbolsByName = new Map();

  function addSymbol(raw) {
    const file = raw.filePath ? fileByPath.get(raw.filePath) : null;
    const qualifiedName = raw.qualifiedName || raw.name;
    if (symbolByQualifiedName.has(qualifiedName)) {
      return symbolByQualifiedName.get(qualifiedName);
    }

    const symbol = {
      id: nextSymbolId++,
      fileId: file ? file.id : null,
      kind: raw.kind || "symbol",
      name: raw.name || qualifiedName,
      qualifiedName,
      parentQualifiedName: raw.parentQualifiedName || null,
      parentId: null,
      external: Boolean(raw.external),
      startLine: raw.startLine || 1,
      startCol: raw.startCol || 1,
      endLine: raw.endLine || raw.startLine || 1,
      endCol: raw.endCol || raw.startCol || 1,
    };
    symbol.searchText = createSearchText(symbol);
    symbols.push(symbol);
    symbolByQualifiedName.set(symbol.qualifiedName, symbol);

    const byName = symbolsByName.get(symbol.name) || [];
    byName.push(symbol);
    symbolsByName.set(symbol.name, byName);

    return symbol;
  }

  for (const symbol of analysis.symbols || []) {
    addSymbol(symbol);
  }

  for (const symbol of symbols) {
    if (symbol.parentQualifiedName) {
      const parent = symbolByQualifiedName.get(symbol.parentQualifiedName);
      if (parent) {
        symbol.parentId = parent.id;
      }
    }
  }

  function resolveTarget(rawEdge) {
    const candidates = [];
    if (rawEdge.targetQualifiedName) {
      candidates.push(rawEdge.targetQualifiedName);
    }
    if (rawEdge.targetName) {
      candidates.push(rawEdge.targetName);

      const parts = rawEdge.targetName.split(".").filter(Boolean);
      for (let length = parts.length - 1; length > 0; length -= 1) {
        candidates.push(parts.slice(0, length).join("."));
      }

      const lastPart = parts[parts.length - 1];
      if (lastPart && lastPart !== rawEdge.targetName) {
        candidates.push(lastPart);
      }
    }

    for (const candidate of candidates) {
      const exact = symbolByQualifiedName.get(candidate);
      if (exact) {
        return exact;
      }
    }

    const lastName = (rawEdge.targetName || rawEdge.targetQualifiedName || "unknown")
      .split(".")
      .filter(Boolean)
      .pop();
    if (lastName) {
      const matches = symbolsByName.get(lastName) || [];
      if (matches.length === 1) {
        return matches[0];
      }
    }

    return addSymbol({
      kind: normalizeKindForTarget(rawEdge.type, rawEdge.targetName),
      name: lastName || rawEdge.targetName || "unknown",
      qualifiedName: `external:${rawEdge.type}:${rawEdge.targetName || lastName || "unknown"}`,
      external: true,
    });
  }

  const edges = [];

  function addEdge(raw) {
    const source = symbolByQualifiedName.get(raw.sourceQualifiedName);
    if (!source) {
      return;
    }

    const target = resolveTarget(raw);
    const file = raw.filePath ? fileByPath.get(raw.filePath) : null;
    const type = raw.type === "calls" && target.kind === "class" ? "uses_class" : raw.type || "reference";
    edges.push({
      id: nextEdgeId++,
      type,
      sourceId: source.id,
      targetId: target.id,
      fileId: file ? file.id : source.fileId,
      line: raw.line || 1,
      col: raw.col || 1,
      label: raw.label || raw.targetName || target.name,
    });
  }

  for (const symbol of symbols) {
    if (symbol.parentId) {
      edges.push({
        id: nextEdgeId++,
        type: "contains",
        sourceId: symbol.parentId,
        targetId: symbol.id,
        fileId: symbol.fileId,
        line: symbol.startLine,
        col: symbol.startCol,
        label: symbol.kind,
      });
    }
  }

  for (const edge of analysis.edges || []) {
    addEdge(edge);
  }

  const index = {
    rootPath,
    indexedAt: new Date().toISOString(),
    files,
    symbols,
    edges,
    errors: analysis.errors || [],
    stats: {
      files: files.length,
      symbols: symbols.filter((symbol) => !symbol.external).length,
      externalSymbols: symbols.filter((symbol) => symbol.external).length,
      edges: edges.length,
      errors: (analysis.errors || []).length,
    },
  };

  index.symbolById = new Map(symbols.map((symbol) => [symbol.id, symbol]));
  index.fileById = new Map(files.map((file) => [file.id, file]));
  index.fileByModuleName = fileByModuleName;
  index.symbolsByFileId = new Map();
  index.childSymbolsByParentId = new Map();
  index.edgesBySymbolId = new Map();
  index.dirByPath = buildDirectoryTree(files);

  for (const symbol of symbols) {
    if (symbol.fileId) {
      const list = index.symbolsByFileId.get(symbol.fileId) || [];
      list.push(symbol);
      index.symbolsByFileId.set(symbol.fileId, list);
    }
    if (symbol.parentId) {
      const children = index.childSymbolsByParentId.get(symbol.parentId) || [];
      children.push(symbol);
      index.childSymbolsByParentId.set(symbol.parentId, children);
    }
  }

  for (const edge of edges) {
    for (const id of [edge.sourceId, edge.targetId]) {
      const list = index.edgesBySymbolId.get(id) || [];
      list.push(edge);
      index.edgesBySymbolId.set(id, list);
    }
  }

  for (const list of index.symbolsByFileId.values()) {
    list.sort((a, b) => a.startLine - b.startLine || a.name.localeCompare(b.name));
  }
  for (const list of index.childSymbolsByParentId.values()) {
    list.sort((a, b) => a.startLine - b.startLine || a.name.localeCompare(b.name));
  }

  return index;
}

function serializeProject(project, includeIndex = true, options = {}) {
  if (!project || !project.index) {
    return {
      id: null,
      name: null,
      rootPath: null,
      indexedAt: null,
      stats: { files: 0, symbols: 0, externalSymbols: 0, edges: 0, errors: 0 },
      files: [],
      symbols: [],
      edges: [],
      errors: [],
    };
  }

  const payload = {
    id: project.id,
    name: project.name,
    rootPath: project.rootPath,
    indexedAt: project.index.indexedAt,
    stats: project.index.stats,
  };

  if (includeIndex) {
    const include = options.include || "all";
    if (include === "files") {
      payload.files = project.index.files;
      payload.symbols = [];
      payload.edges = [];
      payload.errors = project.index.errors;
    } else {
      payload.files = project.index.files;
      payload.symbols = project.index.symbols;
      payload.edges = project.index.edges;
      payload.errors = project.index.errors;
    }
  }

  return payload;
}

function getActiveProject() {
  if (activeProjectId && projects.has(activeProjectId)) {
    return projects.get(activeProjectId);
  }
  return projects.values().next().value || null;
}

function getProjectById(projectId) {
  if (projectId && projects.has(projectId)) {
    return projects.get(projectId);
  }
  return getActiveProject();
}

function requireProject(projectId) {
  const project = getProjectById(projectId);
  if (!project || !project.index) {
    throw new Error("No project indexed.");
  }
  return project;
}

function serializeProjectList() {
  return [...projects.values()].map((project) => serializeProject(project, false));
}

function renameLoadedProject(projectId, name) {
  const project = requireProject(projectId);
  const nextName = String(name || "").trim();
  if (!nextName) {
    throw new Error("Project name is required.");
  }
  project.name = nextName;
  return project;
}

function removeLoadedProject(projectId) {
  const project = requireProject(projectId);
  const terminalSession = terminalSessions.get(project.id);
  if (terminalSession && !terminalSession.exited) {
    terminalSession.child.kill("SIGTERM");
  }
  terminalSessions.delete(project.id);
  stopTraceSession(project.id);
  traceSessions.delete(project.id);
  projects.delete(project.id);
  if (activeProjectId === project.id) {
    activeProjectId = projects.keys().next().value || null;
  }
  return project;
}

function searchProject(project, query) {
  const index = project.index;
  const normalized = (query || "").trim().toLowerCase();
  const results = [];

  for (const symbol of index.symbols) {
    if (symbol.external && normalized.length < 2) {
      continue;
    }
    const score = scoreSearch(symbol, normalized);
    if (score > 0) {
      results.push({ type: "symbol", score, item: symbol });
    }
  }

  for (const file of index.files) {
    const item = {
      ...file,
      kind: "file",
      name: file.relativePath,
      qualifiedName: file.relativePath,
      searchText: file.searchText,
    };
    const score = scoreSearch(item, normalized);
    if (score > 0) {
      results.push({ type: "file", score: score - 20, item });
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, 80);
}

function graphNode(base) {
  return {
    id: normalizeGraphId(base.id),
    entityType: base.entityType || base.kind || "symbol",
    kind: base.kind || base.entityType || "symbol",
    name: base.name || "",
    qualifiedName: base.qualifiedName || base.name || "",
    external: Boolean(base.external),
    selected: Boolean(base.selected),
    fileId: base.fileId || null,
    symbolId: base.symbolId || null,
    relativePath: base.relativePath || null,
    depth: base.depth || 0,
    expanded: Boolean(base.expanded),
    childCount: base.childCount || 0,
    line: base.line || null,
  };
}

function graphEdge(base) {
  return {
    id: normalizeGraphId(base.id),
    type: base.type || "reference",
    sourceId: normalizeGraphId(base.sourceId),
    targetId: normalizeGraphId(base.targetId),
    label: base.label || base.type || "",
    fileId: base.fileId || null,
    line: base.line || null,
    col: base.col || null,
  };
}

function serializeSymbolNode(symbol, selectedId = null, options = {}) {
  return graphNode({
    id: symbolGraphId(symbol.id),
    entityType: "symbol",
    kind: symbol.kind,
    name: symbol.name,
    qualifiedName: symbol.qualifiedName,
    external: symbol.external,
    selected: symbol.id === selectedId,
    fileId: symbol.fileId,
    symbolId: symbol.id,
    line: symbol.startLine,
    depth: options.depth || 0,
    expanded: options.expanded || false,
    childCount: options.childCount || 0,
  });
}

function parseExpanded(raw) {
  const expanded = new Set(["."]);
  for (const value of String(raw || "")
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean)) {
    expanded.add(value || ".");
    if (value && value !== ".") {
      const parts = value.split("/");
      while (parts.length > 1) {
        parts.pop();
        expanded.add(parts.join("/") || ".");
      }
    }
  }
  return expanded;
}

function treeGraph(project, expandedRaw) {
  const index = project.index;
  const expanded = parseExpanded(expandedRaw);
  const nodes = new Map();
  const edges = new Map();
  let limited = false;
  const maxChildrenPerNode = 140;

  function topLevelSymbolsForFile(fileId) {
    const moduleSymbol = (index.symbolsByFileId.get(fileId) || []).find((symbol) => symbol.kind === "module");
    if (moduleSymbol) {
      return (index.childSymbolsByParentId.get(moduleSymbol.id) || []).filter((symbol) => !symbol.external);
    }
    return (index.symbolsByFileId.get(fileId) || []).filter(
      (symbol) => !symbol.external && symbol.kind !== "module" && !symbol.parentId,
    );
  }

  function childSymbolsForSymbol(symbolId) {
    return (index.childSymbolsByParentId.get(symbolId) || []).filter((symbol) => !symbol.external);
  }

  function addDir(relativePath) {
    const dir = index.dirByPath.get(relativePath);
    if (!dir) {
      return;
    }
    const id = dirGraphId(relativePath);
    nodes.set(
      id,
      graphNode({
        id,
        entityType: "directory",
        kind: "directory",
        name: relativePath === "." ? project.name : dir.name,
        qualifiedName: relativePath === "." ? project.rootPath : relativePath,
        relativePath,
        depth: relativePath === "." ? 0 : relativePath.split("/").length,
        expanded: expanded.has(relativePath),
        childCount: dir.childDirs.length + dir.files.length,
      }),
    );
  }

  function addFile(fileId, depth) {
    const file = index.fileById.get(fileId);
    if (!file) {
      return;
    }
    const id = fileGraphId(file.id);
    const children = topLevelSymbolsForFile(file.id);
    nodes.set(
      id,
      graphNode({
        id,
        entityType: "file",
        kind: "module",
        name: path.basename(file.relativePath),
        qualifiedName: file.relativePath,
        relativePath: file.relativePath,
        fileId: file.id,
        depth,
        expanded: expanded.has(id),
        childCount: children.length,
      }),
    );
  }

  function addSymbol(symbol, depth) {
    const id = symbolGraphId(symbol.id);
    const children = childSymbolsForSymbol(symbol.id);
    nodes.set(
      id,
      serializeSymbolNode(symbol, null, {
        depth,
        expanded: expanded.has(id),
        childCount: children.length,
      }),
    );
  }

  function addContainsEdge(sourceId, targetId, label, fileId = null) {
    edges.set(
      `${sourceId}->${targetId}`,
      graphEdge({
        id: `tree:${sourceId}->${targetId}`,
        type: "contains",
        sourceId,
        targetId,
        label,
        fileId,
      }),
    );
  }

  addDir(".");

  const dirsToRender = [...expanded].filter((relativePath) => index.dirByPath.has(relativePath));
  for (const relativePath of dirsToRender) {
    addDir(relativePath);
    const dir = index.dirByPath.get(relativePath);
    if (!dir || !expanded.has(relativePath)) {
      continue;
    }
    const sourceId = dirGraphId(relativePath);
    const nextDepth = relativePath === "." ? 1 : relativePath.split("/").length + 1;

    for (const childPath of dir.childDirs) {
      addDir(childPath);
      const targetId = dirGraphId(childPath);
      addContainsEdge(sourceId, targetId, "dir");
    }

    for (const fileId of dir.files) {
      addFile(fileId, nextDepth);
      const targetId = fileGraphId(fileId);
      addContainsEdge(sourceId, targetId, "module", fileId);
    }
  }

  const expandedFiles = [...expanded]
    .filter((id) => id.startsWith("file:"))
    .map((id) => Number(id.slice("file:".length)))
    .filter((id) => index.fileById.has(id));

  for (const fileId of expandedFiles) {
    const fileNodeId = fileGraphId(fileId);
    if (!nodes.has(fileNodeId)) {
      addFile(fileId, 1);
    }
    const fileNode = nodes.get(fileNodeId);
    const depth = (fileNode?.depth || 0) + 1;
    const children = topLevelSymbolsForFile(fileId);
    if (children.length > maxChildrenPerNode) {
      limited = true;
    }
    for (const symbol of children.slice(0, maxChildrenPerNode)) {
      addSymbol(symbol, depth);
      addContainsEdge(fileNodeId, symbolGraphId(symbol.id), symbol.kind, fileId);
    }
  }

  const expandedSymbols = [...expanded]
    .filter((id) => id.startsWith("symbol:"))
    .map((id) => Number(id.slice("symbol:".length)))
    .filter((id) => index.symbolById.has(id));

  for (const symbolId of expandedSymbols) {
    const symbol = index.symbolById.get(symbolId);
    const symbolNodeId = symbolGraphId(symbolId);
    if (!nodes.has(symbolNodeId)) {
      addSymbol(symbol, 1);
    }
    const symbolNode = nodes.get(symbolNodeId);
    const depth = (symbolNode?.depth || 0) + 1;
    const children = childSymbolsForSymbol(symbolId);
    if (children.length > maxChildrenPerNode) {
      limited = true;
    }
    for (const child of children.slice(0, maxChildrenPerNode)) {
      addSymbol(child, depth);
      addContainsEdge(symbolNodeId, symbolGraphId(child.id), child.kind, child.fileId);
    }
  }

  return {
    mode: "tree",
    title: "Structure",
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    limited,
  };
}

function moduleGraph(project, focusFileId = 0) {
  const index = project.index;
  const nodes = new Map();
  const edges = new Map();
  const maxNodes = focusFileId ? 90 : 140;

  function addFile(fileId, selected = false) {
    const file = index.fileById.get(fileId);
    if (!file) {
      return;
    }
    const id = fileGraphId(file.id);
    const previous = nodes.get(id);
    nodes.set(
      id,
      graphNode({
        id,
        entityType: "file",
        kind: "module",
        name: file.moduleName || path.basename(file.relativePath),
        qualifiedName: file.relativePath,
        relativePath: file.relativePath,
        fileId: file.id,
        selected: selected || Boolean(previous && previous.selected),
      }),
    );
  }

  for (const edge of index.edges) {
    if (edge.type !== "import") {
      continue;
    }
    const source = index.symbolById.get(edge.sourceId);
    const target = index.symbolById.get(edge.targetId);
    if (!source || !target || !source.fileId || !target.fileId || source.fileId === target.fileId) {
      continue;
    }
    if (focusFileId && source.fileId !== focusFileId && target.fileId !== focusFileId) {
      continue;
    }

    addFile(source.fileId, source.fileId === focusFileId);
    addFile(target.fileId, target.fileId === focusFileId);
    const edgeKey = `${source.fileId}->${target.fileId}`;
    const existing = edges.get(edgeKey);
    if (existing) {
      existing.label = `${Number(existing.label || 1) + 1}`;
    } else {
      edges.set(
        edgeKey,
        graphEdge({
          id: `module:${edgeKey}`,
          type: "import",
          sourceId: fileGraphId(source.fileId),
          targetId: fileGraphId(target.fileId),
          label: "1",
          fileId: edge.fileId,
          line: edge.line,
          col: edge.col,
        }),
      );
    }
  }

  if (!nodes.size) {
    for (const file of index.files.slice(0, maxNodes)) {
      addFile(file.id, file.id === focusFileId);
    }
  }

  let limited = false;
  let visibleNodes = [...nodes.values()].sort((a, b) => {
    if (a.selected) {
      return -1;
    }
    if (b.selected) {
      return 1;
    }
    return String(a.qualifiedName).localeCompare(String(b.qualifiedName));
  });

  if (visibleNodes.length > maxNodes) {
    limited = true;
    visibleNodes = visibleNodes.slice(0, maxNodes);
  }

  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = [...edges.values()].filter(
    (edge) => visibleIds.has(edge.sourceId) && visibleIds.has(edge.targetId),
  );

  return {
    mode: "modules",
    title: focusFileId ? "Module Neighborhood" : "Module Dependencies",
    nodes: visibleNodes,
    edges: visibleEdges.slice(0, focusFileId ? 140 : 220),
    limited: limited || visibleEdges.length > (focusFileId ? 140 : 220),
  };
}

function addSymbolEdge(index, edge, nodes, edges, selectedId = null) {
  const source = index.symbolById.get(edge.sourceId);
  const target = index.symbolById.get(edge.targetId);
  if (!source || !target) {
    return;
  }
  nodes.set(symbolGraphId(source.id), serializeSymbolNode(source, selectedId));
  nodes.set(symbolGraphId(target.id), serializeSymbolNode(target, selectedId));
  edges.set(
    edge.id,
    graphEdge({
      id: `edge:${edge.id}`,
      type: edge.type,
      sourceId: symbolGraphId(source.id),
      targetId: symbolGraphId(target.id),
      label: edge.label,
      fileId: edge.fileId,
      line: edge.line,
      col: edge.col,
    }),
  );
}

function functionGraph(project, symbolId = 0, fileId = 0) {
  const index = project.index;
  const nodes = new Map();
  const edges = new Map();
  const allowedKinds = new Set(["function", "method"]);
  const maxNodes = symbolId || fileId ? 90 : 120;

  if (symbolId) {
    const selected = index.symbolById.get(symbolId);
    if (selected) {
      nodes.set(symbolGraphId(selected.id), serializeSymbolNode(selected, selected.id));
      for (const edge of index.edgesBySymbolId.get(selected.id) || []) {
        if (edge.type === "calls") {
          addSymbolEdge(index, edge, nodes, edges, selected.id);
        }
      }
    }
  } else if (fileId) {
    const fileSymbols = (index.symbolsByFileId.get(fileId) || []).filter((symbol) =>
      allowedKinds.has(symbol.kind),
    );
    for (const symbol of fileSymbols.slice(0, maxNodes)) {
      nodes.set(symbolGraphId(symbol.id), serializeSymbolNode(symbol, null));
    }
    const nodeIds = new Set([...nodes.keys()]);
    for (const edge of index.edges) {
      if (edge.type !== "calls") {
        continue;
      }
      const sourceId = symbolGraphId(edge.sourceId);
      const targetId = symbolGraphId(edge.targetId);
      if (nodeIds.has(sourceId) && nodeIds.has(targetId)) {
        addSymbolEdge(index, edge, nodes, edges, null);
      }
    }
  } else {
    const symbols = index.symbols
      .filter((symbol) => !symbol.external && allowedKinds.has(symbol.kind))
      .sort((a, b) => a.qualifiedName.localeCompare(b.qualifiedName))
      .slice(0, maxNodes);
    for (const symbol of symbols) {
      nodes.set(symbolGraphId(symbol.id), serializeSymbolNode(symbol, null));
    }
  }

  const visibleNodes = [...nodes.values()].slice(0, maxNodes);
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = [...edges.values()].filter(
    (edge) => visibleIds.has(edge.sourceId) && visibleIds.has(edge.targetId),
  );

  return {
    mode: "functions",
    title: symbolId ? "Function Calls" : fileId ? "File Functions" : "Functions",
    nodes: visibleNodes,
    edges: visibleEdges.slice(0, 160),
    limited: nodes.size > maxNodes || visibleEdges.length > 160,
  };
}

function classGraph(project, symbolId = 0, fileId = 0) {
  const index = project.index;
  const nodes = new Map();
  const edges = new Map();
  const maxNodes = symbolId || fileId ? 100 : 120;
  const classEdges = new Set(["inherits", "uses_class"]);

  if (symbolId) {
    const selected = index.symbolById.get(symbolId);
    if (selected) {
      nodes.set(symbolGraphId(selected.id), serializeSymbolNode(selected, selected.id));
      for (const edge of index.edgesBySymbolId.get(selected.id) || []) {
        if (classEdges.has(edge.type)) {
          addSymbolEdge(index, edge, nodes, edges, selected.id);
        }
      }
    }
  } else if (fileId) {
    for (const symbol of index.symbolsByFileId.get(fileId) || []) {
      if (symbol.kind === "class") {
        nodes.set(symbolGraphId(symbol.id), serializeSymbolNode(symbol, null));
      }
    }
    for (const edge of index.edges) {
      if (!classEdges.has(edge.type)) {
        continue;
      }
      const source = index.symbolById.get(edge.sourceId);
      const target = index.symbolById.get(edge.targetId);
      if ((source && source.fileId === fileId) || (target && target.fileId === fileId)) {
        addSymbolEdge(index, edge, nodes, edges, null);
      }
    }
  } else {
    const classes = index.symbols
      .filter((symbol) => !symbol.external && symbol.kind === "class")
      .sort((a, b) => a.qualifiedName.localeCompare(b.qualifiedName))
      .slice(0, maxNodes);
    for (const symbol of classes) {
      nodes.set(symbolGraphId(symbol.id), serializeSymbolNode(symbol, null));
    }
    const classNodeIds = new Set([...nodes.keys()]);
    for (const edge of index.edges) {
      if (edge.type !== "inherits") {
        continue;
      }
      const sourceId = symbolGraphId(edge.sourceId);
      const targetId = symbolGraphId(edge.targetId);
      if (classNodeIds.has(sourceId) && classNodeIds.has(targetId)) {
        addSymbolEdge(index, edge, nodes, edges, null);
      }
    }
  }

  const visibleNodes = [...nodes.values()].slice(0, maxNodes);
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = [...edges.values()].filter(
    (edge) => visibleIds.has(edge.sourceId) && visibleIds.has(edge.targetId),
  );

  return {
    mode: "classes",
    title: symbolId ? "Class Usage" : fileId ? "File Classes" : "Classes",
    nodes: visibleNodes,
    edges: visibleEdges.slice(0, 180),
    limited: nodes.size > maxNodes || visibleEdges.length > 180,
  };
}

function graphForProject(project, url) {
  const mode = url.searchParams.get("mode") || "tree";
  const symbolId = parseGraphSymbolId(url.searchParams.get("symbolId") || "");
  const fileId = Number(url.searchParams.get("fileId") || 0);

  if (mode === "modules") {
    return moduleGraph(project, fileId);
  }
  if (mode === "functions") {
    return functionGraph(project, symbolId, fileId);
  }
  if (mode === "classes") {
    return classGraph(project, symbolId, fileId);
  }
  return treeGraph(project, url.searchParams.get("expanded") || ".");
}

async function listFileSystem(inputPath) {
  const resolvedPath = expandPath(inputPath || "~");
  const stat = await fsp.stat(resolvedPath);
  if (!stat.isDirectory()) {
    throw new Error("Selected path is not a directory.");
  }

  const entries = [];
  const dirents = await fsp.readdir(resolvedPath, { withFileTypes: true });

  for (const entry of dirents) {
    if (entry.name === "." || entry.name === "..") {
      continue;
    }
    if (!entry.isDirectory() && !entry.isFile()) {
      continue;
    }
    entries.push({
      name: entry.name,
      path: path.join(resolvedPath, entry.name),
      type: entry.isDirectory() ? "directory" : "file",
      python: entry.isFile() && isPythonFile(entry.name),
      excluded: entry.isDirectory() && EXCLUDED_DIRS.has(entry.name),
    });
  }

  entries.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === "directory" ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  return {
    path: resolvedPath,
    parentPath: path.dirname(resolvedPath),
    homePath: os.homedir(),
    entries,
  };
}

async function startIndexing(rootPath) {
  if (indexingJob) {
    throw new Error("Indexing is already running.");
  }

  const resolvedRoot = expandPath(rootPath);
  const stat = await fsp.stat(resolvedRoot);
  if (!stat.isDirectory()) {
    throw new Error("Selected path is not a directory.");
  }

  const projectId = projectIdForRoot(resolvedRoot);
  indexingJob = {
    projectId,
    rootPath: resolvedRoot,
    startedAt: new Date().toISOString(),
    phase: "scan",
    message: "Scanning Python files",
  };
  emitEvent("indexing", indexingJob);

  try {
    const progress = (payload) => {
      indexingJob = { ...indexingJob, ...payload };
      emitEvent("indexing", indexingJob);
    };

    const files = await scanPythonFiles(resolvedRoot, progress);
    progress({
      phase: "analyze",
      message: files.length ? `Analyzing ${files.length} Python files` : "No Python files found",
      fileCount: files.length,
    });

    const analysis = files.length
      ? await runPythonAnalyzer(resolvedRoot, files, progress)
      : {
          files: [],
          symbols: [],
          edges: [],
          errors: [],
        };

    progress({ phase: "build", message: "Building project model" });

    const index = buildIndex(resolvedRoot, analysis);
    const project = {
      id: projectId,
      name: compactProjectName(resolvedRoot),
      rootPath: resolvedRoot,
      index,
    };
    projects.set(projectId, project);
    activeProjectId = projectId;
    await saveRecentProject(resolvedRoot);

    const payload = serializeProject(project, true, { include: "files" });
    indexingJob = null;
    emitEvent("ready", payload);
    return payload;
  } catch (error) {
    indexingJob = null;
    emitEvent("index-error", { projectId, rootPath: resolvedRoot, error: error.message });
    throw error;
  }
}

function createTerminalSession(project) {
  const existing = terminalSessions.get(project.id);
  if (existing && !existing.exited) {
    return existing;
  }

  const shell = process.env.SHELL || "/bin/bash";
  const hasScriptCommand = fs.existsSync("/usr/bin/script") || fs.existsSync("/bin/script");
  const command = hasScriptCommand ? "script" : shell;
  const args = hasScriptCommand ? ["-q", "-f", "/dev/null", "-c", `${shell} -i`] : ["-i"];
  const child = spawn(command, args, {
    cwd: project.rootPath,
    env: { ...process.env, TERM: process.env.TERM || "xterm-256color" },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const session = {
    projectId: project.id,
    child,
    clients: new Set(),
    buffer: [],
    exited: false,
  };

  function push(stream, text) {
    const payload = { stream, text };
    session.buffer.push(payload);
    if (session.buffer.length > 200) {
      session.buffer.shift();
    }
    const data = `event: output\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const res of session.clients) {
      try {
        res.write(data);
      } catch {
        session.clients.delete(res);
      }
    }
  }

  child.stdout.on("data", (chunk) => push("stdout", chunk.toString("utf8")));
  child.stderr.on("data", (chunk) => push("stderr", chunk.toString("utf8")));
  child.on("close", (code) => {
    session.exited = true;
    push("system", `\r\n[process exited with code ${code}]\r\n`);
    terminalSessions.delete(project.id);
  });
  child.on("error", (error) => {
    session.exited = true;
    push("system", `\r\n[terminal error: ${error.message}]\r\n`);
    terminalSessions.delete(project.id);
  });

  terminalSessions.set(project.id, session);
  push("system", `[cwd] ${project.rootPath}\r\n`);
  return session;
}

async function handleTerminalEvents(req, res, project) {
  const session = createTerminalSession(project);
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
  });
  session.clients.add(res);
  res.write(`event: hello\ndata: ${JSON.stringify({ ok: true, projectId: project.id })}\n\n`);
  for (const entry of session.buffer) {
    res.write(`event: output\ndata: ${JSON.stringify(entry)}\n\n`);
  }
  req.on("close", () => session.clients.delete(res));
}

function parseCommand(command) {
  const input = String(command || "").trim();
  if (!input) {
    throw new Error("Trace command is required.");
  }

  const args = [];
  let current = "";
  let quote = "";
  let escape = false;

  for (const char of input) {
    if (escape) {
      current += char;
      escape = false;
      continue;
    }
    if (char === "\\") {
      escape = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = "";
      } else {
        current += char;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (quote) {
    throw new Error("Trace command has an unterminated quote.");
  }
  if (escape) {
    current += "\\";
  }
  if (current) {
    args.push(current);
  }
  return args;
}

function isPythonCommand(commandPath) {
  const name = path.basename(String(commandPath || "")).toLowerCase();
  return /^python(?:\d+(?:\.\d+)?)?(?:\.exe)?$/.test(name);
}

function pythonFromShebang(scriptPath) {
  try {
    const resolvedPath = path.resolve(scriptPath);
    const stat = fs.statSync(resolvedPath);
    if (!stat.isFile()) {
      return null;
    }
    const content = fs.readFileSync(resolvedPath, "utf8").slice(0, 300);
    if (!content.startsWith("#!")) {
      return null;
    }
    const line = content.split(/\r?\n/, 1)[0].slice(2).trim();
    const parts = parseCommand(line);
    if (!parts.length) {
      return null;
    }
    if (path.basename(parts[0]) === "env") {
      return parts.find((part) => isPythonCommand(part)) || null;
    }
    return isPythonCommand(parts[0]) ? parts[0] : null;
  } catch {
    return null;
  }
}

function traceLaunchForCommand(argv) {
  if (!argv.length) {
    return { interpreter: "python3", pythonPathMode: "project" };
  }
  if (isPythonCommand(argv[0])) {
    return { interpreter: argv[0], pythonPathMode: "project" };
  }
  const first = path.isAbsolute(argv[0]) ? argv[0] : path.resolve(argv[0]);
  const interpreter = pythonFromShebang(first);
  if (interpreter) {
    return { interpreter, pythonPathMode: "console-script" };
  }
  return { interpreter: "python3", pythonPathMode: "project" };
}

function emitTraceEvent(session, payload) {
  const event = {
    projectId: session.projectId,
    traceId: session.traceId,
    ...payload,
  };
  session.events.push(event);
  if (session.events.length > TRACE_EVENT_STORE_LIMIT) {
    session.events.shift();
  }
  const data = `event: trace\ndata: ${JSON.stringify(event)}\n\n`;
  for (const res of session.clients) {
    try {
      res.write(data);
    } catch {
      session.clients.delete(res);
    }
  }
}

function stopTraceSession(projectId) {
  const session = traceSessions.get(projectId);
  if (session && session.running && session.child) {
    session.child.kill("SIGTERM");
  }
}

function clearTraceSession(projectId) {
  stopTraceSession(projectId);
  const previousSession = traceSessions.get(projectId);
  const clients = previousSession ? previousSession.clients : new Set();
  const session = {
    projectId,
    traceId: null,
    command: "",
    child: null,
    clients,
    events: [],
    running: false,
    startedAt: null,
    lineBuffer: "",
  };
  traceSessions.set(projectId, session);
  return session;
}

function resolveTraceFile(project, requestedPath) {
  if (!requestedPath) {
    throw new Error("Trace file path is required.");
  }
  const resolvedFile = path.resolve(
    path.isAbsolute(requestedPath) ? requestedPath : path.join(project.rootPath, requestedPath),
  );
  const session = traceSessions.get(project.id);
  const inProject = resolvedFile === project.rootPath || resolvedFile.startsWith(`${project.rootPath}${path.sep}`);
  const inTrace = Boolean(
    session &&
      session.events.some((event) => {
        if (!event.file) {
          return false;
        }
        const eventFile = path.resolve(
          path.isAbsolute(event.file) ? event.file : path.join(project.rootPath, event.file),
        );
        return eventFile === resolvedFile;
      }),
  );
  if (!inProject && !inTrace) {
    throw new Error("Trace file is outside the selected project and was not part of this trace.");
  }
  return resolvedFile;
}

async function readTraceFile(project, requestedPath) {
  const filePath = resolveTraceFile(project, requestedPath);
  const content = await fsp.readFile(filePath, "utf8");
  return {
    projectId: project.id,
    file: {
      id: null,
      path: filePath,
      relativePath: filePath.startsWith(`${project.rootPath}${path.sep}`)
        ? path.relative(project.rootPath, filePath)
        : filePath,
      moduleName: "",
      lineCount: content.split(/\r?\n/).length,
      isTraceFile: true,
      tracePath: filePath,
    },
    content,
    contentHash: hashText(content),
    symbols: [],
    edges: [],
  };
}

function startTraceSession(project, command) {
  const previousSession = traceSessions.get(project.id);
  const clients = previousSession ? previousSession.clients : new Set();
  stopTraceSession(project.id);

  const argv = parseCommand(command);
  const { interpreter, pythonPathMode } = traceLaunchForCommand(argv);
  const traceId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const session = {
    projectId: project.id,
    traceId,
    command: String(command || "").trim(),
    interpreter,
    pythonPathMode,
    child: null,
    clients,
    events: [],
    running: true,
    startedAt: new Date().toISOString(),
    lineBuffer: "",
  };
  traceSessions.set(project.id, session);

  const child = spawn(interpreter, [TRACER_PATH], {
    cwd: project.rootPath,
    stdio: ["pipe", "pipe", "pipe"],
  });
  session.child = child;
  const isCurrentSession = () => traceSessions.get(project.id) === session;

  function handleJsonLines(text) {
    if (!isCurrentSession()) {
      return;
    }
    session.lineBuffer += text;
    let newlineIndex = session.lineBuffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = session.lineBuffer.slice(0, newlineIndex).trim();
      session.lineBuffer = session.lineBuffer.slice(newlineIndex + 1);
      if (line) {
        try {
          emitTraceEvent(session, JSON.parse(line));
        } catch {
          emitTraceEvent(session, { type: "tracer_output", text: line, ts: Date.now() / 1000 });
        }
      }
      newlineIndex = session.lineBuffer.indexOf("\n");
    }
  }

  child.stdout.on("data", (chunk) => handleJsonLines(chunk.toString("utf8")));
  child.stderr.on("data", (chunk) => {
    if (!isCurrentSession()) {
      return;
    }
    emitTraceEvent(session, {
      type: "tracer_stderr",
      stream: "stderr",
      text: chunk.toString("utf8"),
      ts: Date.now() / 1000,
    });
  });
  child.on("error", (error) => {
    if (!isCurrentSession()) {
      return;
    }
    session.running = false;
    emitTraceEvent(session, {
      type: "fatal",
      exceptionType: error.name,
      message: error.message,
      ts: Date.now() / 1000,
    });
  });
  child.on("close", (code, signal) => {
    if (!isCurrentSession()) {
      return;
    }
    if (session.lineBuffer.trim()) {
      handleJsonLines("\n");
    }
    session.running = false;
    emitTraceEvent(session, {
      type: "process_close",
      exitCode: code,
      signal,
      ts: Date.now() / 1000,
    });
  });

  child.stdin.end(
    JSON.stringify({
      rootPath: project.rootPath,
      argv,
      maxEvents: TRACE_EVENT_CAPTURE_LIMIT,
      pythonPathMode,
    }),
  );

  emitTraceEvent(session, {
    type: "trace_session",
    command: session.command,
    argv,
    interpreter,
    pythonPathMode,
    startedAt: session.startedAt,
    ts: Date.now() / 1000,
  });

  return session;
}

function findProjectForImportedRoot(rootPath) {
  const exactProject = projects.get(projectIdForRoot(rootPath));
  if (exactProject && exactProject.index) {
    return exactProject;
  }

  const candidates = [...projects.values()]
    .filter((project) => {
      if (!project.index) {
        return false;
      }
      return (
        project.rootPath === rootPath ||
        project.rootPath.startsWith(`${rootPath}${path.sep}`) ||
        rootPath.startsWith(`${project.rootPath}${path.sep}`)
      );
    })
    .sort((a, b) => b.rootPath.length - a.rootPath.length);

  if (activeProjectId) {
    const active = candidates.find((project) => project.id === activeProjectId);
    if (active) {
      return active;
    }
  }
  return candidates[0] || null;
}

function normalizeImportedTraceEvent(session, event) {
  if (!event || typeof event !== "object" || !event.file) {
    return event;
  }
  const project = projects.get(session.projectId);
  if (!project) {
    return event;
  }
  const traceRootPath = session.traceRootPath || project.rootPath;
  const eventFile = path.resolve(path.isAbsolute(event.file) ? event.file : path.join(traceRootPath, event.file));
  if (eventFile === project.rootPath || eventFile.startsWith(`${project.rootPath}${path.sep}`)) {
    return {
      ...event,
      file: path.relative(project.rootPath, eventFile),
    };
  }
  return {
    ...event,
    file: eventFile,
  };
}

function startImportedTraceSession(rootPath, command, argv = []) {
  const resolvedRoot = expandPath(rootPath || "");
  const project = findProjectForImportedRoot(resolvedRoot);
  if (!project) {
    throw new Error(`Repo is not indexed in this CodeTrace server: ${resolvedRoot}`);
  }

  const previousSession = traceSessions.get(project.id);
  const clients = previousSession ? previousSession.clients : new Set();
  stopTraceSession(project.id);

  const traceId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const session = {
    projectId: project.id,
    traceId,
    command: String(command || "").trim(),
    interpreter: "",
    pythonPathMode: "external",
    child: null,
    clients,
    events: [],
    running: true,
    startedAt: new Date().toISOString(),
    lineBuffer: "",
    imported: true,
    traceRootPath: resolvedRoot,
  };
  traceSessions.set(project.id, session);

  emitTraceEvent(session, {
    type: "trace_session",
    command: session.command,
    argv,
    pythonPathMode: "external",
    startedAt: session.startedAt,
    ts: Date.now() / 1000,
  });

  return session;
}

function importTraceEvents(traceId, events = []) {
  const session = [...traceSessions.values()].find((item) => item.traceId === traceId);
  if (!session) {
    throw new Error("Trace session not found.");
  }

  for (const event of events) {
    emitTraceEvent(session, normalizeImportedTraceEvent(session, event));
    if (["finish", "process_close", "fatal"].includes(event.type)) {
      session.running = false;
    }
  }
  return session;
}

async function handleTraceEvents(req, res, project) {
  let session = traceSessions.get(project.id);
  if (!session) {
    session = {
      projectId: project.id,
      traceId: null,
      command: "",
      child: null,
      clients: new Set(),
      events: [],
      running: false,
      startedAt: null,
      lineBuffer: "",
    };
    traceSessions.set(project.id, session);
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
  });
  session.clients.add(res);
  res.write(
    `event: hello\ndata: ${JSON.stringify({
      ok: true,
      projectId: project.id,
      running: session.running,
      traceId: session.traceId,
    })}\n\n`,
  );
  for (const event of session.events) {
    res.write(`event: trace\ndata: ${JSON.stringify(event)}\n\n`);
  }
  req.on("close", () => session.clients.delete(res));
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      indexing: Boolean(indexingJob),
      activeProjectId,
      project: serializeProject(getActiveProject(), false),
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    });
    eventClients.add(res);
    res.write(`event: hello\ndata: ${JSON.stringify({ ok: true })}\n\n`);
    req.on("close", () => eventClients.delete(res));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/fs") {
    try {
      sendJson(res, 200, await listFileSystem(url.searchParams.get("path") || "~"));
    } catch (error) {
      sendError(res, 400, error.message);
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/recent") {
    sendJson(res, 200, { projects: await loadRecentProjects() });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/projects") {
    sendJson(res, 200, {
      activeProjectId,
      projects: serializeProjectList(),
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/project") {
    const project = getProjectById(url.searchParams.get("projectId") || activeProjectId);
    sendJson(res, 200, serializeProject(project, true, { include: url.searchParams.get("include") || "all" }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/projects/active") {
    try {
      const body = await readRequestJson(req);
      const project = requireProject(body.projectId);
      activeProjectId = project.id;
      sendJson(res, 200, serializeProject(project, true, { include: "files" }));
    } catch (error) {
      sendError(res, 404, error.message);
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/projects/rename") {
    try {
      const body = await readRequestJson(req);
      const project = renameLoadedProject(body.projectId || activeProjectId, body.name);
      sendJson(res, 200, {
        ok: true,
        activeProjectId,
        project: serializeProject(project, false),
        projects: serializeProjectList(),
      });
    } catch (error) {
      sendError(res, 400, error.message);
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/projects/remove") {
    try {
      const body = await readRequestJson(req);
      removeLoadedProject(body.projectId || activeProjectId);
      sendJson(res, 200, {
        ok: true,
        activeProjectId,
        projects: serializeProjectList(),
      });
    } catch (error) {
      sendError(res, 400, error.message);
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/index") {
    try {
      const body = await readRequestJson(req);
      startIndexing(body.rootPath).catch(() => {});
      sendJson(res, 202, { ok: true });
    } catch (error) {
      sendError(res, 400, error.message);
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/search") {
    try {
      const project = requireProject(url.searchParams.get("projectId") || activeProjectId);
      sendJson(res, 200, { results: searchProject(project, url.searchParams.get("q") || "") });
    } catch (error) {
      sendError(res, 404, error.message);
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/graph") {
    try {
      const project = requireProject(url.searchParams.get("projectId") || activeProjectId);
      sendJson(res, 200, graphForProject(project, url));
    } catch (error) {
      sendError(res, 404, error.message);
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/file") {
    try {
      const project = requireProject(url.searchParams.get("projectId") || activeProjectId);
      const index = project.index;
      const fileId = Number(url.searchParams.get("fileId") || 0);
      const file = index.fileById.get(fileId);
      if (!file) {
        throw new Error("File not found.");
      }

      const content = await fsp.readFile(file.path, "utf8");
      const symbols = index.symbolsByFileId.get(file.id) || [];
      const edges = index.edges.filter((edge) => edge.fileId === file.id);
      sendJson(res, 200, {
        projectId: project.id,
        file,
        content,
        contentHash: hashText(content),
        symbols,
        edges,
      });
    } catch (error) {
      sendError(res, error.message === "File not found." ? 404 : 400, error.message);
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/file") {
    try {
      const body = await readRequestJson(req, 50 * 1024 * 1024);
      const project = requireProject(body.projectId || activeProjectId);
      const file = project.index.fileById.get(Number(body.fileId || 0));
      if (!file) {
        throw new Error("File not found.");
      }
      const resolvedFile = path.resolve(file.path);
      if (!resolvedFile.startsWith(`${project.rootPath}${path.sep}`) && resolvedFile !== project.rootPath) {
        throw new Error("File is outside the selected project.");
      }

      const content = typeof body.content === "string" ? body.content : "";
      const currentContent = await fsp.readFile(file.path, "utf8");
      const currentHash = hashText(currentContent);
      if (body.contentHash && body.contentHash !== currentHash) {
        sendJson(res, 409, {
          error: "File changed on disk. Reload before saving.",
          contentHash: currentHash,
        });
        return;
      }

      await fsp.writeFile(file.path, content, "utf8");
      file.hash = hashText(content);
      file.lineCount = content.split(/\r?\n/).length;
      sendJson(res, 200, {
        ok: true,
        projectId: project.id,
        file,
        contentHash: file.hash,
      });
    } catch (error) {
      sendError(res, error.message === "File not found." ? 404 : 400, error.message);
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/trace-file") {
    try {
      const project = requireProject(url.searchParams.get("projectId") || activeProjectId);
      sendJson(res, 200, await readTraceFile(project, url.searchParams.get("path") || ""));
    } catch (error) {
      sendError(res, 400, error.message);
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/trace-file") {
    try {
      const body = await readRequestJson(req, 50 * 1024 * 1024);
      const project = requireProject(body.projectId || activeProjectId);
      const filePath = resolveTraceFile(project, body.path || "");
      const content = typeof body.content === "string" ? body.content : "";
      const currentContent = await fsp.readFile(filePath, "utf8");
      const currentHash = hashText(currentContent);
      if (body.contentHash && body.contentHash !== currentHash) {
        sendJson(res, 409, {
          error: "File changed on disk. Reload before saving.",
          contentHash: currentHash,
        });
        return;
      }
      await fsp.writeFile(filePath, content, "utf8");
      sendJson(res, 200, await readTraceFile(project, filePath));
    } catch (error) {
      sendError(res, 400, error.message);
    }
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/symbol/")) {
    try {
      const project = requireProject(url.searchParams.get("projectId") || activeProjectId);
      const id = Number(url.pathname.split("/").pop());
      const symbol = project.index.symbolById.get(id);
      if (!symbol) {
        throw new Error("Symbol not found.");
      }
      sendJson(res, 200, { symbol });
    } catch (error) {
      sendError(res, error.message === "Symbol not found." ? 404 : 400, error.message);
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/terminal/events") {
    try {
      const project = requireProject(url.searchParams.get("projectId") || activeProjectId);
      await handleTerminalEvents(req, res, project);
    } catch (error) {
      sendError(res, 404, error.message);
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/terminal/start") {
    try {
      const body = await readRequestJson(req);
      const project = requireProject(body.projectId || activeProjectId);
      createTerminalSession(project);
      sendJson(res, 200, { ok: true, projectId: project.id });
    } catch (error) {
      sendError(res, 404, error.message);
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/terminal/input") {
    try {
      const body = await readRequestJson(req);
      const project = requireProject(body.projectId || activeProjectId);
      const session = createTerminalSession(project);
      session.child.stdin.write(String(body.input || ""));
      sendJson(res, 200, { ok: true });
    } catch (error) {
      sendError(res, 400, error.message);
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/terminal/stop") {
    try {
      const body = await readRequestJson(req);
      const project = requireProject(body.projectId || activeProjectId);
      const session = terminalSessions.get(project.id);
      if (session && !session.exited) {
        session.child.kill("SIGTERM");
      }
      sendJson(res, 200, { ok: true });
    } catch (error) {
      sendError(res, 400, error.message);
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/trace/events") {
    try {
      const project = requireProject(url.searchParams.get("projectId") || activeProjectId);
      await handleTraceEvents(req, res, project);
    } catch (error) {
      sendError(res, 404, error.message);
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/trace/state") {
    try {
      const project = requireProject(url.searchParams.get("projectId") || activeProjectId);
      const session = traceSessions.get(project.id);
      sendJson(res, 200, {
        projectId: project.id,
        running: Boolean(session && session.running),
        traceId: session ? session.traceId : null,
        command: session ? session.command : "",
        events: session ? session.events : [],
      });
    } catch (error) {
      sendError(res, 404, error.message);
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/trace/start") {
    try {
      const body = await readRequestJson(req);
      const project = requireProject(body.projectId || activeProjectId);
      const session = startTraceSession(project, body.command);
      sendJson(res, 200, {
        ok: true,
        projectId: project.id,
        traceId: session.traceId,
        running: session.running,
      });
    } catch (error) {
      sendError(res, 400, error.message);
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/trace/stop") {
    try {
      const body = await readRequestJson(req);
      const project = requireProject(body.projectId || activeProjectId);
      stopTraceSession(project.id);
      sendJson(res, 200, { ok: true, projectId: project.id });
    } catch (error) {
      sendError(res, 400, error.message);
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/trace/clear") {
    try {
      const body = await readRequestJson(req);
      const project = requireProject(body.projectId || activeProjectId);
      clearTraceSession(project.id);
      sendJson(res, 200, { ok: true, projectId: project.id });
    } catch (error) {
      sendError(res, 400, error.message);
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/trace/import/start") {
    try {
      const body = await readRequestJson(req);
      const session = startImportedTraceSession(body.rootPath, body.command, body.argv || []);
      sendJson(res, 200, {
        ok: true,
        projectId: session.projectId,
        traceId: session.traceId,
        running: session.running,
      });
    } catch (error) {
      sendError(res, 400, error.message);
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/trace/import/events") {
    try {
      const body = await readRequestJson(req, 10 * 1024 * 1024);
      const session = importTraceEvents(body.traceId, Array.isArray(body.events) ? body.events : []);
      sendJson(res, 200, {
        ok: true,
        projectId: session.projectId,
        traceId: session.traceId,
        running: session.running,
        events: session.events.length,
      });
    } catch (error) {
      sendError(res, 400, error.message);
    }
    return;
  }

  sendError(res, 404, "API route not found.");
}

async function serveStatic(req, res, url) {
  if (
    url.pathname === "/vendor/xterm/xterm.js" ||
    url.pathname === "/vendor/xterm/addon-fit.js" ||
    url.pathname === "/vendor/xterm/xterm.css"
  ) {
    const filePath = url.pathname === "/vendor/xterm/xterm.css"
      ? XTERM_CSS_PATH
      : url.pathname === "/vendor/xterm/addon-fit.js"
        ? XTERM_FIT_JS_PATH
        : XTERM_JS_PATH;
    try {
      const content = await fsp.readFile(filePath);
      const ext = path.extname(filePath);
      res.writeHead(200, {
        "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      res.end(content);
    } catch {
      sendError(res, 404, "xterm asset not found.");
    }
    return;
  }

  let relativePath = decodeURIComponent(url.pathname);
  if (relativePath === "/") {
    relativePath = "/index.html";
  }

  const filePath = path.resolve(PUBLIC_ROOT, `.${relativePath}`);
  if (!filePath.startsWith(PUBLIC_ROOT)) {
    sendError(res, 403, "Forbidden.");
    return;
  }

  try {
    const content = await fsp.readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(content);
  } catch {
    sendError(res, 404, "Not found.");
  }
}

async function startServer(options = {}) {
  const host = options.host || "127.0.0.1";
  const port = options.port || 3038;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || `${host}:${port}`}`);

    Promise.resolve()
      .then(() => {
        if (url.pathname.startsWith("/api/")) {
          return handleApi(req, res, url);
        }
        return serveStatic(req, res, url);
      })
      .catch((error) => {
        sendError(res, 500, error.message || "Internal server error.");
      });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });

  return {
    close: () => new Promise((resolve) => server.close(resolve)),
    host,
    port,
  };
}

module.exports = {
  startServer,
};
