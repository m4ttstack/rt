// @vitest-environment node
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { markSeen, readSeen, seenPath } from './seen';

const realHome = process.env.HOME;

beforeEach(() => {
  process.env.HOME = mkdtempSync(join(tmpdir(), 'console-seen-'));
});
afterEach(() => {
  process.env.HOME = realHome;
});

describe('seen store', () => {
  it('reads an empty object when nothing has been seen', () => {
    expect(readSeen()).toEqual({});
  });

  it('records a run and survives a re-read', () => {
    markSeen('run-1');

    expect(Object.keys(readSeen())).toEqual(['run-1']);
    expect(typeof readSeen()['run-1']).toBe('number');
  });

  it('is additive rather than last-write-wins', () => {
    markSeen('run-1');
    markSeen('run-2');

    expect(Object.keys(readSeen()).sort()).toEqual(['run-1', 'run-2']);
  });

  it('survives a corrupt file rather than crashing the server', () => {
    markSeen('run-1');
    writeFileSync(seenPath(), 'not json');

    expect(readSeen()).toEqual({});
  });

  it('resolves HOME at call time, not at import time', () => {
    // The whole point of the beforeEach above: a module-level path constant
    // would have captured the real HOME and written to the user's home dir.
    expect(seenPath().startsWith(process.env.HOME!)).toBe(true);
  });
});
