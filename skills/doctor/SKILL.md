---
name: mr-board:doctor
description: >-
  Thin, domain-agnostic wrapper the mr-board launches to auto-repair mechanical
  breakage on ONE of your own MRs — merge conflicts and/or CI failures. Aims to
  finish unattended. Emits lifecycle status to a state file the board reads, then
  delegates the actual repair to the skill named by --skill. Invoked as
  "/mr-board:doctor <mrUrl> --state <path> --status-bin <path>
  [--skill <name>]". Not for manual use.
---

# mr-board doctor runner

The board launched this pane because ONE of your MRs has mechanical breakage
(CI red and/or merge conflicts). The human is not watching — finish unattended,
escalating to `error` only when a human decision is genuinely required. This
wrapper carries **no** repo- or CI-specific knowledge; the board injects it:

| flag | meaning |
|------|---------|
| `<mrUrl>` (positional) | the merge request to repair |
| `--state <path>` | lifecycle status file the board polls |
| `--status-bin <path>` | absolute path to the board's status-writer CLI |
| `--skill <name>` | the domain skill that owns the actual repair (optional) |

Write status **only** by running the injected `--status-bin`:

```
bun run <status-bin> <state> <status> [message]
```

## State progression

The board owns `queued`. You emit the rest as you cross each milestone:

| Status | When to emit |
|--------|--------------|
| `diagnosing` | Immediately — before you know if it's conflicts, CI, or both. |
| `rebasing` | While a rebase/conflict resolution is running. |
| `fixing` | While implementing fixes for CI failures (or resolving conflicts). |
| `watching` | Post-push, while polling CI for green. |
| `done` | Terminal: clean + green, or fixes pushed and green. |
| `error` | Terminal: human decision needed, or the loop budget was exhausted. |

## Steps

1. **Mark `diagnosing`.** `bun run <status-bin> <state> diagnosing`
2. **Do the repair.**
   - **If `--skill` was given:** delegate to that skill with the MR url. It owns
     the actual repair playbook — reading MR state, locating/provisioning the
     worktree, rebasing, triaging and fixing CI, and watching for green. Follow
     it exactly, emitting the state milestones above as it crosses them.
   - **If no `--skill`:** do a generic best-effort — `glab mr view <mrUrl>` to
     read conflict/pipeline state, attempt a mechanical rebase, and retry
     obviously-flaky pipelines. Do **not** guess at semantic conflict
     resolutions or behavior-changing test fixes; escalate those.
3. **Escalate, don't speculate.** Emit `error` (with a specific, actionable
   message) whenever a fix requires product judgment or non-obvious semantic
   resolution — a conflict where both sides changed the same logic, a CI failure
   whose fix would change sanctioned behavior, or repeated fixes not converging.

## Rules

- Always write `diagnosing` first and a terminal `done`/`error` when finished,
  so the board badge never gets stuck.
- The state and status-bin paths are absolute and given to you. Only write
  status via `--status-bin`; never touch the state file directly.
- No `--no-verify`, no bypassing pre-commit hooks. Force-push uses
  `--force-with-lease`, never `--force`.
- The human is not watching. Do not ask questions in the pane; commit decisions
  to the state file's message instead.
- After marking done or error, stay in the pane so the human can inspect what
  happened.

## Escalation phrasing

Good `error` messages tell the human exactly what to do next:

- `"rebase conflict in app/routes/foo.ts: both sides modified handleSubmit — pick one"`
- `"CI red after 3 cycles: 2 tests still failing (snapshot + business logic in Bar)"`
- `"no worktree available — the pool is full"`

Bad ones are vague: `"couldn't fix"`, `"needs human"`, `"CI still red"`.
