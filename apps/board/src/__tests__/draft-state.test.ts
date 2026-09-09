import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  attachDrafts,
  heldDraftsByMr,
  pruneDrafts,
  readDrafts,
  writeDraft,
} from '../draft-state.ts';
import { openStateDb } from '../state/db.ts';

let dir: string;
let db: Database;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'drafts-'));
  db = openStateDb(join(dir, 'state.db'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('draft state', () => {
  test('write, read, and group held drafts by MR', () => {
    writeDraft(
      'https://x/mr/1',
      'inherited-note',
      {
        mrUrl: 'https://x/mr/1',
        iid: 1,
        kind: 'inherited-note',
        body: 'fails on master too',
        status: 'held',
      },
      100,
      db
    );
    writeDraft(
      'https://x/mr/1',
      'rebase-note',
      {
        mrUrl: 'https://x/mr/1',
        iid: 1,
        kind: 'rebase-note',
        body: 'needs rebase',
        status: 'held',
      },
      100,
      db
    );
    writeDraft(
      'https://x/mr/2',
      'inherited-note',
      {
        mrUrl: 'https://x/mr/2',
        iid: 2,
        kind: 'inherited-note',
        body: 'x',
        status: 'dismissed',
      },
      100,
      db
    );
    const all = readDrafts(db);
    expect(all).toHaveLength(3);
    const held = heldDraftsByMr(all);
    expect(held.get('https://x/mr/1')).toHaveLength(2);
    expect(held.has('https://x/mr/2')).toBe(false); // dismissed is not held
  });

  test('status patch preserves body and stamps updatedAt', () => {
    writeDraft(
      'https://x/mr/1',
      'inherited-note',
      {
        mrUrl: 'https://x/mr/1',
        iid: 1,
        kind: 'inherited-note',
        body: 'b',
        status: 'held',
      },
      100,
      db
    );
    const posted = writeDraft(
      'https://x/mr/1',
      'inherited-note',
      { status: 'posted', postedNoteId: 7 },
      200,
      db
    );
    expect(posted.body).toBe('b');
    expect(posted.createdAt).toBe(100);
    expect(posted.updatedAt).toBe(200);
    expect(posted.postedNoteId).toBe(7);
  });

  test('prune drops drafts whose MR left the board; attach decorates rows', () => {
    writeDraft(
      'https://x/mr/1',
      'k',
      { mrUrl: 'https://x/mr/1', iid: 1, kind: 'k', body: 'b', status: 'held' },
      100,
      db
    );
    writeDraft(
      'https://x/mr/9',
      'k',
      { mrUrl: 'https://x/mr/9', iid: 9, kind: 'k', body: 'b', status: 'held' },
      100,
      db
    );
    pruneDrafts(new Set(['https://x/mr/1']), db);
    const held = heldDraftsByMr(readDrafts(db));
    expect(held.has('https://x/mr/9')).toBe(false);
    const rows = attachDrafts(
      [{ webUrl: 'https://x/mr/1' }, { webUrl: 'https://x/mr/3' }],
      held
    );
    expect(rows[0]!.drafts).toHaveLength(1);
    expect(rows[1]!.drafts).toBeUndefined();
  });
});
