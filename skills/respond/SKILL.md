---
name: mr-board:respond
description: >-
  Thin, domain-agnostic wrapper the mr-board launches to process review feedback
  on your OWN MR in a fresh herdr pane. Emits lifecycle status to a state file
  the board reads, then delegates the actual work to the skill named by --skill.
  Invoked as "/mr-board:respond <mrUrl> --state <path> --status-bin
  <path> [--skill <name>]". When no --skill is given, the domain skill is
  resolved from the respond slot binding in .mattstack/skills.jsonc. Not for
  manual use.
allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/resolve-args.sh:*)
metadata:
  slots: "respond"
  slot-respond: "required mr-respond@1 -- owns processing review feedback on your own MR: fetching unresolved threads, evaluating them, drafting replies, and its own posting gates"
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
bun run <status-bin> <state> done <message> --posted <n> --threads <n>
```

The board tracks five in-flight statuses; emit each as you cross the milestone:

| Status | When to emit |
|--------|--------------|
| `triaging` | Immediately, before fetching threads. |
| `implementing` | Only after the code-changes gate is approved, before touching code. Skip when no threads need code changes. |
| `drafting` | When presenting the verdict table + drafted replies, and again after implementation before posting finalized replies. |
| `done` | After the run finishes. REQUIRED: `--posted <n> --threads <n>` (see step 5). |
| `error` | Anything unrecoverable (bad MR, no threads to process, delegated skill failed). |

## Resolving the domain skill

The domain skill that owns the actual work comes from the first source that
answers; the order is fixed:

1. **Explicit `--skill <name>` wins.** When the board passed it, use it and do
   not run the resolver. This is the historical launch path, unchanged.
2. **Otherwise resolve the `respond` slot.** Run the vendored resolver:

   ```bash
   "${CLAUDE_SKILL_DIR}/scripts/resolve-args.sh"
   ```

   On exit 0, read the SKILL.md at `resolved.respond.path` and treat that
   skill exactly as if it had been passed via `--skill`.
3. **Otherwise degrade loudly.** On a nonzero exit, print the resolver's JSON
   `errors` verbatim in the pane. Never guess or substitute a binding; the
   script is the only enforcement point. Then proceed with the generic
   domain-free flow described in the steps below.

## Steps

1. **Mark triaging.** `bun run <status-bin> <state> triaging`
2. **Do the work.**
   - **If a domain skill resolved** (explicit `--skill`, else the `respond`
     slot per "Resolving the domain skill"): delegate to that skill with the MR url. It owns
     the real work — resolving the MR/ticket, fetching unresolved human threads,
     evaluating them, drafting replies, and reaching its posting gates. Follow it
     exactly. Do **not** judge comments inline, and do **not** post or commit
     anything unless the human approves at each gate.
   - **If no domain skill resolved:** fetch the MR's unresolved review threads yourself,
     evaluate each on its merits, and draft replies. Hold at a posting gate.
3. **Emit `drafting`** when the verdict table + per-thread draft replies are on
   screen: `bun run <status-bin> <state> drafting`
4. **Emit `implementing`** only if the human approves writing fixes:
   `bun run <status-bin> <state> implementing`. When implementation finishes and
   you're back to finalized replies, emit `drafting` again before offering to post.
5. **Mark done, with the counts.** After the run wraps, report what actually
   happened to the replies:
   `bun run <status-bin> <state> done "<one-line summary>" --posted <n> --threads <n>`
   - `--threads` is the number of unresolved human threads the run set out to
     answer, i.e. the rows in the verdict table.
   - `--posted` is how many of those actually received a posted reply, counted
     after the multi-select posting gate resolved. It is `0` when the human
     declined to post anything.
   - Zero unresolved threads is `--posted 0 --threads 0`.

   The board derives the badge from this pair, so a wrong count is a wrong
   badge: `3/3` reads "replies posted", `2/3` reads "2 of 3 posted", `0/3` reads
   "replies drafted, not posted". Keep the message short, e.g.
   `"3 threads: 2 fixed, 1 pushback"` or
   `"no valid threads... replied with technical pushback"`.
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
  post... present it; do not post every reply wholesale, and do not skip the ask
  and idle. `done` follows the human's pick, not your own call, and `--posted`
  counts what actually went up, never what you drafted.
- After marking done, stay in the pane so the human can act on leftover drafts.
- If there are zero unresolved human threads, mark
  `done "no unresolved threads" --posted 0 --threads 0`. That is not an error
  condition.
