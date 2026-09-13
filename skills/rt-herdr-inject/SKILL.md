---
name: rt:herdr-inject
description: Use when a Claude Code session needs a user-only slash command run in itself (/cd, /exit, /resume, /model) or needs a line typed into another agent's herdr pane ... or the moment you catch yourself working out whether this is a herdr pane and what its id is. Not for chat (see rt:chat) or for starting agents (rt agent, rt pane spawn).
---

# rt herdr-inject

`rt pane send` types a line into a herdr pane as if a human had typed it and
pressed Enter. `self` names the pane this session runs in, so an agent never
needs the herdr CLI, its pane id, or a check that it is inside herdr.

`rt pane send --help` is the live reference; trust it over anything here.

## Your own pane

```bash
rt pane send self --text "/cd /Users/matt/Documents/GitHub/chat"
```

- It always reports `queued`: you are mid-turn, so the line sits in the
  composer until your turn ends. **End your turn** right after, with one
  short line saying what was queued. More tool calls only delay it.
- Chain a continuation so nobody has to say "continue":

```bash
rt pane send self --text "/cd <repo>" --then "Continue: enter worktree <name> for <ticket>"
```

  Both lines run in order after the turn ends; the second arrives as your
  next user message, so phrase it as the instruction you want to receive.
- `not in a herdr pane (HERDR_PANE_ID unset)` means there is no pane to
  type into. Ask the human to type the line; never guess a pane id or fall
  back to the herdr CLI.

## Another agent's pane

```bash
rt pane list                       # find the pane id
rt pane send <pane> --text "..."   # accepted | queued | refused (reason)
```

`accepted` means the agent picked it up; `queued` means it was working and
will see it after its turn; `refused` says why (at a prompt, not a claude
pane). None of these exit non-zero; read the verdict.

## Body rules

- One line. For a body with quotes or `$`, pipe it: `printf '%s' "$body" | rt pane send self --text -`.
- Keep backticks out of `--text`; the shell eats them.
- `--json` for scripts: `{ ok, paneId, delivered, reason?, then? }`.
