import { Database } from 'bun:sqlite';

import { getStateDb, persistOrWarn, runCriticalWrite } from './state/index.ts';

/** An outbound MR note the doctor DRAFTED but may never post. Held drafts are
    the only path to GitLab notes, and only the board's approval click walks
    it -- the doctor tier has no posting capability at all (spec §6). */
export type DraftStatus = 'held' | 'posted' | 'dismissed';

export interface DraftState {
  mrUrl: string;
  iid: number;
  /** What the note is (e.g. "inherited-note", "rebase-note"). One draft per
      (mrUrl, kind): a re-draft overwrites rather than piling up. */
  kind: string;
  body: string;
  status: DraftStatus;
  createdAt: number;
  updatedAt: number;
  postedNoteId?: number;
}

function readDraftRow(
  mrUrl: string,
  kind: string,
  db: Database
): DraftState | null {
  const row = db
    .query('SELECT draft FROM drafts WHERE mr_url = ? AND kind = ?')
    .get(mrUrl, kind) as { draft: string } | null;
  if (!row) return null;
  try {
    return JSON.parse(row.draft) as DraftState;
  } catch {
    return null;
  }
}

/** Read-merge-write a draft row, keyed by (mrUrl, kind). */
export function writeDraft(
  mrUrl: string,
  kind: string,
  patch: Partial<DraftState> & { status: DraftStatus },
  now: number = Date.now(),
  db: Database = getStateDb()
): DraftState {
  let next!: DraftState;
  runCriticalWrite('draft write', () => {
    const tx = db.transaction(() => {
      const prev: Partial<DraftState> = readDraftRow(mrUrl, kind, db) ?? {};
      next = {
        mrUrl: patch.mrUrl ?? prev.mrUrl ?? mrUrl,
        iid: patch.iid ?? prev.iid ?? 0,
        kind: patch.kind ?? prev.kind ?? kind,
        body: patch.body ?? prev.body ?? '',
        status: patch.status,
        createdAt: prev.createdAt ?? now,
        updatedAt: now,
        postedNoteId: patch.postedNoteId ?? prev.postedNoteId,
      };
      db.query(
        `INSERT INTO drafts (mr_url, kind, draft, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(mr_url, kind) DO UPDATE SET draft = excluded.draft, updated_at = excluded.updated_at`
      ).run(mrUrl, kind, JSON.stringify(next), now);
    });
    tx();
  });
  return next;
}

export function readDrafts(db: Database = getStateDb()): DraftState[] {
  const rows = db.query('SELECT draft FROM drafts').all() as {
    draft: string;
  }[];
  const out: DraftState[] = [];
  for (const row of rows) {
    try {
      const d = JSON.parse(row.draft) as DraftState;
      if (d.mrUrl && d.kind) out.push(d);
    } catch {
      continue;
    }
  }
  return out;
}

export function heldDraftsByMr(
  drafts: DraftState[]
): Map<string, DraftState[]> {
  const out = new Map<string, DraftState[]>();
  for (const d of drafts) {
    if (d.status !== 'held') continue;
    const list = out.get(d.mrUrl) ?? [];
    list.push(d);
    out.set(d.mrUrl, list);
  }
  return out;
}

/** Same lifecycle as pruneDoctorStates: a draft lives as long as its MR is on
    the board. A merged/closed MR moots its held notes; the audit log keeps
    the record of what was drafted. */
export function pruneDrafts(
  keepUrls: ReadonlySet<string>,
  db: Database = getStateDb()
): void {
  const rows = db.query('SELECT mr_url, kind FROM drafts').all() as {
    mr_url: string;
    kind: string;
  }[];
  const stale = rows.filter(row => !keepUrls.has(row.mr_url));
  if (stale.length === 0) return;
  persistOrWarn('draft prune', () => {
    const tx = db.transaction(() => {
      for (const row of stale) {
        db.query('DELETE FROM drafts WHERE mr_url = ? AND kind = ?').run(
          row.mr_url,
          row.kind
        );
      }
    });
    tx();
  });
}

export function attachDrafts<T extends { webUrl?: string | null }>(
  mrs: T[],
  held: Map<string, DraftState[]>
): Array<T & { drafts?: DraftState[] }> {
  return mrs.map(mr =>
    mr.webUrl && held.has(mr.webUrl)
      ? { ...mr, drafts: held.get(mr.webUrl) }
      : mr
  );
}
