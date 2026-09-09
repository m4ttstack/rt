import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';

import { insertAgentState, mintHandle } from '../state/agent-states.ts';
import { openStateDb } from '../state/db.ts';
import { readRespondStates } from '../respond-state.ts';

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

  test('rejects counts that are not non-negative integers', async () => {
    expect(
      await run(seedHandle(nextUrl()), 'done', '--posted', '-1', '--threads', '3')
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
      await run(seedHandle(nextUrl()), 'done', '--posted', 'two', '--threads', '3')
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
});
