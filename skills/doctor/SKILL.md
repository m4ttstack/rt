---
name: mr-board:doctor
description: >-
  Use when the mr-board launches a pane to auto-repair mechanical breakage
  (merge conflicts and/or red CI) on ONE MR, yours or a teammate's, invoked as
  "/mr-board:doctor <mrUrl> --state <path> --status-bin <path> [--skill <name>]"
  with optional --tier, --fix-classes and --draft-bin flags. Not for manual use.
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
| `--fix-classes <a,b>` | Comma-separated allowlist of fix classes the dispatching policy enabled (e.g. `retry-flake,inherited-note-draft`). Actions outside the list are escalations, not fixes. See "Fix classes" below for what each one licenses. |
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
   - **If no domain skill resolved:** do a generic best-effort: `glab mr view <mrUrl>` to
     read conflict/pipeline state, attempt a mechanical rebase, and retry
     obviously-flaky pipelines. Do **not** guess at semantic conflict
     resolutions or behavior-changing test fixes; escalate those.
3. **Escalate, don't speculate.** Emit `error` (with a specific, actionable
   message) whenever a fix requires product judgment or non-obvious semantic
   resolution — a conflict where both sides changed the same logic, a CI failure
   whose fix would change sanctioned behavior, or repeated fixes not converging.

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

### Fix classes

`--fix-classes` is an allowlist, not a suggestion: a fix class not in the
list is out of scope, full stop, and the corresponding breakage is an
escalation instead.

- `retry-flake`, `inherited-note-draft`, `clean-api-rebase`: unchanged,
  API-tier fixes described above.
- **`mechanical-lint`** (checkout-tier only, MAT-351): **behavior-neutral
  mechanical code fixes ONLY**... appending a required lint-disable reason
  suffix, formatting-only changes (whitespace, quote style, trailing
  commas), import ordering. Nothing that could alter runtime behavior
  qualifies; if a fix touches logic, changes a condition, adds/removes a
  code path, or you are not certain it's a no-op, it is **not**
  mechanical-lint... escalate it instead of guessing.
- **`code-fix`** (checkout-tier only, MAT-351): **full repair authority on
  the board identity's OWN MRs**... real code fixes for red CI, semantic
  conflict resolution, committed and pushed to the MR branch. The dispatcher
  only ever includes this class when the MR author IS the board's own
  identity. Judgment line: `code-fix` licenses fixes a competent author
  would consider the obviously-intended change (a missing import, a type
  error with one evident correction, a broken test whose fixture drifted
  from sanctioned behavior). It does NOT license design decisions: when the
  fix would CHANGE sanctioned behavior, pick between plausible intents, or
  the loop is not converging, escalate with the options laid out.
- When both `mechanical-lint` and `code-fix` are present, the fix takes the
  narrowest class that covers it, and the commit message names that class.

#### Safeguards for the branch-writing classes

`mechanical-lint` and `code-fix` both commit and push to the MR branch. All
four safeguards below apply to both classes identically, and none of them is
optional.

1. **Never under `--tier api`.** These classes only ever apply without
   `--tier api`: the API tier's "never commit, never push" contract always
   wins, even if a branch-writing class is present in `--fix-classes` (treat
   that combination as a dispatcher bug, escalate, do not commit).
2. **Re-verify the author gate before applying, every time.** The dispatcher
   only ever includes these classes for the board's own identity, but do not
   trust the flag alone: confirm independently (e.g. `glab mr view <mrUrl>`
   for the author, compared against the authenticated GitLab identity for
   this checkout) that the MR author is genuinely the board's own identity
   before touching the branch. If that check is inconclusive or they don't
   match, escalate; never apply a branch-writing fix on that ambiguity.
3. **Commit message must self-identify.** Whatever the repo's own commit
   message convention is, the message must make clear this is a doctor fix of
   that class (e.g. a `doctor: mechanical-lint ...` or `doctor: code-fix ...`
   prefix or equivalent) so it reads unambiguously as an autonomous fix in
   `git log`, not a human commit.
4. **Push using the repo's existing MR-branch push conventions** (same
   `--force-with-lease`-only discipline as any other doctor push here). **If
   the push is blocked** in this runtime environment (no push access,
   protected branch, network/auth failure): commit locally, do not retry
   around the block, and escalate `error` with the exact state: the local
   commit sha, the branch, and the specific block reason, so the human can
   push it themselves or grant access.

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
