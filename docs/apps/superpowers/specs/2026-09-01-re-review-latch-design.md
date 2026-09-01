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
deliberate tradeoff. A request refused for cooldown costs the author a second
resolve click once the cooldown lifts, rather than the board remembering the
pending request. Per-latch state was considered and rejected: it introduces a
store to prune and a second source of truth that can drift from GitLab's actual
resolved bit.

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

`notifyBoard` is deliberately best-effort ("a board that is down or restarting
must never fail the agent's status write"), so a review that finishes while the
board is down would never get a latch. The triage pass below reconciles this:
it already walks every review state with a `comment` outcome, so a missing
latch is posted on the next tick. The feature is self-healing.

### Detecting the resolve

A new `runLatchPass` in `src/triage/`, beside `runNudgePass`, sharing the cron
lock, daily budget, audit log and desktop notify.

Its scope is `readReviewStates()`, not the board snapshot: only MRs this board
reviewed to a `comment` outcome are checked. That is a handful of MRs per tick,
and it avoids `fetchOwnMrs` (`bin/triage.ts:87`), which is scoped to the board
identity's own MRs, the opposite side of this feature. Discussions come from
the same `readDiscussions` daemon read the server uses in
`enrichReviewerComments` (`src/server.ts:254`).

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
identified by scanning a discussion's first note for this marker.

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

`invadrs` emits SVG. The banner is rasterized to PNG before upload, because
GitLab instances vary in whether they render uploaded SVG.

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
  author from the reviewer resolving it. The board never resolves the latch
  itself (it only unresolves), so any resolved transition was a human other
  than the board, and the cooldown plus daily budget absorb a misfire. Closing
  it properly is a third glance addition.
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

The exclusion in `src/discussions.ts` needs a case proving an armed latch does
not inflate `reviewerComments` or `threadSummary`.

## Risks

- **Team-visible surface.** The latch appears on every commented review, under
  the reviewer's name, and makes the agent review workflow legible to everyone
  on the MR. That is intentional but irreversible in the sense that teammates
  will see it before anyone asks them.
- **Two-repo change.** Board cannot ship until the glance additions land.
- **Upload cost.** One upload per commented review. Small, but it is an API
  write on every review rather than once per project.
