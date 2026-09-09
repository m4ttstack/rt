import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';

import { insertAgentState, mintHandle } from '../state/agent-states.ts';
import { openStateDb } from '../state/db.ts';
import { readReviewReport, readReviewStates } from '../review-state.ts';

let dir: string;
let dbPath: string;
let db: Database;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rc-'));
  dbPath = join(dir, 'state.db');
  db = openStateDb(dbPath);
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const CLI = join(import.meta.dir, '..', '..', 'bin', 'review-status.ts');
const URL_A = 'https://gitlab.com/acme/webapp/-/merge_requests/4821';

// Port 1 needs root to bind, so a connection refusal here is deterministic --
// this pins every CLI invocation in this file off any board that might
// actually be listening on the configured port (which could hold a real
// Slack token and touch real MRs).
function env() {
  return { ...process.env, MR_BOARD_PORT: '1', BOARD_STATE_DB: dbPath };
}

/** Seed the row a launch would already have written, at the handle the CLI
    call below addresses -- the CLI only ever updates by handle. */
function seed(handle: string, iid: number): void {
  insertAgentState(
    'review',
    URL_A,
    iid,
    { mrUrl: URL_A, iid, status: 'queued', startedAt: 0, updatedAt: 0 },
    handle,
    db
  );
}

describe('review-status CLI', () => {
  test('writes status and message to the row at the given handle', async () => {
    const handle = mintHandle('review', URL_A, dir);
    seed(handle, 4821);
    const proc = Bun.spawn(
      ['bun', 'run', CLI, handle, 'reviewing', '3 issues (1 critical)'],
      { env: env() }
    );
    const code = await proc.exited;
    expect(code).toBe(0);
    const state = readReviewStates(db).get(URL_A);
    expect(state?.status).toBe('reviewing');
    expect(state?.message).toBe('3 issues (1 critical)');
    expect(typeof state?.updatedAt).toBe('number');
  });

  test('rejects an unknown status', async () => {
    const handle = mintHandle('review', URL_A, dir);
    seed(handle, 4821);
    const proc = Bun.spawn(['bun', 'run', CLI, handle, 'bogus'], {
      stderr: 'pipe',
      env: env(),
    });
    const code = await proc.exited;
    expect(code).toBe(1);
  });

  test('a failed board notify does not change the exit code or the state write', async () => {
    const handle = mintHandle('review', URL_A, dir);
    seed(handle, 4821);
    const proc = Bun.spawn(
      ['bun', 'run', CLI, handle, 'done', 'looks solid', '--outcome', 'approve'],
      { stderr: 'pipe', env: env() }
    );
    const code = await proc.exited;
    expect(code).toBe(0);
    const state = readReviewStates(db).get(URL_A);
    expect(state?.status).toBe('done');
    expect(state?.outcome).toBe('approve');
  });

  test('a non-done status write still ingests a sibling report, so a mid-gate hold can serve it', async () => {
    const handle = mintHandle('review', URL_A, dir);
    seed(handle, 4821);
    const reportPath = handle.replace(/\.json$/, '') + '.md';
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, '# full review\n\nlgtm');
    const proc = Bun.spawn(
      ['bun', 'run', CLI, handle, 'reviewing', 'awaiting the outcome gate'],
      { stderr: 'pipe', env: env() }
    );
    const code = await proc.exited;
    expect(code).toBe(0);
    const state = readReviewStates(db).get(URL_A);
    expect(state?.status).toBe('reviewing');
    expect(state?.reportReady).toBe(true);
    expect(readReviewReport(URL_A, db)).toContain('lgtm');
  });

  test('a stale pre-upgrade handle (no db at the derived root) fails loudly instead of creating one', async () => {
    const staleRoot = mkdtempSync(join(tmpdir(), 'rc-stale-'));
    const handle = mintHandle('review', URL_A, staleRoot);
    const proc = Bun.spawn(['bun', 'run', CLI, handle, 'reviewing'], {
      stderr: 'pipe',
      env: { ...process.env, MR_BOARD_PORT: '1' },
    });
    const code = await proc.exited;
    expect(code).toBe(1);
    const stderr = await new Response(proc.stderr).text();
    expect(stderr).toContain('stale pre-upgrade handle?');
    rmSync(staleRoot, { recursive: true, force: true });
  });
});
