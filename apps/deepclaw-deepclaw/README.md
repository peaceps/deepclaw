# Deepclaw

An agent you run yourself, with a web ui and a terminal ui.

## Install

Node 21 or newer is required.

```bash
npm install -g @deepclaw/deepclaw
```

## Start

```bash
deepclaw start            # the web ui, on http://localhost:3000
deepclaw start --tui      # the terminal ui
```

| Option   | What it does                                          |
| -------- | ----------------------------------------------------- |
| `--tui`  | Opens the terminal ui instead of the web ui            |
| `--port` | Port of the web ui, 3000 unless another one is named   |
| `--host` | Address the web ui binds to, `127.0.0.1` by default    |

The first start walks you through the settings: which model to talk to, and the key to talk to it
with.

The web ui asks for no password, so it stays on the machine it runs on. Anyone who reaches it can
send your agents to work with your keys, which is worth remembering before handing it an address of
the network with `--host`.

## Where your things are kept

Everything an agent reads or writes lives in `~/.deepclaw`, whatever folder you started from: the
agents you wrote, their skills, the images they made, the logs and your settings. Name another
folder with `DEEPCLAW_HOME` to keep more than one of these side by side.

```bash
DEEPCLAW_HOME=~/work/deepclaw deepclaw start
```
