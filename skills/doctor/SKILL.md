---
name: board:doctor
description: >-
  Use when the mr-board launches a pane to auto-repair mechanical breakage
  (merge conflicts and/or red CI) on ONE MR, yours or a teammate's, invoked as
  "/board:doctor <mrUrl> --state <path> --status-bin <path> [--skill <name>]"
  with optional --tier, --fix-classes and --draft-bin flags. Not for manual use.
allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/resolve-args.sh:*)
metadata:
  slots: "doctor,doctor-api"
  slot-doctor: "required mr-doctor@2 -- owns the checkout-tier repair playbook: locating or provisioning the worktree, rebasing, triaging and fixing CI, watching for green. When a fix would otherwise dead-end in error but the decision is enumerable, it reports the decision back to this wrapper instead of guessing or terminating -- it never opens or waits on the escalation gate itself."
  slot-doctor-api: "required mr-doctor-api@2 -- owns the api-tier repair playbook: no checkout, pipeline retries, server-side rebase, held drafts only. Same escalation-reporting contract as the checkout-tier slot -- it never opens or waits on the escalation gate itself."
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
| `--skill-path <path>` | absolute path to that skill's SKILL.md, when the board already resolved it (optional; see "Resolving the domain skill") |
| `--tier api` | API-only repair tier: no checkout, no worktree, no local commits. Absent = the historical checkout-tier behavior. |
| `--fix-classes <a,b>` | Comma-separated allowlist of fix classes the dispatching policy enabled (e.g. `retry-flake,inherited-note-draft`). Actions outside the list are escalations, not fixes. See "Fix classes" below for what each one licenses. |
| `--draft-bin <path>` | Absolute path to the board's draft-writer CLI. Any outbound MR note MUST be written through it as a held draft: `<draft-bin> doctor-draft <mrUrl> <iid> <kind> <body...>`. Never post a note directly. |
| `--resumed-gate <gateId>` | this invocation is a parked-gate resume, not a fresh run (optional; see "Resumed gate" below) |

Write status **only** by running the injected `--status-bin`:

```
<status-bin> doctor-status <state> <status> [message]
```

## State progression

The board owns `queued`. You emit the rest as you cross each milestone:

| Status | When to emit |
|--------|--------------|
| `diagnosing` | Immediately — before you know if it's conflicts, CI, or both. |
| `rebasing` | While a rebase/conflict resolution is running. |
| `fixing` | While implementing fixes for CI failures (or resolving conflicts) — including while an escalation gate is open and being waited on; see "Escalation gate" below. |
| `watching` | Post-push, while polling CI for green. |
| `done` | Terminal: clean + green, or fixes pushed and green. |
| `error` | Terminal: a non-enumerable failure needs a human to look directly, or an escalation answer was "leave it to me in the pane". |

## Operator note

The launch prompt may end with a paragraph beginning `Operator note (from the
human who launched this pane):`. That is direct instruction from the human,
typed at launch time — not a flag and not part of the MR. Honor it while
diagnosing and fixing (e.g. "the lint job is the real blocker", "don't touch
the flaky e2e suite") and pass it along to the domain skill as context. It
never overrides the tier, the enabled fix classes, or the status contract.

## Resolving the domain skill

The domain skill that owns the actual repair comes from the first source that
answers; the order is fixed. The tier picks the slot: `--tier api` uses the
`doctor-api` slot (mirroring the board's `triage.doctorSkill`), any other
launch uses the `doctor` slot (mirroring `config.doctorSkill`).

1. **Explicit `--skill <name>` wins.** When the board passed it, use it and do
   not run the resolver. This is the historical launch path, unchanged. When
   the board also passed `--skill-path <path>`, read the SKILL.md at that
   absolute path directly and treat it exactly as the domain skill named by
   `--skill` (same idiom as step 2's `resolved.doctor(-api).path` below).
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

**Resumed gate?** If `--resumed-gate <gateId>` was passed to this invocation,
skip straight to "Resumed gate" below — none of the numbered steps run.

**Otherwise, a fresh run:**

1. **Mark `diagnosing`.** `<status-bin> doctor-status <state> diagnosing`
2. **Do the repair.**
   - **If a domain skill resolved** (explicit `--skill`, else the tier's slot
     per "Resolving the domain skill"): delegate to that skill with the MR url. It owns
     the actual repair playbook — reading MR state, locating/provisioning the
     worktree, rebasing, triaging and fixing CI, and watching for green. Follow
     it exactly, emitting the state milestones above as it crosses them. When
     it hits a point that would otherwise dead-end in `error` but the decision
     is enumerable, it reports that decision back to you instead of guessing
     or terminating — see "Escalation gate" below for what to do with it.
   - **If no domain skill resolved:** do a generic best-effort: `glab mr view <mrUrl>` to
     read conflict/pipeline state, attempt a mechanical rebase, and retry
     obviously-flaky pipelines. Do **not** guess at semantic conflict
     resolutions or behavior-changing test fixes; escalate those.
3. **Escalate, don't speculate.** A fix that requires product judgment or
   non-obvious semantic resolution splits into two shapes:
   - **Non-enumerable.** No small set of concrete choices exists — the
     diagnosis itself is unclear, or the fix is genuinely open-ended. Emit
     `error` (with a specific, actionable message) exactly as before. See
     "Escalation phrasing" below.
   - **Enumerable.** The decision reduces to a short list of concrete,
     executable choices — a conflict strategy, an author-gate override, a
     budget extension. Open the `doctor-escalation` gate instead of erroring;
     see "Escalation gate" below.

### Escalation gate (enumerable decisions)

When the repair dead-ends in a decision with a short list of concrete,
executable choices, open a facility gate instead of emitting `error`:

```
<status-bin> gate open <state> --kind doctor-escalation --questions '[{"id":"action","label":"<one-line situation>","multi":false,"options":[<executable options verbatim>, "leave it to me in the pane"]}]'
```

- **Exactly one question, id `action`.** `label` states the situation in one
  line (the same voice as "Escalation phrasing" below). `options` is the
  concrete choices available, each one something you can directly execute if
  it comes back, followed always by the literal string
  `"leave it to me in the pane"` as the last option.
- **Wait for the answer** using the gate protocol below, staying at `fixing`
  while you wait.
- **Act on `answers.action`:**
  - **One of the executable options.** Perform exactly that action, then
    resume the normal flow (`rebasing`/`fixing`/`watching` as appropriate)
    toward `done`. If it dead-ends again, open a fresh escalation (or emit
    `error` if it's no longer enumerable) — never re-open the same gate.
  - **`"leave it to me in the pane"`.** Stop all mechanized action. Say so in
    the pane. Emit `error` naming the situation the gate described (the human
    is taking over from here), then stay in the pane per the Rules below.

**The three shapes this covers**, each turning what used to be a bare `error`
into a gate:

- **Conflict strategy** — both sides of a rebase conflict changed the same
  logic and there's a small set of concrete resolutions (keep one side, take
  the other, or a specific merge of both). Options are those concrete
  resolutions.
- **Author-gate override** — the safeguard below ("Re-verify the author gate
  before applying, every time") came back inconclusive or mismatched for a
  branch-writing fix class. Options are e.g. `"proceed as <fix class> after
  override"`. **The invariant survives this gate:** an answered override does
  **not** license skipping the independent check — re-verify the author gate
  fresh, right before applying, exactly as the safeguard requires. If the
  fresh check still doesn't confirm the board's own identity, do not apply
  the fix; emit `error` with the concrete mismatch (this is no longer a
  question a human override can resolve from the pane, since a human
  overriding "proceed" without a match is exactly the ambiguity the safeguard
  exists to catch).
- **Budget extension** — the fix/watch loop hit its cycle budget without
  converging. Options are e.g. `"extend budget by <n> more cycles"`. If
  granted and the loop still doesn't converge after the extension, that's a
  fresh escalation moment (open a new gate, or fall back to `error` if
  nothing enumerable is left to offer).

### Resumed gate (`--resumed-gate <gateId>`)

A human already answered a parked `doctor-escalation` gate, and the board
replayed that answer into a fresh pane. Do **not** re-diagnose and do **not**
run `gate open` — the gate lives in the rt daemon's registry, and re-opening
would mint a new `gateId`, supersede the parked one, and orphan the answer
already recorded against it.

- **Re-emit `fixing` first, before anything else.** The board's resume
  plumbing always lands this pane's state at `fixing`, which happens to be
  correct for an answered escalation whose action is now about to execute —
  but emit it explicitly anyway (`<status-bin> doctor-status <state> fixing`)
  so a stale write can never linger and the honest status is this pane's own,
  not an inherited default.
- `<status-bin> gate wait <state>` — the verb is registry-status-first, so on
  an already-answered gate it returns the recorded answer at once instead of
  blocking.
- **Act on the answer** exactly as "Escalation gate" above describes: execute
  the chosen action (re-verifying the author gate fresh if that's the
  situation, per the invariant), or stop and hold the pane for
  `"leave it to me in the pane"`. Then continue the normal flow toward `done`
  or `error`.

## Gate protocol

The `doctor-escalation` gate shares the same wait/escape-hatch/degraded-mode
mechanics as every facility gate — self-contained here:

- **Wait for the answer:**
  `<status-bin> gate wait <state>`
  Each invocation waits for a bounded window and always exits on its own,
  printing exactly one line:
  - `{"status": "pending"}` — the window elapsed with no answer yet. Run the
    same command again, and keep re-running it until one of the other
    results arrives. This loop IS the wait; every re-run resumes exactly
    where the last left off, because the gate and any answer are persisted
    daemon state.
  - `{"answers": {...}, "by": "...", "answeredAt": ...}` — keyed by the
    gate's own question id (`action`). Read `answers.action`.
  A nonzero exit with any error other than the closed message or the
  terminal errors below is a transient failure (a daemon restart, say) —
  re-run it like a pending. Re-entering the wait can never lose an answer
  already recorded.
- **Closed or missing gate.** If `gate wait` fails with `gate <id> closed (<reason>)`,
  the decision site itself was abandoned — superseded, abandoned, or pruned
  when the MR left the board. A `not-found` error or `no gate open for <url>`
  mean the same thing from a different angle: the gate this pane was
  tracking no longer exists to wait on. All three are terminal, not
  transient — do not re-run any of them. End cleanly: say so in the pane and
  stop. Do not invent an answer, do not mark `done`, and do not write `error`
  either — when the reason is a fresh pane superseding this one, that fresh
  pane already owns this MR's state file, and a late write here would stomp
  it.
- **In-pane escape hatch.** If a human interrupts the wait and answers you
  conversationally in the pane instead of through the board, record it so
  any parked resume stays in sync:
  `<status-bin> gate answer <state> --answers <json> --by pane`.
  - **Strict membership.** The recorded answer value must be one of the
    `action` question's option strings, verbatim (e.g.
    `"leave it to me in the pane"`) — the daemon rejects anything else. Carry
    the human's phrasing, hedges, or nuance in the note form instead:
    `{"action": {"value": "proceed as code-fix after override", "note": "but hold off on the migration file"}}`.
  - **CAS loss.** `gate answer` prints nothing and exits 0 when the pane's
    answer was recorded and stands. If it instead prints one JSON line,
    someone answered first through another surface — that printed answer is
    the recorded one. Proceed on it, not on the conversational answer given
    in the pane, and tell the human which answer won.
  - **Reading answers back.** Whether from `gate wait` or a CAS-loss line,
    the `action` answer may be the bare option string or the `{value, note}`
    object — read `value` in the object case.
- **Degraded mode.** If `gate open` exits nonzero (the daemon was down at
  open time), do NOT present a form — doctor panes are routinely
  auto-dispatched with no human watching, and a form in such a pane waits
  forever without a terminal status. Degrade to the pre-gate behavior
  instead: `<status-bin> doctor-status <state> error "<the actionable
  escalation message this gate would have asked>"` and stop. The board (and,
  for auto dispatches, the escalation notifier) already surface that error
  to a human, exactly as before escalation gates existed. A failing
  `gate wait` is not itself degradation — per "Wait for the answer" above,
  re-run it; if it keeps failing, and never with the closed message or the
  terminal errors above (those end cleanly per "Closed or missing gate"
  instead), take the same error path and say why in the message.

### API tier (`--tier api`)

When `--tier api` is present, the repair is checkout-free by contract:

- Never claim a worktree, never commit, never push. The only mutations
  allowed are pipeline/job retries, (if `clean-api-rebase` is in
  `--fix-classes`) a server-side rebase, and held drafts via `--draft-bin`.
- The `rebasing`/`fixing` milestones still apply to their API-shaped
  equivalents (server-side rebase, retry); otherwise go straight from
  `diagnosing` to `watching`. The escalation gate applies unchanged at this
  tier too — a retry loop not converging is a budget-extension escalation
  the same as at the checkout tier.
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
   match, escalate; never apply a branch-writing fix on that ambiguity. When
   the ambiguity itself is worth putting to a human (rather than a plain
   `error`), that's the author-gate override case in "Escalation gate"
   above — and even then, this independent re-check runs fresh right before
   applying, every time, regardless of what the gate answer was.
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
  so the board badge never gets stuck — except a closed or missing escalation
  gate (see "Gate protocol" above): end without either, since a fresh pane
  may already own the state file.
- The state and status-bin paths are absolute and given to you. Only write
  status via `--status-bin`; never touch the state file directly.
- No `--no-verify`, no bypassing pre-commit hooks. Force-push uses
  `--force-with-lease`, never `--force`.
- The human is not watching. Do not ask questions in the pane on your own
  initiative — an enumerable decision goes through the escalation gate above,
  and a non-enumerable one is a plain `error` with the decision committed to
  the state file's message.
- Open the escalation gate only when the decision genuinely reduces to a
  short, concrete, executable list of options. When in doubt whether a
  failure is enumerable, it isn't — emit `error` instead of inventing options
  a human wouldn't recognize as their real choices.
- After marking done or error, stay in the pane so the human can inspect what
  happened.

## Escalation phrasing

### Non-enumerable (`error`)

No small set of concrete choices exists — emit `error` with a specific,
actionable message:

- `"no worktree available — the pool is full"`

Bad ones are vague: `"couldn't fix"`, `"needs human"`, `"CI still red"`.

### Enumerable (`doctor-escalation` gate)

A short list of concrete, executable choices exists — open the gate with
that list as `options`, e.g.:

- `"rebase conflict in app/routes/foo.ts: both sides modified handleSubmit"`
  with options `["keep the MR branch's handleSubmit", "keep main's
  handleSubmit", "leave it to me in the pane"]`
- `"CI red after 3 cycles: 2 tests still failing (snapshot + business logic
  in Bar)"` with options `["extend budget by 3 more cycles", "leave it to me
  in the pane"]`
