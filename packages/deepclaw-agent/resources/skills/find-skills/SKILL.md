---
name: find-skills
description: "Search and install agent skills from skills.sh. Use when: user asks how to do X, wants a skill for X, asks can you do X, or wants to extend agent capabilities."
---

# Find Skills

This skill helps you discover and install skills from the [skills.sh](https://skills.sh/) ecosystem.

## When to Use

Use this skill when the user:

- Asks "how do I do X" where X might be a common task with an existing skill
- Says "find a skill for X" or "is there a skill for X"
- Asks "can you do X" where X is a specialized capability
- Wants to search for tools, templates, or workflows
- Wishes they had help with a specific domain (design, testing, deployment, etc.)

## Skill System in Deepclaw

Deepclaw loads skills from the `.agents/skills/` directory (relative to the working directory). Each skill is a subdirectory containing a `SKILL.md` file with frontmatter:

```yaml
---
name: skill-name
description: "Short description of what this skill does and when to use it."
---

Skill body content...
```

Skills are loaded into memory via `SkillsManager` and can be accessed using the `load_skill` tool. After installing a new skill, call `refresh_skill` to reload the skill list without restarting the session.

## How to Find and Install Skills

### Step 1: Search

```bash
npx skills find [query]
```

Example queries:
- `npx skills find react performance`
- `npx skills find pr review`
- `npx skills find changelog`

The command returns results like:

```
vercel-labs/agent-skills@vercel-react-best-practices
└ https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices
```

### Step 2: Present Options

Show the user what you found:

1. Skill name and description
2. The install command
3. Link to learn more at skills.sh

### Step 3: Install

`npx skills add` installs into `.agents/skills/` in the current directory by default, which is exactly where deepclaw loads skills from — so no extra move step is needed. Pass `--agent cursor` to force the `.agents/skills/` target deterministically:

```bash
npx skills add vercel-labs/agent-skills@vercel-react-best-practices --agent cursor -y
```

Run this from deepclaw's working directory (`DEEPCLAW_HOME` if set, otherwise the process CWD) so the skill lands in the directory deepclaw actually reads.

**Never use the `-g` / `--global` flag.** Global installs go to a user-level directory (e.g. `~/.cursor/skills`), which deepclaw does NOT load. Always install project-locally into `.agents/skills/`.

### Step 4: Refresh

After installation, call the `refresh_skill` tool to reload the skill list so the new skill is available immediately:

```
refresh_skill()
```

This returns the list of all available skills including the newly installed one.

### Step 5: Verify and Use

Confirm the skill is loaded by calling `load_skill` with the skill name:

```
load_skill(name="<skill-name>")
```

Then follow the instructions in the skill content to help the user.

## Search Tips

1. **Use specific keywords**: "react testing" is better than "testing"
2. **Try alternative terms**: If "deploy" doesn't work, try "deployment" or "ci-cd"
3. **Browse categories**: web development, testing, devops, documentation, code quality, design, productivity

## When No Skills Are Found

1. Acknowledge that no existing skill was found
2. Offer to help with the task directly
3. Suggest the user could create their own skill by writing a `.agents/skills/<name>/SKILL.md` file

## Common Skill Sources

| Source | Example |
|--------|---------|
| vercel-labs/agent-skills | React/Next.js best practices |
| ComposioHQ/awesome-claude-skills | General purpose tools |
| Community repos | Domain-specific skills |
