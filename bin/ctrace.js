#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { startServer } = require("../src/server");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const TRACER_PATH = path.join(PROJECT_ROOT, "src", "python", "trace_run.py");
const ANALYZER_PATH = path.join(PROJECT_ROOT, "src", "python", "analyze.py");

let activeServer = null;

function printHelp() {
  console.log(`CodeTrace

Usage:
  ctrace serve [-h 127.0.0.1] [-p 3038]
  ctrace run [-r DIR] [-l FILE] [--max-events N] [--trace-deps] <command...>
  ctrace doctor [-r DIR]

Examples:
  ctrace serve
  ctrace serve -h 0.0.0.0 -p 3038
  cd /path/to/project && ctrace run python app.py
  ctrace run -r /path/to/project python app.py
  ctrace run -l /tmp/ctrace.log python app.py
  ctrace run -r /path/to/project /path/to/venv/bin/some-python-cli --help
  ctrace doctor
`);
}

function parseShellWords(input) {
  const args = [];
  let current = "";
  let quote = "";
  let escape = false;

  for (const char of String(input || "")) {
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
    throw new Error("Command has an unterminated quote.");
  }
  if (escape) {
    current += "\\";
  }
  if (current) {
    args.push(current);
  }
  return args;
}

function expandPath(inputPath) {
  if (!inputPath) {
    return process.cwd();
  }
  if (inputPath === "~") {
    return process.env.HOME || inputPath;
  }
  if (inputPath.startsWith("~/")) {
    return path.join(process.env.HOME || "", inputPath.slice(2));
  }
  return path.resolve(inputPath);
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
    const parts = parseShellWords(line);
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

const ANSI_ENABLED = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const ANSI = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  gray: "\x1b[90m",
  magenta: "\x1b[35m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
};

function color(text, code) {
  if (!ANSI_ENABLED || !code) {
    return text;
  }
  return `${code}${text}${ANSI.reset}`;
}

function compactText(value, max = 120) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 1)}...`;
}

function valueSummary(value) {
  if (!value || typeof value !== "object") {
    return compactText(value, 80);
  }
  if (value.type === "NoneType" && value.value === null) {
    return "None";
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
  return compactText(parts.filter(Boolean).join(" "), 100);
}

function eventStyle(type) {
  switch (type) {
    case "trace_session":
    case "shell_session":
    case "start":
      return { label: "START", color: ANSI.blue };
    case "import":
      return { label: "IMPORT", color: ANSI.yellow };
    case "call":
      return { label: "CALL", color: ANSI.cyan };
    case "line":
      return { label: "LINE", color: ANSI.gray };
    case "return":
      return { label: "RETURN", color: ANSI.green };
    case "output":
      return { label: "OUTPUT", color: ANSI.yellow };
    case "exception":
    case "fatal":
      return { label: type === "fatal" ? "FATAL" : "EXCEPT", color: ANSI.red };
    case "system_exit":
    case "finish":
    case "process_close":
      return { label: "EXIT", color: ANSI.magenta };
    case "limit":
      return { label: "LIMIT", color: ANSI.red };
    default:
      return { label: String(type || "EVENT").toUpperCase().slice(0, 6), color: ANSI.gray };
  }
}

function eventLocation(event) {
  if (event.line && event.file) {
    return `${event.file}:${event.line}`;
  }
  return event.file || event.script || event.module || "";
}

function formatEventMain(event) {
  switch (event.type) {
    case "trace_session":
    case "shell_session":
      return `trace ${event.command || ""}`;
    case "start":
      return event.script ? `script ${event.script}` : `module ${event.module || ""}`;
    case "import": {
      const fromlist = event.fromlist?.length ? ` {${event.fromlist.join(", ")}}` : "";
      return `import ${event.module || ""}${fromlist}`;
    }
    case "call":
      return `call ${event.function || "<unknown>"}()`;
    case "line":
      return event.source ? compactText(event.source, 150) : `line ${event.line || ""}`;
    case "return":
      return `return ${event.function || "<unknown>"}() -> ${valueSummary(event.returnValue) || "null"}`;
    case "output": {
      const stream = String(event.stream || "stdout").toUpperCase();
      const text = String(event.text || "")
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n");
      return `${stream} ${text ? compactText(text, 180) : "(empty write)"}`;
    }
    case "exception":
      return `${event.exceptionType || "Exception"}: ${event.message || ""}`;
    case "fatal":
      return `${event.exceptionType || "Fatal"}: ${event.message || ""}`;
    case "system_exit":
      return `system exit ${event.code ?? ""}`;
    case "finish":
    case "process_close":
      return `exit ${event.exitCode ?? ""}`;
    case "limit":
      return `${event.message || "trace limit reached"} (${event.maxEvents || ""})`;
    default:
      return compactText(JSON.stringify(event), 180);
  }
}

function formatEventDetails(event) {
  const details = [];
  if (event.type === "call" && event.args && Object.keys(event.args).length) {
    details.push(`args ${Object.entries(event.args)
      .slice(0, 8)
      .map(([name, value]) => `${name}=${valueSummary(value)}`)
      .join(", ")}`);
  }
  if (event.type === "line") {
    const changed = Object.entries(event.changed || {}).slice(0, 8);
    const removed = (event.removed || []).slice(0, 8);
    if (changed.length) {
      details.push(`changed ${changed.map(([name, value]) => `${name}=${valueSummary(value)}`).join(", ")}`);
    }
    if (removed.length) {
      details.push(`removed ${removed.join(", ")}`);
    }
  }
  if (event.type === "fatal" && event.traceback) {
    details.push(compactText(event.traceback.replace(/\s+/g, " "), 220));
  }
  return details;
}

function formatTraceEvent(event, displayId = event.id) {
  const style = eventStyle(event.type);
  const id = String(displayId ?? "").padStart(6, "0");
  const depth = Math.max(0, Math.min(Number(event.depth || 0), 18));
  const indent = "  ".repeat(depth);
  const label = color(style.label.padEnd(6), style.color);
  if (event.type === "output") {
    const stream = String(event.stream || "stdout").toUpperCase();
    const rawText = String(event.text || "");
    if (rawText === "\n") {
      return `${color(id, ANSI.dim)} ${label} ${stream} \\n`;
    }
    const text = rawText.replace(/\r/g, "\\r");
    const outputLines = text.split("\n");
    if (outputLines.at(-1) === "") {
      outputLines.pop();
    }
    if (outputLines.length <= 1) {
      return `${color(id, ANSI.dim)} ${label} ${stream} ${outputLines[0] || "(empty write)"}`;
    }
    const lines = [`${color(id, ANSI.dim)} ${label} ${stream}`];
    for (const outputLine of outputLines) {
      lines.push(`${color("       │", ANSI.dim)} ${outputLine}`);
    }
    return lines.join("\n");
  }
  const location = eventLocation(event);
  const locationText = location ? color(` ${location}`, ANSI.dim) : "";
  const main = formatEventMain(event);
  const details = formatEventDetails(event);
  const lines = [`${color(id, ANSI.dim)} ${label} ${indent}${main}${locationText}`];
  for (const detail of details) {
    lines.push(`${color("       │", ANSI.dim)} ${indent}${color(detail, ANSI.dim)}`);
  }
  return lines.join("\n");
}

function parseArgs(argv) {
  const first = argv[2];
  const options = {
    command: first && !first.startsWith("-") ? first : "serve",
    host: "127.0.0.1",
    port: 3038,
    project: process.cwd(),
    maxEvents: 20000,
    server: process.env.CODETRACE_SERVER || "http://127.0.0.1:3038",
    noServer: false,
    traceDeps: false,
    logFile: "",
    runCommand: [],
  };

  if (options.command === "run" || options.command === "doctor") {
    for (let i = 3; i < argv.length; i += 1) {
      const arg = argv[i];
      if (arg === "--help") {
        options.command = "help";
      } else if (arg === "--repo" || arg === "-r") {
        options.project = argv[++i] || "";
      } else if (arg === "--max-events") {
        if (options.command !== "run") {
          throw new Error("--max-events is only valid for ctrace run.");
        }
        options.maxEvents = Number(argv[++i] || options.maxEvents);
      } else if (arg === "--server") {
        if (options.command !== "run") {
          throw new Error("--server is only valid for ctrace run.");
        }
        options.server = argv[++i] || "";
      } else if (arg === "--no-server") {
        if (options.command !== "run") {
          throw new Error("--no-server is only valid for ctrace run.");
        }
        options.noServer = true;
      } else if (arg === "--trace-deps") {
        if (options.command !== "run") {
          throw new Error("--trace-deps is only valid for ctrace run.");
        }
        options.traceDeps = true;
      } else if (arg === "--log" || arg === "-l") {
        if (options.command !== "run") {
          throw new Error("--log is only valid for ctrace run.");
        }
        options.logFile = argv[++i] || "";
      } else if (arg === "--") {
        if (options.command !== "run") {
          throw new Error("-- is only valid for ctrace run.");
        }
        options.runCommand = argv.slice(i + 1);
        break;
      } else {
        if (options.command !== "run") {
          throw new Error(`Unknown argument: ${arg}`);
        }
        if (arg.startsWith("-")) {
          throw new Error(`Unknown argument: ${arg}`);
        }
        options.runCommand = argv.slice(i);
        break;
      }
    }
    return options;
  }

  for (let i = options.command === first ? 3 : 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help") {
      options.command = "help";
    } else if (arg === "--host" || arg === "-h") {
      options.host = argv[++i] || options.host;
    } else if (arg === "--port" || arg === "-p") {
      options.port = Number(argv[++i] || options.port);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    throw new Error(`Invalid port: ${options.port}`);
  }
  return options;
}

async function runTraceCommand(options) {
  if (!options.runCommand.length) {
    throw new Error("ctrace run needs a command.");
  }
  if (!Number.isInteger(options.maxEvents) || options.maxEvents < 1) {
    throw new Error(`Invalid --max-events: ${options.maxEvents}`);
  }
  if (options.logFile === "") {
    options.logFile = null;
  }

  const rootPath = expandPath(options.project);
  const { interpreter, pythonPathMode } = traceLaunchForCommand(options.runCommand);
  const commandText = options.runCommand.join(" ");
  const logPath = options.logFile ? expandPath(options.logFile) : null;
  let logStream = null;
  let importTraceId = null;
  let importDisabled = Boolean(options.noServer);
  let importStatus = options.noServer ? "disabled by --no-server" : "not connected";
  let importQueue = [];
  let flushing = false;

  if (logPath) {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    logStream = fs.createWriteStream(logPath, { flags: "w" });
  }

  function writeOutput(text) {
    process.stdout.write(text);
    if (logStream) {
      logStream.write(text.replace(/\x1b\[[0-9;]*m/g, ""));
    }
  }

  async function startImportSession() {
    if (importDisabled || !options.server) {
      return;
    }
    try {
      const response = await fetch(`${options.server.replace(/\/$/, "")}/api/trace/import/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rootPath,
          command: commandText,
          argv: options.runCommand,
        }),
      });
      if (!response.ok) {
        importDisabled = true;
        let message = `${response.status} ${response.statusText}`;
        try {
          const payload = await response.json();
          if (payload?.error) {
            message = payload.error;
          }
        } catch {
          // Keep the HTTP status if the server did not return JSON.
        }
        importStatus = `not connected: ${message}`;
        return;
      }
      const payload = await response.json();
      importTraceId = payload.traceId;
      importStatus = `connected ${options.server.replace(/\/$/, "")} project=${payload.projectId || "unknown"}`;
    } catch (error) {
      importDisabled = true;
      importStatus = `not connected: ${error.message}`;
    }
  }

  async function flushImportQueue(force = false) {
    if (flushing || importDisabled || !importTraceId || !importQueue.length) {
      return;
    }
    if (!force && importQueue.length < 80) {
      return;
    }
    flushing = true;
    const events = importQueue;
    importQueue = [];
    try {
      const response = await fetch(`${options.server.replace(/\/$/, "")}/api/trace/import/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          traceId: importTraceId,
          events,
        }),
      });
      if (!response.ok) {
        importDisabled = true;
      }
    } catch {
      importDisabled = true;
    } finally {
      flushing = false;
    }
  }

  function enqueueTraceEvent(event) {
    if (importDisabled || !importTraceId) {
      return;
    }
    importQueue.push(event);
    flushImportQueue(false).catch(() => {});
  }

  await startImportSession();

  writeOutput(`${color("CodeTrace run", ANSI.bold)}\n`);
  writeOutput(`${color("repo", ANSI.dim)}    ${rootPath}\n`);
  writeOutput(`${color("command", ANSI.dim)} ${commandText}\n`);
  writeOutput(`${color("web", ANSI.dim)}     ${importStatus}\n`);
  if (logPath) {
    writeOutput(`${color("log", ANSI.dim)}     ${logPath}\n`);
  }
  writeOutput("\n");
  writeOutput(
    `${color("trace", ANSI.dim)}   ${options.traceDeps ? "repo + dependencies" : "repo source only"}\n\n`,
  );

  const child = spawn(interpreter, [TRACER_PATH], {
    cwd: rootPath,
    env: { ...process.env, CODETRACE_EVENT_FD: "3" },
    stdio: ["pipe", "inherit", "inherit", "pipe"],
  });

  let lineBuffer = "";
  const eventStream = child.stdio[3];
  let displayEventId = 0;

  eventStream.on("data", (chunk) => {
    lineBuffer += chunk.toString("utf8");
    let newlineIndex = lineBuffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = lineBuffer.slice(0, newlineIndex).trim();
      lineBuffer = lineBuffer.slice(newlineIndex + 1);
      if (line) {
        try {
          const event = JSON.parse(line);
          displayEventId += 1;
          writeOutput(`${formatTraceEvent(event, displayEventId)}\n`);
          enqueueTraceEvent(event);
        } catch {
          writeOutput(`${color("RAW", ANSI.gray)} ${line}\n`);
        }
      }
      newlineIndex = lineBuffer.indexOf("\n");
    }
  });

  child.stdin.end(
    JSON.stringify({
      rootPath,
      argv: options.runCommand,
      maxEvents: options.maxEvents,
      traceDeps: options.traceDeps,
      pythonPathMode,
    }),
  );

  return new Promise((resolve) => {
    child.on("exit", (code, signal) => {
    if (lineBuffer.trim()) {
      try {
        const event = JSON.parse(lineBuffer.trim());
        displayEventId += 1;
        writeOutput(`${formatTraceEvent(event, displayEventId)}\n`);
        enqueueTraceEvent(event);
      } catch {
        writeOutput(`${color("RAW", ANSI.gray)} ${lineBuffer}\n`);
      }
    }
    flushImportQueue(true)
      .catch(() => {})
      .finally(() => {
        if (logStream) {
          logStream.end();
        }
        if (signal) {
          process.kill(process.pid, signal);
          resolve();
          return;
        }
        process.exitCode = code || 0;
        resolve();
      });
    });
  });
}

function doctorCheck(label, ok, detail = "") {
  const mark = ok ? "ok" : "fail";
  console.log(`${mark.padEnd(4)} ${label}${detail ? ` - ${detail}` : ""}`);
  return ok;
}

function commandOutput(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: String(result.stdout || "").trim(),
    stderr: String(result.stderr || "").trim(),
    error: result.error,
  };
}

function runDoctor(options) {
  let ok = true;
  const rootPath = expandPath(options.project);

  console.log("CodeTrace doctor");
  ok = doctorCheck("Node.js", true, process.version) && ok;
  ok = doctorCheck("repo path", fs.existsSync(rootPath), rootPath) && ok;
  ok = doctorCheck("trace script", fs.existsSync(TRACER_PATH), TRACER_PATH) && ok;
  ok = doctorCheck("analyzer script", fs.existsSync(ANALYZER_PATH), ANALYZER_PATH) && ok;

  const pythonVersion = commandOutput("python3", ["--version"]);
  ok =
    doctorCheck(
      "python3",
      pythonVersion.ok,
      pythonVersion.stdout || pythonVersion.stderr || pythonVersion.error?.message || "not found",
    ) && ok;

  if (pythonVersion.ok) {
    const compile = commandOutput("python3", ["-m", "py_compile", TRACER_PATH, ANALYZER_PATH]);
    ok = doctorCheck("python scripts compile", compile.ok, compile.stderr || "trace_run.py, analyze.py") && ok;
  }

  const timeCommand = commandOutput("/usr/bin/time", ["--version"]);
  doctorCheck("/usr/bin/time", timeCommand.ok, timeCommand.ok ? "available" : "optional; not required");

  console.log(ok ? "Doctor passed." : "Doctor found problems.");
  process.exitCode = ok ? 0 : 1;
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv);
  } catch (error) {
    console.error(error.message);
    printHelp();
    process.exitCode = 1;
    return;
  }

  if (options.command === "help") {
    printHelp();
    return;
  }

  if (options.command === "run") {
    try {
      await runTraceCommand(options);
    } catch (error) {
      console.error(error.message);
      printHelp();
      process.exitCode = 1;
    }
    return;
  }

  if (options.command === "doctor") {
    runDoctor(options);
    return;
  }

  if (options.command !== "serve") {
    console.error(`Unknown command: ${options.command}`);
    printHelp();
    process.exitCode = 1;
    return;
  }

  activeServer = await startServer({
    host: options.host,
    port: options.port,
  });

  const url = `http://${activeServer.host}:${activeServer.port}`;
  console.log(`CodeTrace running at ${url}`);
  console.log("Open the page and choose a Python project directory there.");

  if (activeServer.host === "0.0.0.0" || activeServer.host === "::") {
    console.log("Warning: this exposes source-code browsing APIs on the network.");
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
