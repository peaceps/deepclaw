**English** | [简体中文](https://github.com/peaceps/deepclaw/blob/main/README.zh-CN.md)

# Deepclaw

An agent platform you run yourself. Hire a team of agents, give them skills, and put them to work on
your projects and your schedule — through a web UI or a terminal.

Everything runs on your machine, against your own model keys. Nothing is sent anywhere you did not
configure.

<!-- Screenshot: the Project Board with one project open, tasks spread across all three columns,
     ideally a couple of them showing an owner avatar and a progress bar. This is the first thing
     anyone sees, so pick the project that looks most alive. -->

![The project board](https://raw.githubusercontent.com/peaceps/deepclaw/main/docs/images/en/board.png)

## Install

Node 21 or newer is required. Deepclaw runs on Linux, macOS, and Windows.

```bash
npm install -g @sacephor/deepclaw
```

## Start

```bash
deepclaw start            # the web UI, on http://localhost:3000
deepclaw start --tui      # the terminal UI
```

| Option   | What it does                                          |
| -------- | ----------------------------------------------------- |
| `--tui`  | Opens the terminal UI instead of the web UI            |
| `--port` | Port of the web UI, 3000 unless another one is named   |
| `--host` | Address the web UI binds to, `127.0.0.1` by default    |

The first start walks you through the settings: which model to talk to, and the key to talk to it
with.

The web UI asks for no password, so it stays on the machine it runs on. Anyone who reaches it can
send your agents to work with your keys, which is worth remembering before handing it an address of
the network with `--host`.

## Around the app

Five places in the sidebar: **Agents**, **Project Board**, **Scheduled Tasks**, **Skills**, and
**Settings**.

### Agents

<!-- Screenshot: the Agents page with an agent selected, so the list is on the left and the detail
     panel on the right. Best if that agent is busy, so the "Running Now" card has a task with a
     progress bar in it. -->

![The agents page](https://raw.githubusercontent.com/peaceps/deepclaw/main/docs/images/en/agents.png)

Every agent is someone: a name, an avatar, a role, personality traits, and the areas it is good at.
You hire them in the settings and fire them there too.

Pick one and the detail panel tells you what it is doing right now — the tasks it is running and how
far along they are, the project it belongs to, the scheduled tasks waiting for it. Agents are marked
busy or idle, and they carry a mood: happy, focused, tired, confused, or keeping it to themselves.

### Chat

<!-- Screenshot: a permission request open over a chat — the transcript dimmed behind it, the
     question card in front with its Allow once / Always allow / Deny buttons. Ask an agent to run
     a command it has to check on first and one of these shows up. -->

![Chatting with an agent](https://raw.githubusercontent.com/peaceps/deepclaw/main/docs/images/en/permission.png)

Talk to an agent, or talk to a project. Replies stream back as they are written, and you can attach
images to a message.

A run you have seen enough of ends where it stands: **Stop** takes the place of Send for as long as
an agent is working, and reaches the model mid-sentence, the command it is running, and every
subagent it sent out. What it had already said stays in the conversation, and what you say next
carries on from there — stopping ends the run rather than pausing it. Any tab showing that
conversation can stop it, not only the one that started it.

When an agent needs something only you can decide, it stops and asks — before running a command it
should check on first, or before touching a file outside the folder it works in. The question opens
in front of you: allow it once, allow that kind of thing for the rest of the session, or refuse. If
you have wandered off, a notification tells you someone is waiting. The question follows the
conversation rather than the tab you asked from: close that tab, and another one showing the same
conversation is asked in its place.

An agent can also put a question of its own to you, with answers to pick between or a line to write
in, and it stands still where it asked until you answer. A subagent asks through the conversation of
the run that sent it out, so work going on somewhere down the tree still comes to you here.

A conversation can be closed and begun again from nothing. **New conversation** files the current one
away and leaves the agent an empty context, which is what to reach for once what you are asking about
has moved on and the history behind it is only cost. The ones you have closed are kept under **Past
conversations**, each named after the first thing asked in it and carrying the day it ran, the turns
it took, and what it spent; open one to read it back. An agent still working, or still holding a
background command, keeps the conversation it is in until that is done.

Each conversation shows what it cost in tokens, including how much of the input was served from
cache.

### Project Board

Tasks sit in three columns — todo, ongoing, done — and move across as the work gets done. A card
carries its owner, its priority, its progress, and the tasks it is waiting on. Search a project by
title, description, or tag, or narrow the board to one owner.

Two buttons on a task card give you a way in. **Pause** tells the agent to stop once that task is
finished instead of rolling on to the next one. When it stops there, the task waits for your
**verification**: nothing continues until you have looked at it and said so. Use it on the steps you
want to see before they are built on. A task nobody has picked up yet can also be handed to someone
else, from the pencil beside its owner — once the work has been taken, it stays with whoever took
it.

Finished tasks carry a report you can read in place or download. A finished project carries one of
its own, on the project's row: what the whole of the work came to, which no single task report
says.

<!-- Screenshot: the report window of a finished task, opened by the "View" link on a done card.
     Best with the markdown rendered out — headings, a list, maybe a table — and enough of it to
     look like real work, with the Download button showing at the bottom. -->

![A finished task's report](https://raw.githubusercontent.com/peaceps/deepclaw/main/docs/images/en/output.png)

### Scheduled Tasks

<!-- Screenshot: the Scheduled Tasks page with one task expanded so its execution history is
     visible, showing a couple of past runs. -->

![Scheduled tasks](https://raw.githubusercontent.com/peaceps/deepclaw/main/docs/images/en/cron.png)

Work that repeats: a prompt, a schedule, and the agent that gets it. Each one shows when it last ran
and when it will run next, keeps a full history of its runs, and can be paused and resumed without
losing any of it.

You do not have to fill in a form to make one. Tell an agent what to run and when, and it will set
the task up for you.

### Skills

<!-- Screenshot: the Skills page listing a few installed skills, with the "Applied to" column
     showing at least one skill limited to a specific agent. -->

![The skills page](https://raw.githubusercontent.com/peaceps/deepclaw/main/docs/images/en/skills.png)

Skills are things your agents know how to do, listed here with what each one is for and which agents
it applies to. A skill can be open to everyone or kept to one agent.

Like scheduled tasks, you install these by asking. Tell an agent to go find a skill and set it up,
and it will search, download, and install it for you. One that has served its purpose goes off the
disk from the bin at the end of its row, which asks before it does.

### Settings

Language, and one card per agent: who they are, which model they use and the key for it, which model
they draw with, and whether they answer in DingTalk or Feishu. The MCP server address lives under
advanced settings.

### In your language, on your phone

The whole interface speaks English and 简体中文; pick one in the settings and everything follows.

The agents page and the chat have a layout built for a narrow screen, and the board's columns stack
when there is no room beside each other — so checking in on your agents from your phone works.

<!-- Screenshot: the agents page in a narrow browser window (or an actual phone), to show the
     mobile layout. A tall, narrow image sits better here than a wide one. -->

![On a phone](https://raw.githubusercontent.com/peaceps/deepclaw/main/docs/images/en/mobile.png)

## What your agents can do

**Use your computer.** Agents in `agent` mode read and write files, run shell commands, and wait on
long-running processes. Agents in `chat` mode only talk, which is the right setting when you want an
assistant rather than an operator.

**Take a project to the end.** An agent given a task works it in an isolated conversation of its
own, calls whatever tools it needs, and reports back. Several tasks run at once across different
agents, and the board keeps up in real time. Dependencies are respected: a task waits for the ones
it is blocked by.

**Remember what matters.** Agents keep notes as they learn: your preferences, the rules and
corrections you have given them, and pointers to the documents and dashboards you keep sending them
to. A note can belong to everyone, to one agent, or to one project.

**Draw.** Images through OpenAI (GPT-image), Alibaba (Qwen-Image), or ByteDance (Seedream), each
agent with its own model and key.

**Answer in DingTalk or Feishu.** Connect an agent to a messaging platform and it handles what
arrives there through the same conversation loop, replying in the chat.

## Reference

### Models it can talk to

- Anthropic (Claude) — native tool-use protocol
- OpenAI — chat completions and the responses API
- Any OpenAI-compatible endpoint (baseURL + apiKey)

Up to 30 agents, each with its own model configuration.

### Skills on disk

A skill is a folder with a `SKILL.md` file (frontmatter + markdown body) and any supporting files it
needs. They live in `~/.deepclaw/.agents/skills/` and are hot-reloadable, so a skill you drop in by
hand is picked up without a restart.

### Memory on disk

Memories are markdown files with frontmatter. Each carries a scope and a type:

| Scope | What it covers |
|-------|---------------|
| `global` | Applies to all agents and projects |
| `agent` | Private to one agent |
| `project` | Tied to the current project or cron task |

| Type | When to use it |
|------|---------------|
| `preference` | User's style, habits, defaults |
| `rules` | Constraints, corrections, decisions |
| `reference` | Pointers to external docs, dashboards, tickets |

Agents decide when to write one on their own, following guidelines carried in the memory tool's
description.

### Sub-loops

A task handed to an agent runs in a **sub-loop**: a conversation dedicated to that one task, with
its own context window and its own access to tools. It reads the task and its steps, works, updates
the status and the step progress as it goes, and produces a structured output at the end. The
orchestrator tracks which tasks are running, which are blocked, and which are ready to start.

### MCP (Model Context Protocol)

Connect external tool servers through MCP. Any MCP-compatible server exposes its tools to your
agents automatically — the tools are discovered, named with an `MCP_` prefix, and become available
alongside the built-in ones. Set the server URL in the advanced settings.

### Built-in tools

| Tool | What it does |
|------|-------------|
| `read_file` / `write_file` / `edit_file` | File operations |
| `run_sync_command` | Run a shell command and wait for output |
| `run_background_command` | Start a long-running process |
| `check_background_command_status` / `check_all_background_command_status` | Poll one background process, or all of them |
| `remove_background_command` | Drop a background process that is no longer needed |
| `generate_image` | Generate an image via the configured provider |
| `create_project` / `update_project` | Create and manage projects |
| `update_task` | Move a task along and file what it produced |
| `update_task_current_step` | Advance task step progress |
| `get_project_list` / `get_project_detail` | Read project state |
| `task_loop` | Hand one task of the project to a subagent that can split it further |
| `sub_loop` | Spawn a sub-loop for one piece of work |
| `create_cron_task` / `update_cron_task` | Manage scheduled tasks |
| `update_cron_output` | Report what a cron run produced |
| `get_cron_histories` | Read back what earlier runs of a cron task produced |
| `load_skill_details` / `search_online_skills` / `download_skill` / `create_skill` / `remove_skill` / `refresh_skills` | Skill operations |
| `save_memory` / `read_memory_detail` | Keep something worth remembering, and read it back |
| `ask_user` | Put a question to you and wait on the answer |
| `update_agent_runtime` | Let an agent set its own mood and emotion |
| `base64` | Encode / decode base64 |

### Where your things are kept

Everything lives in `~/.deepclaw`, whatever folder you started from:

```
~/.deepclaw/
├── .deepclaw.config.json     # settings: agents, models, IM, MCP
├── DEEPCLAW.md               # what every agent is told about this place
├── .agents/                  # per-agent session files and memory
│   └── skills/               # installed skills
├── .projects/                # project data and task state
├── .cron/                    # cron task definitions and history
├── .memory/                  # global memory entries
└── .logs/                    # runtime logs
```

Name another folder with `DEEPCLAW_HOME` to keep more than one of these side by side:

```bash
DEEPCLAW_HOME=~/work/deepclaw deepclaw start
```

## Development

Working on deepclaw itself rather than running it:

```bash
pnpm install
pnpm web      # the web UI
pnpm tui      # the terminal UI
```

These start the app straight from the sources rather than through the installed launcher, so they
never reach for `~/.deepclaw`: the data lands in whatever folder the command ran from. Name one with
`DEEPCLAW_HOME` to keep your own data out of the checkout.

`@sacephor/deepclaw` is the one package of this workspace that gets published. Everything else is
bundled or built into it, so an install needs nothing else of deepclaw from the registry.

```bash
pnpm build
pnpm release
```
