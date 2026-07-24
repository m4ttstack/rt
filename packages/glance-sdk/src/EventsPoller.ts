/**
 * EventsPoller: pure per-tick logic over the GitLab project events feed.
 *
 * The feed is the freshness backbone for cache invalidation. Contract:
 *  - Day-exclusive gotcha: GitLab's `after=YYYY-MM-DD` EXCLUDES the named
 *    day. Every tick requests from one day before the cursor date and
 *    filters client-side by `lastEventId`.
 *  - Pages arrive newest-first. A tick walks pages until it sees the cursor
 *    id or a short page, bounded by maxPagesPerTick.
 *  - Cold start (no cursor id) establishes a cursor and reports NO
 *    invalidations. Consumers full-refresh on boot; replaying history here
 *    would only cause a refresh storm.
 *
 * Known blind spots of the feed itself (verified against gitlab.com):
 * metadata-only MR edits (title/description/labels/assignees) and pipeline
 * status transitions do not emit events. Consumers keep a slow full-refresh
 * as the safety net for those.
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

  // Pushes move a branch tip and (usually) start a pipeline.
  if (e.action_name?.startsWith('pushed') && e.push_data?.ref) {
    return [
      { kind: 'branch', ref: e.push_data.ref, cause: e.action_name },
      { kind: 'pipelines', ref: '*', cause: `pushed to ${e.push_data.ref}` },
    ];
  }

  if (e.action_name === 'deleted' && e.push_data?.ref) {
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

export class EventsPoller {
  private cursor: EventCursor;
  private readonly fetchEvents: FetchEvents;
  private readonly perPage: number;
  private readonly maxPagesPerTick: number;

  constructor(opts: EventsPollerOptions) {
    this.fetchEvents = opts.fetchEvents;
    this.cursor = opts.cursor ?? { since: null, lastEventId: null };
    this.perPage = opts.perPage ?? 100;
    this.maxPagesPerTick = opts.maxPagesPerTick ?? 5;
  }

  getCursor(): EventCursor {
    return { ...this.cursor };
  }

  async tick(): Promise<TickResult> {
    const coldStart = this.cursor.lastEventId === null;

    // Day-exclusive gotcha: ask from the day BEFORE the cursor date (2 days
    // back on cold start) and rely on the id filter below for precision.
    const fromMs = this.cursor.since
      ? new Date(this.cursor.since).getTime() - DAY_MS
      : Date.now() - 2 * DAY_MS;
    const after = new Date(fromMs).toISOString().slice(0, 10);

    const fresh: GitLabEvent[] = [];
    let requests = 0;
    let sawCursor = false;
    for (let page = 1; page <= this.maxPagesPerTick && !sawCursor; page++) {
      const events = await this.fetchEvents({ after, perPage: this.perPage, page });
      requests++;
      if (events.length === 0) break;
      for (const e of events) {
        if (this.cursor.lastEventId != null && e.id <= this.cursor.lastEventId) {
          sawCursor = true;
          continue;
        }
        fresh.push(e);
      }
      if (events.length < this.perPage) break;
    }

    const invalidations: InvalidationKey[] = [];
    let maxId = this.cursor.lastEventId ?? -1;
    let maxTs = this.cursor.since;
    for (const e of fresh) {
      invalidations.push(...classifyEvent(e));
      if (e.id > maxId) maxId = e.id;
      if (!maxTs || e.created_at > maxTs) maxTs = e.created_at;
    }
    if (fresh.length > 0) {
      this.cursor = { since: maxTs, lastEventId: maxId };
    }

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
