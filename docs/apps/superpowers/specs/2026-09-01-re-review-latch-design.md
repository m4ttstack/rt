# Re-review latch

Give an MR author a way to ask for a re-review from inside the MR, so a
re-review no longer depends on another board user poking the reviewer through
the switchboard.

## Problem

Today a re-review is requested by a peer board: a row action on the author's
own board publishes a nudge through the switchboard, and the reviewer's triage
pass picks it up (`docs/peer-boards.md`). That works only when the author runs
a board and both boards are peered. An author who has just addressed every
comment and wants another pass has no way to say so from the MR itself.

## Solution

The reviewer's review posts one dedicated resolvable thread, the **latch**. The
author resolves that thread when they are ready; the reviewer's board sees the
resolved bit and dispatches a re-review through the existing engine.

The resolved bit is the entire protocol. There is no consumed-marker, no queue
and no per-latch state file, because the board unresolves the thread as part of
disposing of the request. The unresolve both rearms the latch and records that
the request was consumed.

### Lifecycle

| # | State | What happened | Thread |
|---|---|---|---|
| 1 | armed | Review finished with a `comment` outcome; latch posted | unresolved |
| 2 | requested | Author resolved the latch | resolved |
| 3 | dispatched | Re-review launched; board replied in-thread | unresolved (rearmed) |
| 3b | held off | Guardrail refused; board replied with the reason | unresolved (rearmed) |
| 4 | spent | Re-review finished with an `approve` outcome | resolved, body rewritten |

State 4 is what keeps the latch from becoming a merge blocker. GitLab exposes
`discussions_not_resolved` as a `detailedMergeStatus` value (glance
`types.d.ts:146`), so on a project that requires all discussions resolved, a
latch left unresolved holds the MR hostage and the rearm in state 3 would
re-block it every cycle. A spent latch sits resolved forever and never rearms.

### Every disposal replies and unresolves

Dispatch and refusal are treated identically: reply in-thread with what
happened, then unresolve. This is what makes the design stateless, and it is a
deliberate tradeoff.

The rule is every disposal that leaves the latch **live**. The spend is the one
terminal disposal and behaves the other way round: it resolves and rewrites the
body instead of unresolving, and posts no reply, since the approving review has
already commented and the rewritten banner says the latch is spent.

The spend is two GitLab calls and is ordered `updateNote` **then**
`resolveDiscussion`. A crash between them leaves a spent-but-unresolved
latch, which step 1 repairs by re-resolving on the next tick, whichever driver
performed the spend. Every rewrite-first residue is repaired silently. The
reverse order leaves a resolved-but-unspent latch, which is indistinguishable
from a human request: usually harmless, since branch 3 re-spends it on a
still-approved MR, but if approval was revoked in the meantime it becomes a
real dispatch and a "re-review started" reply to an author who was just
approved. A request refused for cooldown costs the author a second
resolve click once the cooldown lifts, rather than the board remembering the
pending request. Per-latch state was considered and rejected: it introduces a
store to prune and a second source of truth that can drift from GitLab's actual
resolved bit.

### An already-approved MR

A human can approve the MR by hand after a comment review. The board's review
state stays `done` with a `comment` outcome, so the latch stays armed, and on a
project requiring all discussions resolved the author has to resolve it to
merge, which would otherwise dispatch a re-review nobody asked for.

The pass therefore checks `reviews.isApproved` (glance `types.d.ts:264`, on the
MR it already fetched): an approved MR **spends** the latch rather than
dispatching. That is state 4's transition reached from the other direction.

Unlike the server-driven spend, this one does not take the MR out of scope. The
review state stays `done` with a `comment` outcome, so the pass keeps fetching
that MR every tick until the state is pruned, and on every one of those ticks
it reads a latch the board itself resolved. **The spend must therefore be
idempotent**, which the unconditional spent check above delivers: step 1 leaves
an already-spent latch alone. Without it, every tick re-runs `updateNote` and
`resolveDiscussion` against GitLab.

## Where the code lives

### Posting the latch

`bin/review-status.ts` is the domain-agnostic choke point. Every review, run by
any domain skill, ends by calling
`<status-bin> review-status <state> done ... --outcome <comment|approve>`, and
that binary already calls `notifyBoard({mrUrl, iid, kind: "review", status,
outcome})`.

The board server handles that at `POST /agent/status` and already holds both
the GitLab token and `NoteMutator` (the inherited-note draft path at
`src/server.ts:949` is the precedent). So the server posts the latch on a
`comment` outcome and spends it on an `approve` outcome. The latch is therefore
board's own behavior rather than a domain skill's, and works with any review
skill.

Two drivers post latches, the server on a `comment` outcome and the pass's step
0 below, both from a read-then-post sequence with no shared lock, so a notify
landing mid-tick can produce two latch discussions. Worse, spent latches are
never deleted, while review state is per-MR and reused across review cycles
(`reviewFilePath` slugs the URL), so an MR reviewed twice carries a spent relic
from cycle 1 beside cycle 2's live latch.

One rule handles both:

- The **newest** latch discussion is the canonical latch, newest by its root
  note's `createdAt`. glance's `Discussion` carries no timestamp of its own
  (`types.d.ts:620`), but the marker scan already reads that root note and
  `Note` has `createdAt`; ties break on discussion id. GitLab's `created_at` is
  stable under the spend's `updateNote`, so a spend never reorders the list.
  Oldest-wins would
  read a spent relic as canonical and destroy each later cycle's latch on
  sight, silently disabling the feature on that MR from its first spend
  onward.
- The request predicate is **any** latch discussion resolved without the spent
  marker, honored against the canonical one. An author who resolves the
  duplicate rather than the canonical latch is still asking, and the
  per-discussion invariant already says so; reading only the canonical one
  would eat the request with no reply.
- **Disposing of a request consumes it everywhere.** Dispatch and refusal both
  spend every resolved-unspent extra in the same disposal, alongside whatever
  they do to the canonical latch. Otherwise the request bit survives in the
  extra and re-fires on every re-entry into scope: one unrequested dispatch per
  completed re-review cycle, or one per cooldown expiry on the refusal path,
  which would also quietly contradict the "second resolve click" tradeoff. It
  is what keeps "a latch cannot go stale" true, and so what keeps the
  `NUDGE_FRESH_MS` skip justified.
- Disposing of an extra is otherwise idempotent, on the canonical latch's own
  terms: already spent and resolved, leave it; spent but unresolved, re-resolve
  only; live, spend it. For an extra, `spent` means defunct rather than approved.
  GitLab collapses resolved threads so the stretch is invisible, and the
  alternative is a live duplicate that double-prompts the author and blocks
  merge on a strict project.
- "A latch already exists", for the purpose of not posting another, means a
  **live** latch. A spent one never suppresses a fresh post.

`notifyBoard` is deliberately best-effort ("a board that is down or restarting
must never fail the agent's status write"), so a review that finishes while the
board is down would never get a latch, and an `approve` that lands while it is
down would never spend one. The triage pass below reconciles both, because it
walks every `done` review state of either outcome: a missing latch is posted on
the next tick (with one descoped exception, named in step 0 below), and an
unspent or half-spent one is completed. The feature is
self-healing in both directions.

### Detecting the resolve

A new `runLatchPass` in `src/triage/`, beside `runNudgePass`, sharing the cron
lock, daily budget, audit log and desktop notify.

Its scope is `readReviewStates()`, not the board snapshot: every `done` review
state this board holds, of **either** outcome, and only those. A `done` state
with no outcome at all is out of scope: `outcome` is optional on `ReviewState`
(`src/review-state.ts:17`) and `bin/review-status.ts` never requires the flag,
so such states exist on disk, and the pass ignores them exactly as
`decideNudge` already does, where a missing outcome is `no-commented-review`.
Posting a latch for a review that recorded no verdict would be a team-visible
wrong action. Comment-outcome MRs get the full
branch list below; approve-outcome MRs are restricted to repair and
spend-completion and never reach `decideNudge`. Scoping to comment outcomes
alone would leave the server-driven spend unrepairable, since the `approve`
outcome that triggers it is the same fact that would remove the MR from view.
That is a handful of MRs per tick,
and it avoids `fetchOwnMrs` (`bin/triage.ts:82`), which is scoped to the board
identity's own MRs, the opposite side of this feature. Discussions come from
the same `readDiscussions` daemon read the server uses in
`enrichReviewerComments` (`src/server.ts:254`).

Widening the scope costs one `readDiscussions` daemon read per approve-outcome
state per tick, bounded by pruning: `pruneReviewStates`
(`src/review-state.ts:112`), swept from the server at `src/server.ts:538`,
keeps a review state only as long as its MR is on the board. Approve-outcome
states therefore live from the approve until the MR merges or closes, so the
tail is un-merged approved MRs, the same cost class the comment side already
pays.

The pass builds its MR facts the way `fetchOwnMrs` does, `readProjectMRs` per
configured project then `buildBoard`, but filters on *having a `done` review
state* instead of on authorship. That one fetch supplies
everything the pass needs: `repositoryId`, from which the numeric `projectId`
comes via `parseRepoId(mr.repositoryId)` (the same derivation the draft-note
path uses at `src/server.ts:948`), the `iid`, and `reviews.isApproved` for the
already-approved case above. The `projectPath` that `resolveDiscussion` and
`unresolveDiscussion` want comes from `config.projects`.

Order matters. For each MR in scope the pass reads the latch discussion and
branches in exactly this order:

0. **No live latch.** On a comment-outcome state with no latch discussion at
   all, post one and stop; this is the reconciliation the self-healing
   paragraph above describes. On an approve-outcome state, post nothing: there
   is nothing left to arm. **Descoped:** where a spent relic is present but no
   live latch, the pass does not post either, because it cannot tell a cycle-2
   relaunch from a settled cycle 1 without ordering information. The same rule
   governs the other route into that state, a manual-approve spend followed by
   approval revocation, which also leaves a spent relic and no live latch with
   no relaunch in sight. Arming a second cycle is the server's job, and if that notify was missed the
   peer-board nudge is the existing fallback. Stamping a timestamp into the
   spent marker would let the pass compare it against the review state and
   self-heal this too; that is a later change, not v1.
1. **Spent marker present.** Do nothing. Unconditional, and first. If the
   thread is also unresolved (a crash between the spend's two calls),
   re-resolve it and stop. Never rearm a spent latch.
2. **Not resolved.** On a comment-outcome state, do nothing; the latch is armed
   and waiting. On an approve-outcome state, spend it: either the server's
   spend never ran, or it never completed.
3. **Resolved, no spent marker.** A human resolved it. Spend it if the MR is
   approved or the review state's outcome is `approve`; otherwise run it
   through `decideNudge`.

Putting the spent check ahead of everything is what holds the invariant under
approval revocation. A project set to remove approvals when commits are added
flips `isApproved` back to false after a spend, and the review state still
reads `done`/`comment`, so the MR stays in scope. Without the unconditional
check, the next tick would read a board-resolved latch as a human request,
dispatch, and unresolve a spent latch, re-blocking the merge on a strict
project.

### One decision function, two sources

`decideNudge` (`src/triage/nudge.ts:20`) stays the only place a re-review
request is judged. It takes a source-tagged request instead of a `NudgeState`.

One rule changes: the 48h freshness check (`NUDGE_FRESH_MS`) is skipped for
latch-sourced requests. A latch cannot go stale, because the board consumes it
on the very next tick after it is resolved, so there is no queue to age. Every
other guardrail applies unchanged: no review in flight, prior review done with
a `comment` outcome, per-MR cooldown, daily attempt budget.

The prior-review guardrail is trivially satisfied for a latch (the latch only
exists because a comment review posted it), and is kept as a safety net for a
lost or corrupted state file.

## The comment

Two independent markers, and detection must never depend on the visual one.

**Machine marker.** An HTML comment, `<!-- mattstack:board re-review-latch v1 -->`,
as the first line of the latch's root note. Invisible when rendered,
exact-match detectable, version-stamped for a future format change. A latch is
identified by scanning a discussion's first note for one of the two v1 markers,
this one and the spent form below.

The spend rewrites it to `<!-- mattstack:board re-review-latch v1 spent -->`.
That is both how a spent latch is recognized on a later tick and what makes the
spend idempotent.

**Human marker.** A banner image, purely decorative. A blocked, broken or
missing image can never break the latch.

Body:

```markdown
<!-- mattstack:board re-review-latch v1 -->

![re-review latch](/uploads/<hash>/latch-<mr>.png)

**Addressed everything?** Resolve this thread and I'll take another pass over the MR.

Leave it open while there's still work in flight.
```

First person is correct: the latch posts under the reviewer's own token, so it
reads as the reviewer talking to the author.

### The banner

An arcade band on the board's deep purple (`#161224`), pixel wordmark, with the
creature seeded from the MR URL via `invadrs`' `spawn()`, which is already a
board dependency and whose hash is frozen by its stability contract. Every MR
gets its own creature, deterministically.

`invadrs` emits SVG, and GitLab instances vary in whether they render an
uploaded SVG, so the banner is uploaded as a PNG. No SVG rasterizer is needed
and none is added. The band artwork (background, wordmark, rule, caption) is
rendered once at build time and committed as a template PNG; at post time the
pass paints the sprite into a copy of that buffer. `resolveSpawn()` returns the
sprite's raw boolean grid, so the pass paints from that directly and never
parses SVG: a nested loop over pixels rather than glyph rendering. `pngjs` does
the decode and encode: it is already
in the repo as a devDependency for the capture tests and moves to a runtime
dependency.

Because the sprite is per-MR, the upload is per-MR: exactly one
`POST /projects/:id/uploads` per latch, at post time. Nothing caches the
returned path, because the path lives in the latch's own note body from then
on: a rearm does not touch the body at all, and the spend step in state 4
reuses the path already there. This is the one change the design pass made to
the shape approved earlier, which assumed a fixed sprite uploaded once per
project.

Visual reference: the design canvas at
`https://claude.ai/code/artifact/9abc5d8d-159b-425c-87c2-9387ac17b4e4` carries
all five lifecycle states, a dark-theme check, and the two passed-over banner
directions.

## Upstream: glance additions

| Addition | Why |
|---|---|
| `NoteMutator.createDiscussion(projectId, mrIid, body)` | `NoteMutator` does `POST /notes` (a **non-resolvable** general comment) and replies into existing threads. The latch must be a real resolvable thread, which is `POST /discussions`. |
| Project uploads (`POST /projects/:id/uploads`) | Not exposed anywhere in glance; the banner needs it. |

`resolveDiscussion` / `unresolveDiscussion` already exist
(`GitLabProvider.d.ts:177`), but take `projectPath` while `NoteMutator` takes a
numeric `projectId`, so the pass carries both.

`src/discussions.ts` must exclude the latch from `reviewerComments` and
`threadSummary`. Otherwise the board's own "N comments" signal counts the
board's own thread, and an armed latch would make an MR with no outstanding
feedback read as commented.

## Out of scope

- **GitHub parity.** glance's GitHub provider synthesizes
  `gh-review-thread-<rootCommentId>` ids and its resolve semantics differ.
  GitLab first.
- **Verifying who resolved the latch.** glance's `Note` type
  (`types.d.ts:608`) has no `resolved_by`, so the board cannot distinguish the
  author from the reviewer resolving it. The spent marker carries the invariant
  instead: **every board resolve either writes `v1 spent` in the same disposal
  or fires only when the marker is already present** (the branch-3 spend, the
  step-2 completion, the step-1 repair, and the disposal of a duplicate), and
  the spent check is unconditional
  and runs first, so **a
  resolved latch without the spent marker was resolved by a human**.
  `reviews.isApproved` chooses spend-versus-dispatch for live latches only and
  plays no part in the invariant, which is what makes this survive approval
  revocation. The cooldown plus daily budget absorb a misfire. Closing it
  properly is a third glance addition.
- **Focus hints.** Free-text in the latch reply steering the re-review ("just
  the migration path") is a natural extension of the thread, not v1.

## Testing

`decideNudge` is pure, so latch-sourced decisions unit-test exactly as nudge
decisions do today (`src/__tests__/triage-nudge.test.ts` is the pattern).

The lifecycle transitions test against a fake discussions reader and a fake
mutator, with no network: armed to requested to dispatched to rearmed, the
refusal branch, and the approve-spends-it terminal. Marker detection gets its
own cases: a latch among unrelated threads, a latch whose image failed to
upload (marker present, no image), and a `v2` marker a `v1` board must ignore
rather than misread.

The already-approved path needs its own: a resolved latch on an approved MR
spends instead of dispatching, and a second tick over an already-spent latch
writes nothing. Two more pin the ordering: a spent latch on an MR whose
approval was revoked is still left alone (never dispatched, never rearmed), and
a spent-but-unresolved latch is re-resolved rather than treated as a request.
Two more cover the widened scope: on an approve-outcome review state, a
spent-but-unresolved latch is re-resolved, and a still-live latch is spent
rather than dispatched.

The dedupe rule needs three: a resolved *extra* still triggers the request on
the canonical latch and is itself spent by that disposal, so a second completed
cycle draws no second dispatch; an already-spent extra draws no writes on a second tick,
and the cycle-2 case (a spent relic beside a fresh live latch) picks the fresh
one and leaves the relic untouched.

The exclusion in `src/discussions.ts` needs a case proving an armed latch does
not inflate `reviewerComments` or `threadSummary`, and a second for the spent
latch. A spent latch is a resolved thread, so `threadStatusCounts` would
otherwise count it in `threadSummary.resolved`, which `commentsAllResolved`
reads as a signal (`src/view.ts:43`).

## Risks

- **Team-visible surface.** The latch appears on every commented review, under
  the reviewer's name, and makes the agent review workflow legible to everyone
  on the MR. That is intentional but irreversible in the sense that teammates
  will see it before anyone asks them.
- **Two-repo change.** Board cannot ship until the glance additions land.
- **Upload cost.** One upload per commented review. Small, but it is an API
  write on every review rather than once per project.
