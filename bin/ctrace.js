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
  ctrace run [-r DIR] [--max-events N] <command...>
  ctrace doctor [-r DIR]

Examples:
  ctrace serve
  ctrace serve -h 0.0.0.0 -p 3038
  cd /path/to/project && ctrace run python app.py
  ctrace run -r /path/to/project python app.py
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

  const rootPath = expandPath(options.project);
  const { interpreter, pythonPathMode } = traceLaunchForCommand(options.runCommand);
  const commandText = options.runCommand.join(" ");
  let importTraceId = null;
  let importDisabled = Boolean(options.noServer);
  let importQueue = [];
  let flushing = false;

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
        return;
      }
      const payload = await response.json();
      importTraceId = payload.traceId;
    } catch {
      importDisabled = true;
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

  const child = spawn(interpreter, [TRACER_PATH], {
    cwd: rootPath,
    stdio: ["pipe", "pipe", "inherit"],
  });

  let lineBuffer = "";

  child.stdout.on("data", (chunk) => {
    lineBuffer += chunk.toString("utf8");
    let newlineIndex = lineBuffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = lineBuffer.slice(0, newlineIndex).trim();
      lineBuffer = lineBuffer.slice(newlineIndex + 1);
      if (line) {
        try {
          const event = JSON.parse(line);
          if (event.type === "output") {
            const target = event.stream === "stderr" ? process.stderr : process.stdout;
            target.write(event.text || "");
          }
          enqueueTraceEvent(event);
        } catch {
          process.stdout.write(`${line}\n`);
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
      pythonPathMode,
    }),
  );

  return new Promise((resolve) => {
    child.on("exit", (code, signal) => {
    if (lineBuffer.trim()) {
      try {
        const event = JSON.parse(lineBuffer.trim());
        if (event.type === "output") {
          const target = event.stream === "stderr" ? process.stderr : process.stdout;
          target.write(event.text || "");
        }
        enqueueTraceEvent(event);
      } catch {
        process.stdout.write(`${lineBuffer}\n`);
      }
    }
    flushImportQueue(true)
      .catch(() => {})
      .finally(() => {
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
