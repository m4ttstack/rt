---
name: mr-board:respond
description: >-
  Thin, domain-agnostic wrapper the mr-board launches to process review feedback
  on your OWN MR in a fresh herdr pane. Emits lifecycle status to a state file
  the board reads, then delegates the actual work to the skill named by --skill.
  Invoked as "/mr-board:respond <mrUrl> --state <path> --status-bin
  <path> [--skill <name>]". Not for manual use.
---

# mr-board respond runner

The mr-board spawned this pane to process the review feedback on ONE of your own
MRs and report status back to the board via a state file. This wrapper carries
**no** domain knowledge — the board injects it:

| flag | meaning |
|------|---------|
| `<mrUrl>` (positional) | your merge request whose feedback to process |
| `--state <path>` | lifecycle status file the board polls |
| `--status-bin <path>` | absolute path to the board's status-writer CLI |
| `--skill <name>` | the domain skill that owns the actual work (optional) |

Write status **only** by running the injected `--status-bin`:

```
bun run <status-bin> <state> <status> [message]
```

The board tracks five in-flight statuses; emit each as you cross the milestone:

| Status | When to emit |
|--------|--------------|
| `triaging` | Immediately, before fetching threads. |
| `implementing` | Only after the code-changes gate is approved, before touching code. Skip when no threads need code changes. |
| `drafting` | When presenting the verdict table + drafted replies, and again after implementation before posting finalized replies. |
| `done` | After the run finishes — replies posted (or the human elected not to) and any code committed. |
| `error` | Anything unrecoverable (bad MR, no threads to process, delegated skill failed). |

## Steps

1. **Mark triaging.** `bun run <status-bin> <state> triaging`
2. **Do the work.**
   - **If `--skill` was given:** delegate to that skill with the MR url. It owns
     the real work — resolving the MR/ticket, fetching unresolved human threads,
     evaluating them, drafting replies, and reaching its posting gates. Follow it
     exactly. Do **not** judge comments inline, and do **not** post or commit
     anything unless the human approves at each gate.
   - **If no `--skill`:** fetch the MR's unresolved review threads yourself,
     evaluate each on its merits, and draft replies. Hold at a posting gate.
3. **Emit `drafting`** when the verdict table + per-thread draft replies are on
   screen: `bun run <status-bin> <state> drafting`
4. **Emit `implementing`** only if the human approves writing fixes:
   `bun run <status-bin> <state> implementing`. When implementation finishes and
   you're back to finalized replies, emit `drafting` again before offering to post.
5. **Mark done.** After the run wraps — replies posted (on approval) or the human
   declined, and any code committed:
   `bun run <status-bin> <state> done "<one-line summary>"`
   Keep it short, e.g. `"3 threads: 2 fixed, 1 pushback"` or
   `"no valid threads — replied with technical pushback"`.
6. **On failure.** `bun run <status-bin> <state> error "<what went wrong>"`,
   then stop and report to the human in the pane.

## Rules

- Always write `triaging` first and a terminal `done`/`error` when finished, so
  the board badge never gets stuck. The board owns `queued`; you own the middle.
- The state and status-bin paths are absolute and given to you. Only write
  status via `--status-bin`; never touch the state file directly.
- Posting gates are non-negotiable. Never post replies or commit fixes without
  the human's explicit go-ahead at each gate, even to hurry the badge to `done`.
  The final posting gate is a **multi-select** over which verdict categories to
  post — present it; do not post every reply wholesale, and do not skip the ask
  and idle. `done` follows the human's pick, not your own call.
- After marking done, stay in the pane so the human can act on leftover drafts.
- If there are zero unresolved human threads, mark `done` with the summary
  `"no unresolved threads"`. That is not an error condition.
