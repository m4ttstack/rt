/**
 * classifyGitHubEvent / normalizeBranchRef: pure classification of the
 * GitHub repo-events feed (`GET /repos/{owner}/{repo}/events`) into
 * invalidation keys. Task 3 adds the polling class around these in the
 * same file, mirroring EventsPoller.ts's GitLab counterpart.
 *
 * Contract, from the phase 5 derisk (lettered claims are that document's
 * numbering; see `.local-dev/derisk/phase5-derisk-findings.md` -- local-only
 * and deliberately untracked, so a fresh clone will not have it. The facts
 * below carry their own load and do not depend on the citation resolving):
 *  - The server asks for a 60s poll cadence via `X-Poll-Interval: 60`,
 *    present on `200`s only -- absent on every authenticated `304` (A11,
 *    A12), which is the response a steady-state poller sees most of the
 *    time. Not this file's concern (Task 3's), but the reason a per-repo
 *    poller built on this classifier should not run hotter than 60s.
 *  - `payload.pull_request` is a five-key stub -- `base, head, id, number,
 *    url` -- with no `user`, no `title`, no `state`, and critically no
 *    `merged` (A22). A classifier cannot author-filter or read merge state
 *    from the envelope; a refetch is mandatory, same as GitLab.
 *  - Merge is NOT `action: "closed"` plus `pull_request.merged`: GitHub
 *    emits an undocumented literal `action: "merged"` on 10 of 78 observed
 *    `PullRequestEvent`s (A24). It flows through `cause` like any other
 *    action here, unclassified specially -- a classifier written from the
 *    docs alone would silently misfile every merge as an unknown action.
 *  - `ref` does not mean the same thing on every event type (A28):
 *    `PushEvent.ref` is a full `refs/heads/<branch>` (or `refs/tags/<tag>`);
 *    `Create`/`DeleteEvent.ref` is already the bare name, with `ref_type`
 *    carrying branch-vs-tag alongside it. `normalizeBranchRef` is the one
 *    place that reconciles the two spellings; skipping it breaks a
 *    consumer's `isOurs`-style branch match silently.
 *  - GitHub's polled feed has no CI event type at all (A30): zero CI-typed
 *    events were observed despite three completed workflow runs in the
 *    probe window. This classifier never emits `kind: 'pipelines'` --
 *    there is no source event to key it off. Consumers that no-op the
 *    `pipelines` kind see no behavioral difference from a classifier that
 *    omits it outright.
 *  - Folding `PullRequestReviewEvent` into `mr` (A32) is an inference, not
 *    a sourced 1:1 mapping: the invalidation-kind vocabulary has no
 *    review-specific arm, and a review state change (approval, changes
 *    requested) has to land somewhere -- `mr` is the kind that triggers a
 *    refetch of review state. This has not been driven end-to-end here;
 *    the settling evidence is the consumer-flow checks (U16-U24 in
 *    `.local-dev/derisk/consumer-matrix.md`) running for real against
 *    GitHub once `watchEvents` ships and their skips lift.
 *
 * Known blind spots of the feed itself:
 *  - No CI/pipeline events (A30, above) -- `pipelines` is never emitted.
 *  - A retained window of roughly six hours (A2: measured 6.00h and 6.49h
 *    to fill 300 events), a quarter of a typical 24h deep-reconcile
 *    interval. A watcher that has been down longer than the window has
 *    retained is not resumable from its cursor -- the gap in history is
 *    already gone from the feed by the time it reconnects. Only a full
 *    sync recovers it; the deep reconcile cannot assume the feed retained
 *    anything it missed.
 *  - Metadata-only edits (title/description/labels/assignees) are absent
 *    from the feed, the same blind spot GitLab's events feed has.
 *    Consumers keep a slow full-refresh as the safety net for this.
 *
 * No I/O here: pure functions over an already-fetched event.
 */
import type { InvalidationKey } from './types.ts';

/** The subset of a GitHub repo-events entry we consume. Ids are strings (A6). */
export interface GitHubEvent {
  id: string;
  type: string;
  actor?: { login?: string };
  created_at: string;
  payload?: {
    action?: string; // PullRequestEvent, IssueCommentEvent, PullRequestReviewEvent
    ref?: string; // PushEvent: "refs/heads/x"; Create/DeleteEvent: "x" (A28)
    ref_type?: string; // Create/DeleteEvent: "branch" | "tag"
    pull_request?: { number?: number }; // five-key stub (A22); number is present
    issue?: { number?: number; pull_request?: unknown };
    review?: unknown;
  };
}

/** "refs/heads/x" -> "x"; bare refs pass through; tags return null. */
export function normalizeBranchRef(
  ref: string | undefined,
  refType: string | undefined
): string | null {
  if (!ref) return null;
  if (ref.startsWith('refs/heads/')) return ref.slice('refs/heads/'.length);
  if (ref.startsWith('refs/tags/')) return null;
  if (refType === 'tag') return null;
  return ref;
}

export function classifyGitHubEvent(e: GitHubEvent): InvalidationKey[] {
  const payload = e.payload;

  // PullRequestEvent: opened/closed/reopened/assigned/review_requested/
  // labeled/etc., plus the undocumented "merged" (A24). Every action flows
  // through `cause` unchanged -- no special-casing.
  if (e.type === 'PullRequestEvent') {
    const number = payload?.pull_request?.number;
    if (number == null) return [];
    return [{ kind: 'mr', ref: String(number), cause: payload?.action ?? e.type }];
  }

  // PullRequestReviewEvent -> mr, the A32 inference (see header comment).
  if (e.type === 'PullRequestReviewEvent') {
    const number = payload?.pull_request?.number;
    if (number == null) return [];
    return [{ kind: 'mr', ref: String(number), cause: payload?.action ?? e.type }];
  }

  // Comments on a PR (mirrors GitLab's note classification: a comment can
  // shift approval state, so it invalidates both the thread cache and the
  // MR itself). An IssueCommentEvent on a plain issue -- no
  // `issue.pull_request` -- classifies to nothing.
  if (e.type === 'PullRequestReviewCommentEvent' || e.type === 'IssueCommentEvent') {
    const issue = payload?.issue;
    if (issue?.pull_request == null) return [];
    const number = issue.number;
    if (number == null) return [];
    const ref = String(number);
    const cause = payload?.action ?? e.type;
    return [
      { kind: 'notes', ref, cause },
      { kind: 'mr', ref, cause },
    ];
  }

  // PushEvent: normalize the full ref spelling and never emit `pipelines`
  // (A30 -- GitHub's polled feed has no CI event type to key it off).
  if (e.type === 'PushEvent') {
    const branch = normalizeBranchRef(payload?.ref, payload?.ref_type);
    if (branch == null) return [];
    return [{ kind: 'branch', ref: branch, cause: 'pushed' }];
  }

  // Create/DeleteEvent: bare ref spelling already (A28), gated on ref_type
  // so tag creation/deletion never touches the branch cache.
  if (e.type === 'CreateEvent' || e.type === 'DeleteEvent') {
    if (payload?.ref_type !== 'branch' || !payload.ref) return [];
    return [
      { kind: 'branch', ref: payload.ref, cause: e.type === 'CreateEvent' ? 'created' : 'deleted' },
    ];
  }

  return [];
}
