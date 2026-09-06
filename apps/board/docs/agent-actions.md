# Agent actions

Right-clicking an MR row opens an action menu. Alongside the plain browser
actions (open in GitLab, copy for Slack, mark or unmark a Slack reaction), a
locally-viewed board can hand the MR to a Claude Code agent running in a
[herdr](https://herdr.dev) pane.

Three launches share one shape:

| action | what it does | herdr workspace |
|---|---|---|
| **launch review** (and **re-review**) | reviews someone else's MR | `reviewsWorkspace` |
| **respond to review** | processes review feedback on your own MR | `respondsWorkspace` |
| **call the doctor** | repairs mechanical breakage: merge conflicts, red CI | `doctorsWorkspace` |

Each spawns a fresh herdr tab labelled `!<iid>`, starts `claude` in the
matching cwd (`reviewCwd`, `respondCwd`, `doctorCwd`, each falling back to
`reviewCwd`), and runs the wrapper skill:

```
/board:review <url> --state <path> --status-bin <path> [--skill <skill>]
```

The board injects the domain skill and its own status-writer path as flags, so
the wrapper skill itself carries no repo- or team-specific knowledge.

The wrapper emits `reviewing` / `done` / `error` to a state file the board
reads, so the row shows a live badge, with an instant optimistic badge and
toast the moment you launch. The board owns every Slack reaction (👀 on
`reviewing`, 💬 or ✅ on `done`), so the agent never touches Slack. Launching
again while a session is live re-focuses its tab instead of spawning another.

State files live in the gitignored `state/` directory (`state/reviews/`,
`state/responds/`, `state/doctors/`, `state/drafts/`). They are pruned when
their MR leaves the board, not on a timer: a session's state persists for as
long as its MR is shown.

## Held drafts

The doctor's API tier has no posting capability at all. When it wants to leave
an MR note it writes a **held draft** instead, and the board surfaces it for
approval. Only your approval click posts it to GitLab. One draft is kept per
MR and kind, so a re-draft overwrites rather than piling up.

## Operator notes

Hold **alt/option** over any pane-launching menu item (launch review,
re-review, respond, doctor, resume) and its hint flips to `+ note`.
Alt-clicking opens a small note box instead of firing. What you type is
appended to the launched prompt as an `Operator note (from the human who
launched this pane): ...` paragraph the wrapper skills honor; resumes send it
as the session's first message. Enter launches with the note, escape goes
back. Notes cap at 2000 characters. Triage never sends one.

## Requirements

- herdr running locally.
- The `board:review`, `board:respond`, and `board:doctor` wrapper skills
  installed. `bun run setup` symlinks them from `skills/` into
  `~/.claude/skills/`.
- Whatever domain skill you point `doctorSkill` at, or a manifest binding.
  Review and respond have no config fallback: their skill comes solely from
  the manifest binding below, and with no binding the wrapper works
  generically.

## Local-only gating

The actions appear only when the board is opened from a local hostname
(`localhost`, `127.0.0.1`, any `*.localhost`, any `*.mattstack`). The gate is
enforced twice: the client hides the menu items, and the server returns `403`
on the launch endpoints. They never fire when the board is viewed through a
public tunnel.

## Skill bindings (`.mattstack/skills.jsonc`)

The wrapper skills are parameterized skills. Each declares slots for the domain
skills that own the actual work, and resolves them with a vendored
`scripts/resolve-args.sh`.

Resolution order in each wrapper:

1. An explicit `--skill` flag, which is what the board injects (`doctorSkill`
   from config for doctor; the manifest binding or nothing for review and
   respond). This always wins.
2. With no `--skill`, the wrapper resolves its slot bindings from the nearest
   `.mattstack/skills.jsonc`, walking up from the working directory, then
   `~/.mattstack/skills.jsonc`.
3. A failed resolution degrades loudly: the resolver prints machine-readable
   JSON errors and the wrapper never guesses a binding, before falling back to
   the generic domain-free behavior.

Slots and contracts:

| wrapper | slot | contract |
|---|---|---|
| `board:review` | `review` | `mr-review@2` |
| `board:respond` | `respond` | `mr-respond@2` |
| `board:doctor` | `doctor` | `mr-doctor@2` (the checkout tier) |
| `board:doctor` | `doctor-api` | `mr-doctor-api@2` (the `--tier api` no-checkout tier) |

A bound skill must declare the matching contract in its `metadata.provides`.

```jsonc
// ~/.mattstack/skills.jsonc
{
  "version": 1,
  "bindings": {
    "board:review":  { "review": "acme:mr-board-review" },
    "board:respond": { "respond": "acme:mr-board-respond" },
    "board:doctor": {
      "doctor": "acme:mr-board-doctor",
      "doctor-api": "acme:mr-board-doctor-api"
    }
  }
}
```

## Reviewer-side automation

`bun run triage` is a one-shot pass meant for a cron entry (rt cron or a plain
crontab line, either works). It does three jobs behind two switches: the
auto-doctor and nudge jobs are off unless `triage.enabled` is `true`; the
latch job is on unless the `board.reReview` setting turns it off.

**Auto-doctor.** It looks for mechanical breakage on the board identity's own
MRs and dispatches a doctor pane at the configured `tier`. Which repairs it is
allowed to attempt is a per-class opt-in:

| fix class | default | what it does |
|---|---|---|
| `retryFlake` | on | retries a pipeline that looks flaky |
| `inheritedNoteDraft` | on | drafts an inherited-note reply, held for approval |
| `cleanApiRebase` | off | server-side rebase, no checkout |
| `mechanicalLint` | off | behavior-neutral mechanical fixes committed and pushed |
| `codeFix` | off | full repair authority |

The two branch-writing classes (`mechanicalLint`, `codeFix`) are additionally
gated to the board identity's own MRs at dispatch time, whatever their toggles
say.

**Nudge handling.** An incoming re-review nudge from a peer board is picked up
and re-dispatched automatically, if every guardrail clears:

- The reviewer's prior review on that MR is `done` with a `comment` outcome.
- No review is already in flight for that MR.
- The nudge is fresh, judged on the relay's `receivedAt` and never the sender's
  clock, and expires after 48 hours.
- A per-MR cooldown (`cooldownMinutes`, default 30) and a daily dispatch budget
  (`dailyAttemptBudget`, default 3) cap how often triage acts.

A nudge that clears the guardrails launches through the same resume-or-fresh
path as the manual re-review button. Every disposal (launched, rejected, or
expired) publishes an outcome back to the asker's board so their chip resolves.
Launches, guardrail rejections, and expiries also raise a desktop notification;
a rejection caused by a failed launch attempt is still audited and published,
just without one. An unresolved nudge self-expires after 48 hours with a
visible retry cue on the asking board.

**Latch handling.** A review that ends with a `comment` outcome posts one
resolvable thread on the MR, the re-review latch. The author resolves it when
they have addressed the feedback, and the next triage pass reads that resolved
bit, runs it through the same guardrails as a peer nudge, launches the
re-review, replies in the thread and unresolves it so the latch is armed again.
This job is governed by `board.reReview` (user or team scope, default
`{ "enabled": true }`), not by `triage.enabled`: a team can switch it off, but
nobody has to opt in. With it off, no latch is armed and none is dispatched;
spending on approval still runs, so an already-armed latch is cleaned up.

The latch is spent, meaning resolved for good and rewritten, once a review
approves the MR, so it can never block a merge on a project that requires all
discussions resolved. Every disposal replies with what happened, so a
cooldown or budget refusal is visible to the author rather than silent.
