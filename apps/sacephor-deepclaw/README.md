# Deepclaw

An agent platform you run yourself. Create agents, give them skills, chat with them, and let them
execute projects and scheduled tasks — with a web UI and a terminal UI.

Web UI use Kanban to manage your projects, you can view familiar task status through Kanban board.

## Install

Node 21 or newer is required.

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

## What it does

### Agent chat

Each agent runs its own LLM conversation loop. You chat with an agent in the web UI or the terminal,
it streams responses back, and it can call tools along the way — reading and writing files, running
shell commands, generating images — all visible in the chat.

Agents have identity: a name, a role, a personality, areas of expertise, and an avatar. You create
as many as you need (up to 30), each with its own model configuration. An agent in `chat` mode
answers questions; an agent in `agent` mode can also use tools and run tasks.

Supported LLM providers:

- Anthropic (Claude) — native tool-use protocol
- OpenAI — chat completions and the responses API
- Any OpenAI-compatible endpoint (baseURL + apiKey)

### Project management

Projects organize work. Each project has a description, priority, tags, and a set of tasks. Tasks
have dependencies (`blockedBy` / `blocks`), an assignee, a status (`todo` → `ongoing` → `done`),
and can be broken into steps with progress tracking.

Agents don't just list tasks — they execute them. An agent picks up an assigned task, spawns a
sub-loop to work on it, calls tools as needed, and reports back with results. The project board
updates in real time as tasks move through their lifecycle.

### Task orchestration

When an agent works on a task, it runs in a **sub-loop** — an isolated conversation focused on that
one task, with its own context window and tool access. The sub-loop agent can:

- Read the task description and steps
- Use all available tools (files, commands, skills, etc.)
- Update task status and step progress
- Produce a structured output when finished

Multiple tasks can run in parallel across different agents. The orchestrator tracks which tasks are
running, which are blocked, and which are ready to start.

### Scheduled tasks (cron)

Create recurring tasks that run on a cron schedule. Each cron task has a prompt that is sent to an
agent at the scheduled time — the agent runs a full loop, uses tools, and produces output.

Cron features:

- Standard cron expressions for scheduling
- Pause / resume without losing history
- Full run history with status, output, and token usage
- Next run time shown alongside the last run

### Skills

Skills are reusable instruction sets that extend what an agent can do. A skill is a folder with a
`SKILL.md` file (frontmatter + markdown body) and optional supporting files.

Built-in skill operations:

- **Load** — an agent reads a skill's instructions on demand
- **Search** — search public skill registries for new skills
- **Download** — install a skill from a remote source
- **Create** — write a new skill directly through the agent
- **Remove** — delete a skill
- **Assign** — restrict a skill to specific agents, or make it available to all

Skills live in `~/.deepclaw/skills/` and are hot-reloadable.

### Memory

Agents persist what they learn. Memory entries are typed and scoped:

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

Agents decide when to save memories on their own, using guidelines embedded in the memory tool
description. Memories are stored as markdown files with frontmatter.

### Image generation

Agents can generate images through multiple providers:

- OpenAI (GPT-image / DALL·E)
- Alibaba (Qwen)
- ByteDance (Seedream)

Each agent can be configured with its own image model and API key.

### IM integration

Agents can connect to messaging platforms and respond to messages there:

- **DingTalk** — receive and reply to messages as a bot
- **Feishu (Lark)** — same, through the Feishu open platform

IM is configured per agent. When enabled, the agent processes incoming messages through its normal
conversation loop and replies in the chat.

### MCP (Model Context Protocol)

Connect external tool servers through MCP. Any MCP-compatible server exposes its tools to your
agents automatically — the tools are discovered, named with an `MCP_` prefix, and become available
alongside the built-in ones.

Configure the MCP server URL in the advanced settings.

### Built-in tools

| Tool | What it does |
|------|-------------|
| `read_file` / `write_file` / `edit_file` | File operations |
| `run_sync_command` | Run a shell command and wait for output |
| `run_background_command` | Start a long-running process |
| `check_background_command_status` | Poll a background process |
| `generate_image` | Generate an image via the configured provider |
| `create_project` / `update_project` | Create and manage projects |
| `create_simple_task` / `update_task` | Create and manage tasks |
| `update_task_current_step` | Advance task step progress |
| `get_project_list` / `get_project_detail` | Read project state |
| `task_loop` | Hand one task of the project to a subagent that can split it further |
| `sub_loop` | Spawn a sub-loop for one piece of work |
| `create_cron_task` / `update_cron_task` | Manage scheduled tasks |
| `load_skill_details` / `search_online_skills` / `download_skill` / `create_skill` / `remove_skill` | Skill operations |
| `read_memory_detail` | Read a specific memory entry |
| `base64` | Encode / decode base64 |

## Where your things are kept

Everything lives in `~/.deepclaw`, whatever folder you started from:

```
~/.deepclaw/
├── .deepclaw.config.json     # settings: agents, models, IM, MCP
├── agents/                   # per-agent session files and memory
├── projects/                 # project data and task state
├── crons/                    # cron task definitions and history
├── skills/                   # installed skills
├── memories/                 # global memory entries
└── .logs/                    # runtime logs
```

Name another folder with `DEEPCLAW_HOME` to keep more than one of these side by side:

```bash
DEEPCLAW_HOME=~/work/deepclaw deepclaw start
```

## Supported platforms

Deepclaw runs on Linux, macOS, and Windows. The web UI opens in your browser; the terminal UI
works in any terminal that supports 24-bit color.
