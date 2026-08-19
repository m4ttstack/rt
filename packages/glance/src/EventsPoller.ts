/**
 * EventsPoller: pure per-tick logic over the GitLab project events feed.
 *
 * The feed is the freshness backbone for cache invalidation. Contract:
 *  - Day-exclusive gotcha: GitLab's `after=YYYY-MM-DD` EXCLUDES the named
 *    day. Every tick requests from one day before the cursor date and
 *    filters client-side by `lastEventId`.
 *  - Pages arrive newest-first. A tick walks pages until it sees the cursor
 *    id or a short page, bounded by maxPagesPerTick.
 *  - Cold start is one-shot: it's the FIRST tick of a poller constructed
 *    without a resume cursor, full stop, not "any tick where lastEventId
 *    happens to be null." That tick reports NO invalidations regardless of
 *    what it finds (consumers full-refresh on boot; replaying history here
 *    would only cause a refresh storm). If that first tick finds the feed
 *    empty (idle repo, nothing in the lookback window), it still has to
 *    leave a trace: it sets the cursor to
 *    `{ since: now - CLOCK_SKEW_MARGIN_MS, lastEventId: null }` as a time
 *    anchor, rather than leaving both fields null. Without this, a naive
 *    "coldStart = cursor.lastEventId === null" re-derivation would stay
 *    true across every subsequent empty tick and silently swallow the
 *    invalidations of whichever tick finally sees the first real event.
 *    The backward padding absorbs clock skew against GitLab's server clock
 *    (see CLOCK_SKEW_MARGIN_MS below).
 *  - Timestamp fallback: once an empty cold tick has planted that time
 *    anchor, `lastEventId` is null but `since` isn't. Ticks in that state
 *    filter by `created_at > since` instead of by id (same stop-walking
 *    semantics on the newest-first feed: hit one at-or-before `since` and
 *    everything older is old too). The moment a tick actually sees fresh
 *    events, the cursor gets a real `lastEventId` and id-filtering resumes.
 *
 * Known blind spots of the feed itself (verified against gitlab.com):
 * metadata-only MR edits (title/description/labels/assignees) and pipeline
 * status transitions do not emit events. Consumers keep a slow full-refresh
 * as the safety net for those.
 *
 * Per-tick truncation bound: a single tick delivers at most
 * `maxPagesPerTick * perPage` fresh events (the walk stops once that many
 * pages have been fetched, cursor id/timestamp seen, or otherwise). A burst
 * of activity between ticks larger than that bound advances the cursor past
 * the excess -- those events are never seen and their invalidations are
 * silently skipped, not queued for a later tick. Consumers keep a periodic
 * full refresh as the safety net for this case too.
 *
 * No I/O here: `fetchEvents` is injected and cursor persistence is the
 * caller's job (see EventsWatcher's onCursor).
 */
import type { EventCursor, InvalidationKey } from './types.ts';

/** The subset of a GitLab event we consume. Snake_case as the API returns. */
export interface GitLabEvent {
  id: number;
  action_name: string;
  target_type: string | null;
  target_iid: number | null;
  created_at: string;
  push_data?: { ref?: string; ref_type?: string; action?: string };
  note?: { noteable_type?: string; noteable_iid?: number };
}

/** Injected page fetch. `after` is a YYYY-MM-DD string (see day-exclusive note). */
export type FetchEvents = (opts: {
  after: string;
  perPage: number;
  page: number;
}) => Promise<GitLabEvent[]>;

export function classifyEvent(e: GitLabEvent): InvalidationKey[] {
  // MR lifecycle + approvals: opened / closed / merged / reopened / approved
  if (e.target_type === 'MergeRequest' && e.target_iid != null) {
    return [{ kind: 'mr', ref: String(e.target_iid), cause: e.action_name }];
  }

  // Notes: invalidate the thread cache and the MR itself (approval and
  // mention state can shift with a comment).
  if (e.target_type === 'Note' || e.action_name === 'commented on') {
    const iid = e.note?.noteable_iid ?? e.target_iid;
    if (iid != null && (e.note?.noteable_type ?? 'MergeRequest') === 'MergeRequest') {
      return [
        { kind: 'notes', ref: String(iid), cause: 'note added' },
        { kind: 'mr', ref: String(iid), cause: 'note added' },
      ];
    }
    return [];
  }

  // Pushes move a branch tip and (usually) start a pipeline. Tag pushes also
  // start pipelines (tag pipelines are real), but only a branch ref has a
  // branch-cache invalidation to emit -- gate the `branch` key on ref_type.
  if (e.action_name?.startsWith('pushed') && e.push_data?.ref) {
    const keys: InvalidationKey[] = [];
    if (e.push_data.ref_type === 'branch') {
      keys.push({ kind: 'branch', ref: e.push_data.ref, cause: e.action_name });
    }
    keys.push({ kind: 'pipelines', ref: '*', cause: `pushed to ${e.push_data.ref}` });
    return keys;
  }

  // Same ref_type gate for deletion: deleting a tag doesn't invalidate any
  // branch cache.
  if (e.action_name === 'deleted' && e.push_data?.ref) {
    if (e.push_data.ref_type !== 'branch') return [];
    return [{ kind: 'branch', ref: e.push_data.ref, cause: 'deleted' }];
  }

  return [];
}

export interface TickResult {
  cursor: EventCursor;
  /** Deduped by kind:ref. Empty on cold start regardless of feed content. */
  invalidations: InvalidationKey[];
  freshEvents: number;
  requests: number;
  coldStart: boolean;
}

export interface EventsPollerOptions {
  fetchEvents: FetchEvents;
  /** Resume point. Omit for a cold start. */
  cursor?: EventCursor;
  perPage?: number;
  maxPagesPerTick?: number;
}

const DAY_MS = 24 * 60 * 60_000;

/**
 * Padding applied to the empty-cold-start time anchor to absorb clock skew
 * between this process's local clock and GitLab's server clock (which
 * stamps `created_at`). See the empty-cold-tick branch in `tick()`.
 */
const CLOCK_SKEW_MARGIN_MS = 60_000;

/**
 * A resume cursor's `lastEventId` as the number this poller's id filter needs,
 * or null when it is not one.
 *
 * GitLab's event ids are numeric, but `EventCursor.lastEventId` widened to
 * `number | string | null` when GitHub's string ids arrived, so a value of the
 * other type can now reach this GitLab-only poller: rt persists cursors to
 * `~/.mattstack/rt/events-cursors.json` with no schema version and no field-level
 * validation, so a cursor written by one provider parses cleanly and is handed
 * straight to the other.
 *
 * Coercing rather than ignoring is the whole point. A non-numeric
 * `lastEventId` left in place is still non-null, which keeps `tick()`'s
 * timestamp fallback switched OFF while the id filter it disabled never fires
 * -- so every event in the `after=` window comes back as fresh invalidations,
 * a healthy-looking watcher replaying history. That is the exact silent dedup
 * failure the live U20 flow exists to catch, and it is what an earlier
 * `typeof last === 'number'` guard here produced. Anything that is not a
 * finite number normalizes to null instead, which routes the tick through the
 * `since` timestamp fallback, or through a cold start when `since` is null too.
 */
function normalizeLastEventId(value: EventCursor['lastEventId']): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    // Digit strings only: Number() also accepts hex ("0x1A"), scientific
    // notation ("1e10"), and other forms no persisted lastEventId is ever
    // actually shaped like. A GitLab event id is decimal digits, full stop.
    if (/^-?\d+$/.test(trimmed)) {
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? parsed : null;
    }
  }
  return null;
}

export class EventsPoller {
  private cursor: EventCursor;
  private readonly fetchEvents: FetchEvents;
  private readonly perPage: number;
  private readonly maxPagesPerTick: number;
  /** True iff constructed without a resume cursor (the only pollers that ever go cold). */
  private readonly startedWithoutCursor: boolean;
  /** Flips to true after the first completed tick. Cold start is one-shot. */
  private hasTicked = false;

  constructor(opts: EventsPollerOptions) {
    this.fetchEvents = opts.fetchEvents;
    // Normalized once, here, so `this.cursor.lastEventId` is `number | null`
    // everywhere below -- both writes to it in `tick()` store numbers, so this
    // is the only door a foreign type can come through.
    const since = opts.cursor?.since ?? null;
    // A cursor carrying `seenIds` is GitHub-shaped, not GitLab-shaped --
    // GitLab cursors never set that field (EventCursor's doc comment in
    // types.ts). rt persists cursors with no schema version, so a
    // GitHub-written cursor can reach this GitLab-only poller, and its
    // `lastEventId` is a digit string (e.g. "16878075933") that parses
    // cleanly through `normalizeLastEventId` as a real numeric high-water
    // mark -- one far larger than any GitLab event id, which then filters
    // every event as already-seen, forever: no throw, no degraded status,
    // `coldStart` false. Treat `seenIds !== undefined` as the unambiguous
    // foreign-cursor marker and drop `lastEventId` before it ever reaches
    // normalization, so the `since` fallback (or a cold start, if `since` is
    // also absent) takes over instead. This is the mirror image of
    // `isValidGitHubCursor` in GitHubEventsPoller.ts, which rejects the
    // reverse case -- a cursor missing `seenIds` -- as not GitHub-shaped.
    const lastEventId =
      opts.cursor?.seenIds !== undefined
        ? null
        : normalizeLastEventId(opts.cursor?.lastEventId ?? null);
    this.cursor = { since, lastEventId };
    // A cursor with BOTH fields null (e.g. round-tripped through storage,
    // or explicitly passed) is absent in every way that matters -- treat it
    // the same as an omitted cursor. Otherwise it would permanently disable
    // cold-start suppression and risk a full lookback-window history replay.
    // Read off the NORMALIZED fields: a cursor carrying only an
    // uninterpretable `lastEventId` is absent by the same argument.
    this.startedWithoutCursor = since == null && lastEventId == null;
    this.perPage = opts.perPage ?? 100;
    this.maxPagesPerTick = opts.maxPagesPerTick ?? 5;
  }

  getCursor(): EventCursor {
    return { ...this.cursor };
  }

  async tick(): Promise<TickResult> {
    const coldStart = this.startedWithoutCursor && !this.hasTicked;

    // Day-exclusive gotcha: ask from the day BEFORE the cursor date (2 days
    // back on cold start) and rely on the id/timestamp filter below for
    // precision.
    const fromMs = this.cursor.since
      ? new Date(this.cursor.since).getTime() - DAY_MS
      : Date.now() - 2 * DAY_MS;
    const after = new Date(fromMs).toISOString().slice(0, 10);

    // Timestamp fallback: only reachable once an earlier empty cold tick
    // planted `since` without a `lastEventId`. Otherwise id-filtering.
    const useTimestampFallback = this.cursor.lastEventId == null && this.cursor.since != null;

    const fresh: GitLabEvent[] = [];
    let requests = 0;
    let sawCursor = false;
    for (let page = 1; page <= this.maxPagesPerTick && !sawCursor; page++) {
      const events = await this.fetchEvents({ after, perPage: this.perPage, page });
      requests++;
      if (events.length === 0) break;
      for (const e of events) {
        if (useTimestampFallback) {
          if (this.cursor.since != null && Date.parse(e.created_at) <= Date.parse(this.cursor.since)) {
            sawCursor = true;
            continue;
          }
        } else {
          // `EventCursor.lastEventId` is `number | string | null` at the type
          // (GitHub's ids are strings); the constructor has already coerced
          // this poller's copy to `number | null`, so a non-null value here is
          // always a number and this narrowing never silently skips the filter.
          const last = this.cursor.lastEventId;
          if (typeof last === 'number' && e.id <= last) {
            sawCursor = true;
            continue;
          }
        }
        fresh.push(e);
      }
      if (events.length < this.perPage) break;
    }

    const invalidations: InvalidationKey[] = [];
    let maxId: number = typeof this.cursor.lastEventId === 'number' ? this.cursor.lastEventId : -1;
    let maxTs = this.cursor.since;
    for (const e of fresh) {
      invalidations.push(...classifyEvent(e));
      if (e.id > maxId) maxId = e.id;
      if (!maxTs || Date.parse(e.created_at) > Date.parse(maxTs)) maxTs = e.created_at;
    }
    if (fresh.length > 0) {
      this.cursor = { since: maxTs, lastEventId: maxId };
    } else if (coldStart) {
      // Empty cold tick: plant a time anchor so "cold" can't be re-derived
      // from a still-null lastEventId on every subsequent tick.
      //
      // Pad the anchor backwards by CLOCK_SKEW_MARGIN_MS: `created_at` is
      // stamped by GitLab's server clock, not ours. If GitLab's clock lags
      // behind local time, an event created moments after "now" could still
      // carry a `created_at` at-or-before an unpadded anchor and be
      // silently dropped forever (the anchor never re-advances until an
      // event passes the filter). Trade-off: events up to
      // CLOCK_SKEW_MARGIN_MS before start may be re-delivered as
      // invalidations on the first warm tick -- harmless over-delivery,
      // since invalidations are idempotent refresh hints -- in exchange for
      // immunity to server/client clock skew up to the margin.
      this.cursor = {
        since: new Date(Date.now() - CLOCK_SKEW_MARGIN_MS).toISOString(),
        lastEventId: null,
      };
    }
    this.hasTicked = true;

    return {
      cursor: this.getCursor(),
      invalidations: coldStart ? [] : dedup(invalidations),
      freshEvents: fresh.length,
      requests,
      coldStart,
    };
  }
}

function dedup(keys: InvalidationKey[]): InvalidationKey[] {
  const seen = new Map<string, InvalidationKey>();
  for (const k of keys) {
    const id = `${k.kind}:${k.ref}`;
    if (!seen.has(id)) seen.set(id, k);
  }
  return [...seen.values()];
}
