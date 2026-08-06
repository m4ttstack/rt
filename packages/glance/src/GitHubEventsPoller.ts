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
 *  - The two PR-comment event types do NOT share a payload shape, despite
 *    both being "a comment on a PR". The recapture counted
 *    `PullRequestReviewCommentEvent` as 11 of the 114 `pull_request`-carrying
 *    events used to measure A22, meaning its real payload carries the
 *    top-level five-key `pull_request` stub -- the SAME shape as
 *    `PullRequestEvent`, not `issue.pull_request`. `IssueCommentEvent` is
 *    the one that actually uses `issue.pull_request` as its PR-vs-plain-issue
 *    gate. Keying `PullRequestReviewCommentEvent` off `issue.pull_request`
 *    (an earlier version of this file did) silently classifies every real
 *    review comment to `[]`, dropping `notes` invalidations for exactly the
 *    comment kind a consumer's notes cache cares about most.
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
import type { EventCursor, InvalidationKey } from './types.ts';

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

  // PullRequestReviewCommentEvent: a comment on a PR diff. Real payload
  // carries the top-level five-key pull_request stub (A22), the SAME
  // source PullRequestEvent uses -- NOT payload.issue (see header comment).
  // Mirrors GitLab's note classification: invalidates both the thread
  // cache and the MR itself, since a comment can shift approval state.
  if (e.type === 'PullRequestReviewCommentEvent') {
    const number = payload?.pull_request?.number;
    if (number == null) return [];
    const ref = String(number);
    const cause = payload?.action ?? e.type;
    return [
      { kind: 'notes', ref, cause },
      { kind: 'mr', ref, cause },
    ];
  }

  // IssueCommentEvent: gated on `issue.pull_request` -- this IS the real
  // shape for a comment left through the Issues API surface, which is how
  // GitHub represents PR-conversation-tab comments. A plain issue -- no
  // `issue.pull_request` -- classifies to nothing.
  if (e.type === 'IssueCommentEvent') {
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

/**
 * GitHubEventsPoller: pure per-tick logic over `GET /repos/{owner}/{repo}/events`.
 *
 * Mirrors EventsPoller.ts's shape (options -> getCursor/tick, invalidation
 * dedup) but the resume strategy differs because the two feeds differ:
 *  - No day-exclusive `after` param and no monotonic numeric id to filter
 *    by -- GitHub's `lastEventId` is reporting-only (see EventCursor's
 *    doc-comment in types.ts). Dedup instead uses a bounded `seenIds` set,
 *    because A6 established that id ordering within a page can disagree
 *    with `created_at` and ids arrive from disjoint ranges -- there is no
 *    single high-water mark that safely separates "seen" from "unseen".
 *  - ETag/If-None-Match (page 1 only) and `X-Poll-Interval` are real
 *    conditional-GET machinery this feed exposes that GitLab's doesn't
 *    (A11, A12, see this file's header comment); a 304 short-circuits the
 *    tick before any page-walking or classification happens.
 *  - Cold start takes a single-page snapshot rather than walking history:
 *    unlike GitLab there's no timestamp/day filter to bound a lookback by,
 *    so the first tick just seeds `seenIds` from whatever page 1 returns
 *    and starts polling incrementally from there (also why it reports zero
 *    invalidations -- consumers are expected to full-refresh on boot).
 *
 * No I/O here: `fetchPage` is injected and cursor persistence is the
 * caller's job, same contract as EventsPoller.ts.
 */

/** One conditional page fetch. 304 = unchanged (events empty, etag echoed). */
export type FetchGitHubEventsPage = (opts: {
  page: number; // 1..3 only; the poller never requests 4+ (A8)
  etag: string | null; // sent as If-None-Match on page 1 only
}) => Promise<{
  status: 200 | 304;
  events: GitHubEvent[]; // [] on 304
  etag: string | null; // from the 200; null on 304 (A12 applies to headers generally)
  pollIntervalSec: number | null; // X-Poll-Interval when present (200s only, A12)
}>;

export interface GitHubTickResult {
  cursor: EventCursor; // seenIds-based; lastEventId = newest seen id (string)
  invalidations: InvalidationKey[]; // deduped kind:ref; [] on cold start
  freshEvents: number;
  requests: number;
  coldStart: boolean;
  notModified: boolean; // page-1 304: nothing changed, zero parse work
  /** server cadence learned from the most recent 200; null until one is seen */
  serverPollIntervalMs: number | null;
}

export interface GitHubEventsPollerOptions {
  fetchPage: FetchGitHubEventsPage;
  cursor?: EventCursor; // resume point; foreign/invalid shapes cold-start (U20 rule)
  maxSeenIds?: number; // default 900 (3x the 300-event window)
  maxPagesPerTick?: number; // default 3, clamped to 3
}

const DEFAULT_MAX_SEEN_IDS = 900;
/** A8: the poller never requests page 4 or beyond, regardless of options. */
const MAX_PAGES_PER_TICK_CEILING = 3;

/**
 * A cursor only counts as a GitHub resume point when it carries GitHub's
 * shape: `seenIds` as `string[]` and `lastEventId` as `string | null`.
 * Anything else -- including rt's persisted GitLab-era numeric cursors, or
 * a cursor missing `seenIds` entirely -- cold-starts rather than throwing
 * (U20: on-disk compat means an unrecognized shape is "absent", not an
 * error).
 */
function isValidGitHubCursor(
  cursor: EventCursor | undefined
): cursor is EventCursor & { seenIds: string[] } {
  if (!cursor) return false;
  if (!Array.isArray(cursor.seenIds)) return false;
  if (!cursor.seenIds.every((id) => typeof id === 'string')) return false;
  if (cursor.lastEventId !== null && typeof cursor.lastEventId !== 'string') return false;
  return true;
}

/**
 * Dedup invalidations by `kind:ref`, first-write-wins. Reimplements
 * EventsPoller.ts's module-private `dedup` (six lines, not exported there
 * either) rather than importing it: it's GitLab-shaped in that file's
 * scope, not worth promoting to a shared export for six lines, and keeping
 * the two poller files independently readable outweighs the duplication.
 */
function dedupInvalidations(keys: InvalidationKey[]): InvalidationKey[] {
  const seen = new Map<string, InvalidationKey>();
  for (const k of keys) {
    const id = `${k.kind}:${k.ref}`;
    if (!seen.has(id)) seen.set(id, k);
  }
  return [...seen.values()];
}

export class GitHubEventsPoller {
  private cursor: EventCursor;
  private readonly fetchPage: FetchGitHubEventsPage;
  private readonly maxSeenIds: number;
  private readonly maxPagesPerTick: number;
  /** True iff constructed without a valid GitHub-shaped resume cursor. */
  private readonly startedWithoutCursor: boolean;
  /** Flips to true after the first completed tick. Cold start is one-shot. */
  private hasTicked = false;
  /** Remembered from the last 200's etag; re-sent as If-None-Match on page 1. */
  private etag: string | null = null;
  private serverPollIntervalMs: number | null = null;

  constructor(opts: GitHubEventsPollerOptions) {
    this.fetchPage = opts.fetchPage;
    this.maxSeenIds = opts.maxSeenIds ?? DEFAULT_MAX_SEEN_IDS;
    this.maxPagesPerTick = Math.min(
      opts.maxPagesPerTick ?? MAX_PAGES_PER_TICK_CEILING,
      MAX_PAGES_PER_TICK_CEILING
    );
    this.startedWithoutCursor = !isValidGitHubCursor(opts.cursor);
    this.cursor = isValidGitHubCursor(opts.cursor)
      ? opts.cursor
      : { since: null, lastEventId: null, seenIds: [] };
  }

  getCursor(): EventCursor {
    return { ...this.cursor, seenIds: [...(this.cursor.seenIds ?? [])] };
  }

  async tick(): Promise<GitHubTickResult> {
    const coldStart = this.startedWithoutCursor && !this.hasTicked;
    this.hasTicked = true;

    // Cold start caps at one page (see class doc comment); a warm tick
    // walks up to maxPagesPerTick, itself clamped to the page-4 ceiling.
    const pageLimit = coldStart ? 1 : this.maxPagesPerTick;

    const seen = new Set(this.cursor.seenIds ?? []);
    const fresh: GitHubEvent[] = [];
    let requests = 0;
    let notModified = false;

    for (let page = 1; page <= pageLimit; page++) {
      const etagToSend = page === 1 ? this.etag : null;
      const res = await this.fetchPage({ page, etag: etagToSend });
      requests++;

      if (page === 1 && res.status === 304) {
        // Nothing changed since the last 200: no page-walking, no
        // classification, cursor untouched. Cadence stays whatever the
        // last 200 taught us (A12: 304s don't carry X-Poll-Interval).
        notModified = true;
        break;
      }

      if (page === 1 && res.etag != null) this.etag = res.etag;
      if (res.pollIntervalSec != null) this.serverPollIntervalMs = res.pollIntervalSec * 1000;

      // Scan the whole page (mirrors EventsPoller.ts's `continue`-not-break
      // per-event handling) so a page mixing fresh and already-seen ids
      // still finds everything fresh on it; but once ANY already-seen id
      // turns up, stop requesting further pages -- we've caught up to
      // where the last tick left off.
      let hitSeen = false;
      for (const e of res.events) {
        if (seen.has(e.id)) {
          hitSeen = true;
          continue;
        }
        seen.add(e.id);
        fresh.push(e);
      }
      if (hitSeen) break;
    }

    if (notModified) {
      return {
        cursor: this.getCursor(),
        invalidations: [],
        freshEvents: 0,
        requests,
        coldStart,
        notModified: true,
        serverPollIntervalMs: this.serverPollIntervalMs,
      };
    }

    // Bound seenIds, oldest-first-evicted: `seen`'s insertion order is the
    // prior persisted order followed by this tick's newly-discovered ids,
    // so trimming from the front drops the oldest entries.
    let seenIds = [...seen];
    if (seenIds.length > this.maxSeenIds) {
      seenIds = seenIds.slice(seenIds.length - this.maxSeenIds);
    }
    // Reporting-only high-water mark: the newest fresh id this tick, if
    // any, else unchanged (dedup itself never consults this -- seenIds does).
    const lastEventId = fresh[0]?.id ?? this.cursor.lastEventId;
    // Cold start plants a now-ish anchor; GitHub's feed has no request
    // parameter that reads `since` back, so warm ticks just carry it
    // forward unchanged.
    const since = coldStart ? new Date().toISOString() : this.cursor.since;
    this.cursor = { since, lastEventId, seenIds };

    const invalidations = coldStart
      ? []
      : dedupInvalidations(fresh.flatMap((e) => classifyGitHubEvent(e)));

    return {
      cursor: this.getCursor(),
      invalidations,
      freshEvents: fresh.length,
      requests,
      coldStart,
      notModified: false,
      serverPollIntervalMs: this.serverPollIntervalMs,
    };
  }
}
