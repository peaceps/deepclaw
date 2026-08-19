# Screenshots

The README points at these by name. Each one is described in an HTML comment right above the
image it belongs to, in `README.md`.

| File | What it should show |
|------|---------------------|
| `board.png` | The Project Board with one project open, tasks in all three columns |
| `agents.png` | The Agents page with an agent selected and its detail panel open |
| `chat.png` | A chat where the agent has called a tool |
| `cron.png` | The Scheduled Tasks page with an execution history expanded |
| `skills.png` | The Skills page with a few skills installed |
| `mobile.png` | The agents page in a narrow window |

Both `README.md` and `README.zh-CN.md` use the same files.

They are referenced by their absolute `raw.githubusercontent.com` address rather than a relative
path, because the english readme is also what npm shows on the package page, and a relative path
has nothing to resolve against there.
