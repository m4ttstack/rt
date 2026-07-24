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
