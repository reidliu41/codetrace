#!/usr/bin/env python3

import builtins
import json
import os
import runpy
import sys
import threading
import time
import traceback


ORIGINAL_STDOUT = sys.stdout
ORIGINAL_STDERR = sys.stderr
ORIGINAL_IMPORT = builtins.__import__


class TraceState:
    def __init__(self, root_path, max_events=20000, extra_files=None):
        self.root_path = os.path.realpath(root_path)
        self.extra_files = set(os.path.realpath(file_path) for file_path in (extra_files or []))
        self.max_events = max_events
        self.event_id = 0
        self.frame_ids = {}
        self.frame_depths = {}
        self.frame_locals = {}
        self.source_cache = {}
        self.done = False

    def relative_path(self, file_path):
        real_path = os.path.realpath(file_path)
        if real_path == self.root_path or real_path.startswith(self.root_path + os.sep):
            return os.path.relpath(real_path, self.root_path)
        return real_path

    def in_project(self, file_path):
        if not file_path or file_path.startswith("<"):
            return False
        real_path = os.path.realpath(file_path)
        return (
            real_path == self.root_path
            or real_path.startswith(self.root_path + os.sep)
            or real_path in self.extra_files
        )

    def next_id(self):
        self.event_id += 1
        if self.event_id > self.max_events and not self.done:
            self.done = True
            self.emit(
                "limit",
                {
                    "message": "Trace event limit reached. Further line/call events are suppressed.",
                    "maxEvents": self.max_events,
                },
            )
        return self.event_id

    def emit(self, event_type, payload=None):
        if payload is None:
            payload = {}
        event = {
            "id": self.next_id() if event_type != "limit" else self.event_id,
            "type": event_type,
            "ts": time.time(),
            **payload,
        }
        ORIGINAL_STDOUT.write(json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n")
        ORIGINAL_STDOUT.flush()

    def frame_id(self, frame):
        key = id(frame)
        if key not in self.frame_ids:
            self.frame_ids[key] = len(self.frame_ids) + 1
        return self.frame_ids[key]

    def frame_depth(self, frame):
        key = id(frame)
        if key in self.frame_depths:
            return self.frame_depths[key]
        parent = frame.f_back
        if parent is not None and id(parent) in self.frame_depths:
            depth = self.frame_depths[id(parent)] + 1
        else:
            depth = 0
        self.frame_depths[key] = depth
        return depth

    def local_snapshot(self, frame):
        snapshot = {}
        for name, value in list(frame.f_locals.items())[:80]:
            if name.startswith("__") and name.endswith("__"):
                continue
            snapshot[name] = summarize_value(value)
        return snapshot

    def local_delta(self, frame):
        key = id(frame)
        current = self.local_snapshot(frame)
        previous = self.frame_locals.get(key, {})
        changed = {}
        for name, value in current.items():
            if previous.get(name) != value:
                changed[name] = value
        removed = [name for name in previous if name not in current]
        self.frame_locals[key] = current
        return changed, removed

    def source_line(self, file_path, line_number):
        if line_number <= 0 or not file_path or file_path.startswith("<"):
            return ""
        real_path = os.path.realpath(file_path)
        if real_path not in self.source_cache:
            try:
                with open(real_path, "r", encoding="utf-8", errors="replace") as source_file:
                    self.source_cache[real_path] = source_file.read().splitlines()
            except OSError:
                self.source_cache[real_path] = []
        lines = self.source_cache[real_path]
        if line_number > len(lines):
            return ""
        return truncate(lines[line_number - 1].strip(), 180)


TRACE_STATE = None


def summarize_value(value):
    value_type = type(value).__name__
    try:
        if value is None or isinstance(value, (bool, int, float)):
            return {"type": value_type, "value": value}
        if isinstance(value, str):
            return {"type": value_type, "value": truncate(value), "len": len(value)}
        if isinstance(value, (list, tuple, set, frozenset)):
            return {"type": value_type, "len": len(value), "repr": truncate(repr(value))}
        if isinstance(value, dict):
            return {"type": value_type, "len": len(value), "repr": truncate(repr(value))}
        return {"type": value_type, "repr": truncate(repr(value))}
    except Exception as error:
        return {"type": value_type, "repr": f"<unrepresentable: {error}>"}


def truncate(value, max_len=180):
    text = str(value)
    if len(text) <= max_len:
        return text
    return text[: max_len - 1] + "..."


class EventStream:
    def __init__(self, stream_name):
        self.stream_name = stream_name

    def write(self, text):
        if text and TRACE_STATE is not None:
            TRACE_STATE.emit("output", {"stream": self.stream_name, "text": text})
        return len(text or "")

    def flush(self):
        return None

    def isatty(self):
        return False


def trace_func(frame, event, arg):
    state = TRACE_STATE
    if state is None or state.done:
        return None

    file_path = frame.f_code.co_filename
    if not state.in_project(file_path):
        return None

    frame_id = state.frame_id(frame)
    depth = state.frame_depth(frame)
    payload_base = {
        "frameId": frame_id,
        "parentFrameId": state.frame_ids.get(id(frame.f_back)) if frame.f_back is not None else None,
        "depth": depth,
        "file": state.relative_path(file_path),
        "line": frame.f_lineno,
        "source": state.source_line(file_path, frame.f_lineno),
        "function": frame.f_code.co_name,
    }

    if event == "call":
        args = {}
        for name in frame.f_code.co_varnames[: frame.f_code.co_argcount]:
            if name in frame.f_locals:
                args[name] = summarize_value(frame.f_locals[name])
        state.frame_locals[id(frame)] = state.local_snapshot(frame)
        state.emit("call", {**payload_base, "args": args})
        return trace_func

    if event == "line":
        changed, removed = state.local_delta(frame)
        state.emit("line", {**payload_base, "changed": changed, "removed": removed})
        return trace_func

    if event == "return":
        state.emit("return", {**payload_base, "returnValue": summarize_value(arg)})
        return trace_func

    if event == "exception":
        exc_type, exc_value, _ = arg
        state.emit(
            "exception",
            {
                **payload_base,
                "exceptionType": getattr(exc_type, "__name__", str(exc_type)),
                "message": truncate(str(exc_value), 260),
            },
        )
        return trace_func

    return trace_func


def traced_import(name, globals=None, locals=None, fromlist=(), level=0):
    state = TRACE_STATE
    if state is not None and not state.done:
        caller_file = ""
        caller_line = 0
        try:
            frame = sys._getframe(1)
            caller_file = frame.f_code.co_filename
            caller_line = frame.f_lineno
        except Exception:
            frame = None

        if caller_file and state.in_project(caller_file):
            state.emit(
                "import",
                {
                    "module": name,
                    "fromlist": list(fromlist or []),
                    "level": level,
                    "file": state.relative_path(caller_file),
                    "line": caller_line,
                    "source": state.source_line(caller_file, caller_line),
                    "function": frame.f_code.co_name if frame is not None else "",
                    "depth": state.frame_depth(frame) if frame is not None else 0,
                    "frameId": state.frame_id(frame) if frame is not None else None,
                },
            )
    return ORIGINAL_IMPORT(name, globals, locals, fromlist, level)


def normalize_argv(argv):
    if not argv:
        raise ValueError("Trace command is required.")
    items = list(argv)
    first = os.path.basename(items[0])
    if first in {"python", "python3", "python.exe", "python3.exe"}:
        items = items[1:]
    while items and items[0] in {"-u", "-B", "-I", "-s", "-S", "-E"}:
        items = items[1:]
    if not items:
        raise ValueError("Python script or module is required.")
    return items


def trace_entry_files(root_path, argv):
    try:
        items = normalize_argv(argv)
    except Exception:
        return []
    if not items or items[0] == "-m":
        return []
    script_path = items[0]
    if not os.path.isabs(script_path):
        script_path = os.path.join(root_path, script_path)
    return [os.path.realpath(script_path)]


def run_target(root_path, argv, python_path_mode="project"):
    argv = normalize_argv(argv)
    if python_path_mode != "console-script":
        sys.path.insert(0, root_path)

    if argv[0] == "-m":
        if len(argv) < 2:
            raise ValueError("Missing module name after -m.")
        module_name = argv[1]
        sys.argv = [module_name, *argv[2:]]
        TRACE_STATE.emit("start", {"command": ["python", *argv], "mode": "module", "module": module_name})
        runpy.run_module(module_name, run_name="__main__", alter_sys=True)
        return

    script_path = argv[0]
    if not os.path.isabs(script_path):
        script_path = os.path.join(root_path, script_path)
    script_path = os.path.realpath(script_path)
    sys.argv = [script_path, *argv[1:]]
    TRACE_STATE.emit(
        "start",
        {
            "command": ["python", *argv],
            "mode": "script",
            "script": TRACE_STATE.relative_path(script_path),
        },
    )
    runpy.run_path(script_path, run_name="__main__")


def main():
    global TRACE_STATE

    request = json.load(sys.stdin)
    root_path = os.path.realpath(request["rootPath"])
    argv = request.get("argv") or []
    max_events = int(request.get("maxEvents") or 20000)
    python_path_mode = request.get("pythonPathMode") or "project"
    TRACE_STATE = TraceState(root_path, max_events=max_events, extra_files=trace_entry_files(root_path, argv))

    sys.stdout = EventStream("stdout")
    sys.stderr = EventStream("stderr")
    builtins.__import__ = traced_import
    sys.settrace(trace_func)
    threading.settrace(trace_func)

    exit_code = 0
    try:
        run_target(root_path, argv, python_path_mode)
    except SystemExit as error:
        exit_code = int(error.code) if isinstance(error.code, int) else 1
        TRACE_STATE.emit("system_exit", {"code": exit_code})
    except Exception as error:
        exit_code = 1
        TRACE_STATE.emit(
            "fatal",
            {
                "exceptionType": type(error).__name__,
                "message": str(error),
                "traceback": traceback.format_exc(limit=12),
            },
        )
    finally:
        sys.settrace(None)
        threading.settrace(None)
        builtins.__import__ = ORIGINAL_IMPORT
        sys.stdout = ORIGINAL_STDOUT
        sys.stderr = ORIGINAL_STDERR
        TRACE_STATE.emit("finish", {"exitCode": exit_code})

    raise SystemExit(exit_code)


if __name__ == "__main__":
    main()
