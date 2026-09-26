import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { readRespondReport, readRespondStates } from '../respond-state.ts';
import { insertAgentState, mintHandle } from '../state/agent-states.ts';
import { openStateDb } from '../state/db.ts';

let dir: string;
let dbPath: string;
let db: Database;
let seq = 0;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rps-'));
  dbPath = join(dir, 'state.db');
  db = openStateDb(dbPath);
  seq = 0;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const CLI = join(import.meta.dir, '..', '..', 'bin', 'respond-status.ts');

// Port 1 needs root to bind, so a connection refusal here is deterministic --
// this pins every CLI invocation in this file off any board that might
// actually be listening on the configured port.
function envFor() {
  return { ...process.env, MR_BOARD_PORT: '1', BOARD_STATE_DB: dbPath };
}

/** Each case gets its own MR url (and so its own row/handle), mirroring the
    distinct a.json/b.json/... files the old fixture used. */
function nextUrl(): string {
  seq += 1;
  return `https://gitlab.com/acme/webapp/-/merge_requests/${seq}`;
}

/** Seed the row a launch would already have written, at the handle the CLI
    call below addresses -- the CLI only ever updates by handle. */
function seedHandle(mrUrl: string): string {
  const handle = mintHandle('respond', mrUrl, dir);
  insertAgentState(
    'respond',
    mrUrl,
    seq,
    { mrUrl, iid: seq, status: 'queued', startedAt: 0, updatedAt: 0 },
    handle,
    db
  );
  return handle;
}

async function run(handle: string, ...args: string[]): Promise<number> {
  const proc = Bun.spawn(['bun', 'run', CLI, handle, ...args], {
    stderr: 'pipe',
    env: envFor(),
  });
  return await proc.exited;
}

describe('respond-status CLI', () => {
  test('the existing positional form still works untouched', async () => {
    const url = nextUrl();
    const handle = seedHandle(url);
    expect(await run(handle, 'drafting', '3 threads triaged')).toBe(0);
    const state = readRespondStates(db).get(url);
    expect(state?.status).toBe('drafting');
    expect(state?.message).toBe('3 threads triaged');
    expect(state?.posted).toBeUndefined();
  });

  test('records both counts in the space-separated form', async () => {
    const url = nextUrl();
    const handle = seedHandle(url);
    expect(
      await run(
        handle,
        'done',
        '2 fixed, 1 pushback',
        '--posted',
        '2',
        '--threads',
        '3'
      )
    ).toBe(0);
    const state = readRespondStates(db).get(url);
    expect(state?.posted).toBe(2);
    expect(state?.threads).toBe(3);
    expect(state?.message).toBe('2 fixed, 1 pushback');
  });

  test('records both counts in the --flag=value form', async () => {
    const url = nextUrl();
    const handle = seedHandle(url);
    expect(await run(handle, 'done', '--posted=0', '--threads=0')).toBe(0);
    const state = readRespondStates(db).get(url);
    expect(state?.posted).toBe(0);
    expect(state?.threads).toBe(0);
  });

  test('rejects a numerator with no denominator, which would say nothing', async () => {
    const handle = seedHandle(nextUrl());
    expect(await run(handle, 'done', '--posted', '2')).toBe(1);
  });

  test('records a held count next to the pair', async () => {
    const url = nextUrl();
    const handle = seedHandle(url);
    expect(
      await run(
        handle,
        'done',
        '1 posted, 1 held per gate',
        '--posted',
        '1',
        '--threads',
        '2',
        '--held',
        '1'
      )
    ).toBe(0);
    const state = readRespondStates(db).get(url);
    expect(state?.posted).toBe(1);
    expect(state?.threads).toBe(2);
    expect(state?.held).toBe(1);
  });

  test('rejects a held count with no denominator', async () => {
    const handle = seedHandle(nextUrl());
    expect(await run(handle, 'done', '--held', '1')).toBe(1);
  });

  test('records a round independent of the posted/threads pair', async () => {
    const url = nextUrl();
    const handle = seedHandle(url);
    expect(await run(handle, 'drafting', 'round 1 draft', '--round', '1')).toBe(
      0
    );
    const state = readRespondStates(db).get(url);
    expect(state?.round).toBe(1);
  });

  test('a later status write without --round leaves the recorded round in place', async () => {
    const url = nextUrl();
    const handle = seedHandle(url);
    expect(await run(handle, 'drafting', 'round 1 draft', '--round', '1')).toBe(
      0
    );
    expect(await run(handle, 'implementing')).toBe(0);
    const state = readRespondStates(db).get(url);
    expect(state?.round).toBe(1);
  });

  test('a revise cycle bumps the recorded round', async () => {
    const url = nextUrl();
    const handle = seedHandle(url);
    expect(await run(handle, 'drafting', 'round 1', '--round', '1')).toBe(0);
    expect(await run(handle, 'drafting', 'round 2', '--round', '2')).toBe(0);
    const state = readRespondStates(db).get(url);
    expect(state?.round).toBe(2);
  });

  test('rejects a round of zero, which is not a valid round number', async () => {
    expect(await run(seedHandle(nextUrl()), 'drafting', '--round', '0')).toBe(
      1
    );
  });

  test('rejects a non-integer round', async () => {
    expect(await run(seedHandle(nextUrl()), 'drafting', '--round', '1.5')).toBe(
      1
    );
  });

  test('rejects a round flag with no operand instead of dropping it', async () => {
    const url = nextUrl();
    const handle = seedHandle(url);
    expect(await run(handle, 'drafting', '--round')).toBe(1);
    expect(readRespondStates(db).get(url)?.status).toBe('queued');
  });

  test('rejects a count flag with no operand instead of dropping it', async () => {
    const url = nextUrl();
    const handle = seedHandle(url);
    expect(
      await run(handle, 'done', '--posted', '1', '--threads', '2', '--held')
    ).toBe(1);
    expect(readRespondStates(db).get(url)?.status).toBe('queued');
  });

  test('rejects a held count that is not a non-negative integer', async () => {
    expect(
      await run(
        seedHandle(nextUrl()),
        'done',
        '--posted',
        '1',
        '--threads',
        '2',
        '--held',
        '-1'
      )
    ).toBe(1);
  });

  test('rejects counts that are not non-negative integers', async () => {
    expect(
      await run(
        seedHandle(nextUrl()),
        'done',
        '--posted',
        '-1',
        '--threads',
        '3'
      )
    ).toBe(1);
    expect(
      await run(
        seedHandle(nextUrl()),
        'done',
        '--posted',
        '1.5',
        '--threads',
        '3'
      )
    ).toBe(1);
    expect(
      await run(
        seedHandle(nextUrl()),
        'done',
        '--posted',
        'two',
        '--threads',
        '3'
      )
    ).toBe(1);
    expect(await run(seedHandle(nextUrl()), 'done', '--threads', '-3')).toBe(1);
  });

  test('still rejects an unknown status', async () => {
    expect(await run(seedHandle(nextUrl()), 'bogus')).toBe(1);
  });

  // A denominator alone is merely incomplete (nothing went up), while a
  // numerator alone is uninterpretable, which is why only the latter fails.
  test('a threads count with no posted count means nothing was posted', async () => {
    const url = nextUrl();
    const handle = seedHandle(url);
    expect(await run(handle, 'done', '--threads', '3')).toBe(0);
    const state = readRespondStates(db).get(url);
    expect(state?.threads).toBe(3);
    expect(state?.posted).toBeUndefined();
  });

  test('a non-done status write still ingests a sibling report, so a mid-gate hold can serve it', async () => {
    const url = nextUrl();
    const handle = seedHandle(url);
    const reportPath = handle.replace(/\.json$/, '') + '.md';
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, '# adjudication\n\nposting 2 of 3');
    expect(await run(handle, 'drafting', 'awaiting the posting gate')).toBe(0);
    const state = readRespondStates(db).get(url);
    expect(state?.status).toBe('drafting');
    expect(state?.reportReady).toBe(true);
    expect(readRespondReport(url, db)).toContain('posting 2 of 3');
  });

  test('a stale pre-upgrade handle (no db at the derived root) fails loudly instead of creating one', async () => {
    const staleRoot = mkdtempSync(join(tmpdir(), 'rps-stale-'));
    const handle = mintHandle('respond', nextUrl(), staleRoot);
    const proc = Bun.spawn(['bun', 'run', CLI, handle, 'drafting'], {
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
