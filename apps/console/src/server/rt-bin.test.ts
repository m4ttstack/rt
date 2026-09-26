// @vitest-environment node
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveRtBin } from './rt-bin';

const realHome = process.env.HOME;
const realPath = process.env.PATH;

let home: string;

beforeEach(() => {
  // Fresh, empty HOME per test: `resolveRtBin` reads `homedir()` at call
  // time (never cached at import), same convention `seen.test.ts` uses for
  // `readSeen`/`markSeen` -- a module-level path constant would have
  // captured the real HOME instead.
  home = mkdtempSync(join(tmpdir(), 'console-rt-bin-'));
  process.env.HOME = home;
  process.env.PATH = '';
});

afterEach(() => {
  process.env.HOME = realHome;
  process.env.PATH = realPath;
});

function makeExecutable(path: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, '#!/bin/sh\necho fake-rt\n');
  chmodSync(path, 0o755);
}

describe('resolveRtBin', () => {
  it('finds rt at the primary location, ~/.local/bin/rt', () => {
    const primary = join(home, '.local', 'bin', 'rt');
    makeExecutable(primary);

    const result = resolveRtBin();

    expect(result.path).toBe(primary);
    expect(result.searched).toEqual([primary]);
  });

  it('falls back to PATH when the primary location has no executable', () => {
    const pathDir = mkdtempSync(join(tmpdir(), 'console-rt-bin-path-'));
    const onPath = join(pathDir, 'rt');
    makeExecutable(onPath);
    process.env.PATH = pathDir;

    const result = resolveRtBin();

    const primary = join(home, '.local', 'bin', 'rt');
    expect(result.path).toBe(onPath);
    expect(result.searched).toEqual([primary, onPath]);
  });

  it('reports path: null with every location it looked in when both miss', () => {
    const pathDirA = mkdtempSync(join(tmpdir(), 'console-rt-bin-path-a-'));
    const pathDirB = mkdtempSync(join(tmpdir(), 'console-rt-bin-path-b-'));
    // Neither PATH dir gets an `rt` file -- both misses.
    process.env.PATH = [pathDirA, pathDirB].join(delimiter);

    const result = resolveRtBin();

    const primary = join(home, '.local', 'bin', 'rt');
    expect(result.path).toBeNull();
    expect(result.searched).toEqual([
      primary,
      join(pathDirA, 'rt'),
      join(pathDirB, 'rt'),
    ]);
  });

  it('does not re-check the primary path a second time when it also appears on PATH', () => {
    // Primary itself has no executable, so resolution falls through to
    // PATH -- but `~/.local/bin` is ALSO one of the PATH entries, and a
    // second PATH dir carries the real executable. The dedup guard should
    // skip re-testing the already-checked primary candidate rather than
    // appending it to `searched` twice.
    const localBin = join(home, '.local', 'bin');
    mkdirSync(localBin, { recursive: true });
    const otherDir = mkdtempSync(join(tmpdir(), 'console-rt-bin-other-'));
    const onOtherDir = join(otherDir, 'rt');
    makeExecutable(onOtherDir);
    process.env.PATH = [localBin, otherDir].join(delimiter);

    const result = resolveRtBin();

    const primary = join(home, '.local', 'bin', 'rt');
    expect(result.path).toBe(onOtherDir);
    expect(result.searched).toEqual([primary, onOtherDir]);
  });
});
