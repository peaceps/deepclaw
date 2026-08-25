---
name: agent-browser
description: "Drives a real browser, and Electron desktop apps too: open pages, fill forms, click, screenshot, scrape, log in, test and QA a running app. Use when: anything asks for the web, 打开网页, 填表单, 截图, 抓取页面数据, or automating Slack, VS Code and the like."
modes: [agent]
---

# agent-browser

Fast browser automation CLI for AI agents. Chrome/Chromium via CDP with accessibility-tree snapshots and compact `@eN` element refs.

## Start here

This file is a discovery stub, not the usage guide. The CLI is no part of deepclaw and may well not be on this machine, so make sure of it first and read the workflows out of it before running anything else:

```bash
agent-browser --version
agent-browser skills get core             # workflows, common patterns, troubleshooting
```

Nothing in this skill works without the CLI, and installing it is the user's to do rather than yours: `npm i -g agent-browser && agent-browser install` fetches a browser and runs for minutes, far longer than one command here is given. Where the version does not come back, hand them that line and stop. Do the same where it cannot be installed at all, for want of a network or of the right to install globally.

Take `skills get core` as it comes and leave `--full` alone, whatever the CLI says about it. The full reference runs to some seventy thousand characters, which is filed away to disk and handed back as a path rather than read, and reading that file back is over the same limit again: there is no way round to the whole of it. What `skills get core` answers with fits.

A screenshot is written to a file, and a file path shows the user nothing: they are reading the chat somewhere else than where you wrote it. Hand the path to `keep_image` and put the reference it answers with in your own reply, as `![](dcimg://...)`. Do it for a screenshot the user asked for or one that shows what they asked about, not for the ones you take to find your own way around.

Run each command on its own and pipe it into nothing, whatever the CLI's own examples do with `head` or `jq`. A line that hands the rest of itself to another program is a line the user is asked about, while a line of `agent-browser` alone is not; and an answer too long to read is filed away and handed back as a path regardless, which is all a `head` was there for.

The CLI serves skill content that always matches the installed version, so instructions never go stale. The content in this stub cannot change between releases, which is why it just points at `skills get core`.

## Specialized skills

Load a specialized skill when the task falls outside browser web pages:

```bash
agent-browser skills get electron          # Electron desktop apps (VS Code, Slack, Discord, Figma, ...)
agent-browser skills get slack             # Slack workspace automation
agent-browser skills get dogfood           # Exploratory testing / QA / bug hunts
agent-browser skills get derive-client     # Record a HAR, derive a standalone API client for a site
agent-browser skills get vercel-sandbox    # agent-browser inside Vercel Sandbox microVMs
agent-browser skills get protected-vercel-deployments  # Access protected Vercel deployments
agent-browser skills get agentcore         # AWS Bedrock AgentCore cloud browsers
```

Run `agent-browser skills list` to see everything available on the installed version.

## Why agent-browser

- Fast native Rust CLI, not a Node.js wrapper
- Works with any AI agent (Cursor, Claude Code, Codex, Continue, Windsurf, etc.)
- Chrome/Chromium via CDP with no Playwright or Puppeteer dependency
- Accessibility-tree snapshots with element refs for reliable interaction
- Sessions, authentication vault, state persistence, video recording
- Specialized skills for Electron apps, Slack, exploratory testing, cloud providers

## Observability Dashboard

The dashboard runs independently of browser sessions on port 4848 and can also be opened through a proxied or forwarded URL such as `https://dashboard.agent-browser.localhost`. Agents should stay on the dashboard origin: session tabs, status, and stream traffic are proxied internally, so session ports do not need to be exposed.
