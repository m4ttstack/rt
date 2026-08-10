---
name: mr-board:doctor
description: >-
  Thin, domain-agnostic wrapper the mr-board launches to auto-repair mechanical
  breakage on ONE MR — merge conflicts and/or CI failures, whether it's yours or
  a teammate's. Aims to finish unattended. Emits lifecycle status to a state file
  the board reads, then
  delegates the actual repair to the skill named by --skill. Invoked as
  "/mr-board:doctor <mrUrl> --state <path> --status-bin <path>
  [--skill <name>]". When no --skill is given, the domain skill is resolved
  from the tier's slot binding (doctor or doctor-api) in
  .mattstack/skills.jsonc. Not for manual use.
allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/resolve-args.sh:*)
metadata:
  slots: "doctor,doctor-api"
  slot-doctor: "required mr-doctor@1 -- owns the checkout-tier repair playbook: locating or provisioning the worktree, rebasing, triaging and fixing CI, watching for green"
  slot-doctor-api: "required mr-doctor-api@1 -- owns the api-tier repair playbook: no checkout, pipeline retries, server-side rebase, held drafts only"
---

# mr-board doctor runner

The board launched this pane because an MR has mechanical breakage (CI red
and/or merge conflicts) — it may be yours or a teammate's. The human is not
watching — finish unattended, escalating to `error` only when a human decision
is genuinely required. This wrapper carries **no** repo- or CI-specific
knowledge; the board injects it:

| flag | meaning |
|------|---------|
| `<mrUrl>` (positional) | the merge request to repair |
| `--state <path>` | lifecycle status file the board polls |
| `--status-bin <path>` | absolute path to the board's status-writer CLI |
| `--skill <name>` | the domain skill that owns the actual repair (optional) |
| `--tier api` | API-only repair tier: no checkout, no worktree, no local commits. Absent = the historical checkout-tier behavior. |
| `--fix-classes <a,b>` | Comma-separated allowlist of fix classes the dispatching policy enabled (e.g. `retry-flake,inherited-note-draft`). Actions outside the list are escalations, not fixes. |
| `--draft-bin <path>` | Absolute path to the board's draft-writer CLI. Any outbound MR note MUST be written through it as a held draft: `bun run <draft-bin> <mrUrl> <iid> <kind> <body...>`. Never post a note directly. |

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

## Resolving the domain skill

The domain skill that owns the actual repair comes from the first source that
answers; the order is fixed. The tier picks the slot: `--tier api` uses the
`doctor-api` slot (mirroring the board's `triage.doctorSkill`), any other
launch uses the `doctor` slot (mirroring `config.doctorSkill`).

1. **Explicit `--skill <name>` wins.** When the board passed it, use it and do
   not run the resolver. This is the historical launch path, unchanged.
2. **Otherwise resolve the tier's slot.** Run the vendored resolver:

   ```bash
   "${CLAUDE_SKILL_DIR}/scripts/resolve-args.sh"
   ```

   On exit 0, read the SKILL.md at `resolved.doctor.path` (or
   `resolved.doctor-api.path` under `--tier api`) and treat that skill exactly
   as if it had been passed via `--skill`.
3. **Otherwise degrade loudly.** On a nonzero exit, print the resolver's JSON
   `errors` verbatim in the pane. Never guess or substitute a binding; the
   script is the only enforcement point. Then proceed with the generic
   best-effort repair described in the steps below. The api-tier contract
   (no checkout, no commits, held drafts only) binds the generic path too.

## Steps

1. **Mark `diagnosing`.** `bun run <status-bin> <state> diagnosing`
2. **Do the repair.**
   - **If a domain skill resolved** (explicit `--skill`, else the tier's slot
     per "Resolving the domain skill"): delegate to that skill with the MR url. It owns
     the actual repair playbook — reading MR state, locating/provisioning the
     worktree, rebasing, triaging and fixing CI, and watching for green. Follow
     it exactly, emitting the state milestones above as it crosses them.
   - **If no domain skill resolved:** do a generic best-effort — `glab mr view <mrUrl>` to
     read conflict/pipeline state, attempt a mechanical rebase, and retry
     obviously-flaky pipelines. Do **not** guess at semantic conflict
     resolutions or behavior-changing test fixes; escalate those.
### API tier (`--tier api`)

When `--tier api` is present, the repair is checkout-free by contract:

- Never claim a worktree, never commit, never push. The only mutations
  allowed are pipeline/job retries, (if `clean-api-rebase` is in
  `--fix-classes`) a server-side rebase, and held drafts via `--draft-bin`.
- The `rebasing`/`fixing` milestones still apply to their API-shaped
  equivalents (server-side rebase, retry); otherwise go straight from
  `diagnosing` to `watching`.
- **Every autonomous action must be reported as a status-bin write whose
  message names the action and fix class** (e.g. `fixing "retried job 812
  (retry-flake)"`, `rebasing "server-side rebase (clean-api-rebase)"`). For
  auto-dispatched doctors the status writer mirrors each of these into the
  audit log (spec §6: one line per autonomous action), so an unreported action
  is an audit-trail violation, not a formality.
- Anything that would need a checkout is an `error` escalation whose message
  carries the diagnosis (failed job, one-line cause, why it isn't yours to
  retry). The human is not watching; the escalation IS the handoff.

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
