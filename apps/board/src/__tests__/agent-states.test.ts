import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { openStateDb } from '../state/db.ts';
import {
  insertAgentState, mintHandle, pruneStates, readReport, readStates,
  setReportByHandle, updateByHandle,
} from '../state/agent-states.ts';

const URL = 'https://gitlab.example.com/g/p/-/merge_requests/7';

function db() {
  return openStateDb(join(mkdtempSync(join(tmpdir(), 'board-as-')), 'state.db'));
}

describe('agent states', () => {
  test('insert then update by handle merges fields', () => {
    const d = db();
    const h = mintHandle('review', URL, '/tmp/fake-root');
    insertAgentState('review', URL, 7, { mrUrl: URL, iid: 7, status: 'queued', startedAt: 1, updatedAt: 1 }, h, d);
    const merged = updateByHandle(h, { status: 'done', outcome: 'comment' }, 2, d) as { status: string; outcome: string; mrUrl: string };
    expect(merged.status).toBe('done');
    expect(merged.mrUrl).toBe(URL);
    expect(readStates('review', d).get(URL)).toMatchObject({ status: 'done', outcome: 'comment', reportReady: false });
  });

  test('update by unknown handle returns null, writes nothing', () => {
    const d = db();
    expect(updateByHandle('/nope/state/reviews/x.json', { status: 'done' }, 2, d)).toBeNull();
    expect(readStates('review', d).size).toBe(0);
  });

  test('report ingestion flips reportReady', () => {
    const d = db();
    const h = mintHandle('review', URL, '/tmp/fake-root');
    insertAgentState('review', URL, 7, { mrUrl: URL, iid: 7, status: 'reviewing', startedAt: 1, updatedAt: 1 }, h, d);
    expect(setReportByHandle(h, '# report', d)).toBe(true);
    expect(readStates('review', d).get(URL)).toMatchObject({ reportReady: true });
    expect(readReport('review', URL, d)).toBe('# report');
  });

  test('prune keeps only listed urls', () => {
    const d = db();
    insertAgentState('review', URL, 7, { mrUrl: URL, iid: 7, status: 'done', startedAt: 1, updatedAt: 1 }, mintHandle('review', URL, '/r'), d);
    pruneStates('review', new Set<string>(), d);
    expect(readStates('review', d).size).toBe(0);
  });
});
