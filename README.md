# CodeTrace

CodeTrace is a browser-based Python runtime trace explorer. It shows the real path a Python command takes while running: imports, calls, executed lines, returns, output, and exceptions.

The npm package is `@codetrace/cli`. The command name is `ctrace`.

## Demo

[Watch the CodeTrace demo on Bilibili](https://www.bilibili.com/video/BV19yRiB8EoV/?vd_source=c89f5d5b919d036b4d8f0e7bf1406833)

[Watch the CodeTrace demo on YouTube](https://www.youtube.com/watch?v=ca8MJnw-QWg)

<img width="1892" height="849" alt="ctrace-demo" src="https://github.com/user-attachments/assets/ff227a9f-2282-4bb4-98f3-1b8320e46ce8" />


## Install

```bash
npm install -g @codetrace/cli
```

Check the installation:

```bash
ctrace doctor
```

## Start

Start the browser service:

```bash
ctrace serve
```

Open:

```text
http://127.0.0.1:3038
```

`ctrace serve` starts the web UI. It defaults to `127.0.0.1:3038`.

Use another host or port when needed:

```bash
ctrace serve -h 0.0.0.0 -p 3038
```

## Add A Repo

In the browser UI, click `+` in the Projects panel, choose a repo directory, then click `Index`.

## Trace In The Browser

Enter a command in the Runtime Trace input and click `Trace Run`:

```bash
python app.py
/path/to/venv/bin/python app.py
/path/to/venv/bin/some-python-cli --help
```

The graph streams while the command runs. Click a source node to open the editable source viewer at the matching line.

## Trace From A Terminal

Keep `ctrace serve` running first. Then run:

```bash
cd /path/to/repo
ctrace run python app.py
```

From another directory, specify the repo:

```bash
ctrace run -r /path/to/repo python app.py
```

`ctrace run` does not start the browser service. It runs the command and sends trace events to the running CodeTrace UI.

## Common Commands

```bash
ctrace serve
ctrace serve -h 0.0.0.0 -p 3038
ctrace run python app.py
ctrace run -r /path/to/repo python app.py
ctrace doctor
```

## Requirements

- Node.js 20 or newer.
- Python 3.8+ for traced Python programs.
- System `python3` for static repo indexing.

## Timing

CodeTrace is for understanding runtime workflow, not raw performance. Python tracing hooks add overhead, so measured runtime inside CodeTrace can be much slower than a normal run.
