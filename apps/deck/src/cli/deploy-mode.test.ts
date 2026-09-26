import { mkdtempSync, realpathSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, expect, test } from 'bun:test';

import {
  deployMode,
  linkedCheckoutMismatch,
  restartHealthzVerdict,
} from './deploy-mode.ts';

let createdDirs: string[] = [];
function tmpCheckoutDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  createdDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of createdDirs) rmSync(dir, { recursive: true, force: true });
  createdDirs = [];
});

test('a standalone deck installs a new build', () => {
  expect(deployMode(false, {}, null)).toEqual({ kind: 'install' });
  expect(deployMode(false, { DECK_RUN_MODE: 'source' }, null)).toEqual({
    kind: 'install',
  });
});

test('a helper-owned deck running from source restarts', () => {
  expect(deployMode(true, { DECK_RUN_MODE: 'source' }, null)).toEqual({
    kind: 'restart',
  });
});

test('from a terminal, the serving deck recorded in api.json decides', () => {
  expect(deployMode(true, {}, { runMode: 'source' })).toEqual({
    kind: 'restart',
  });
  const pinned = deployMode(
    true,
    {},
    {
      runMode: 'pinned',
      runReason: 'bun missing',
    }
  );
  expect(pinned.kind === 'refuse' && pinned.message).toContain('bun missing');
});

test('the spawning environment wins over api.json', () => {
  expect(
    deployMode(true, { DECK_RUN_MODE: 'source' }, { runMode: 'pinned' })
  ).toEqual({ kind: 'restart' });
});

test('a helper-owned deck on the pinned fallback refuses and names why', () => {
  const mode = deployMode(
    true,
    {
      DECK_RUN_MODE: 'pinned',
      DECK_RUN_REASON: 'bun not found at /Users/x/.bun/bin/bun',
    },
    null
  );
  expect(mode.kind).toBe('refuse');
  expect(mode.kind === 'refuse' && mode.message).toContain(
    'bun not found at /Users/x/.bun/bin/bun'
  );
  expect(mode.kind === 'refuse' && mode.message).toContain('pinned release');
});

test('a helper-owned deck with no shim refuses and points at the shim log', () => {
  const mode = deployMode(true, {}, null);
  expect(mode.kind).toBe('refuse');
  expect(mode.kind === 'refuse' && mode.message).toContain(
    'mattstack app owns deck'
  );
  expect(mode.kind === 'refuse' && mode.message).toContain('deck.err.log');
});

test('a helper-owned deck recorded standalone refuses and points at the shim log', () => {
  const mode = deployMode(true, {}, { runMode: 'standalone' });
  expect(mode.kind).toBe('refuse');
  expect(mode.kind === 'refuse' && mode.message).toContain('deck.err.log');
});

test('linkedCheckoutMismatch: null when the linked checkout is this one', () => {
  const thisDir = tmpCheckoutDir('deck-this-');
  expect(linkedCheckoutMismatch(thisDir, thisDir)).toBeNull();
});

test('linkedCheckoutMismatch: names the linked dir on mismatch', () => {
  const thisDir = tmpCheckoutDir('deck-this-');
  const linkedDir = tmpCheckoutDir('deck-linked-');
  const message = linkedCheckoutMismatch(thisDir, linkedDir);
  expect(message).toContain(linkedDir);
  expect(message).toContain(thisDir);
  expect(message).toContain('deck register --dir');
});

test('linkedCheckoutMismatch: names "no linked checkout" when missing', () => {
  const thisDir = tmpCheckoutDir('deck-this-');
  expect(linkedCheckoutMismatch(thisDir, undefined)).toContain(
    'no linked checkout'
  );
  expect(linkedCheckoutMismatch(thisDir, null)).toContain('no linked checkout');
});

test('linkedCheckoutMismatch: refuses a relative dev.workingDirectory', () => {
  const thisDir = tmpCheckoutDir('deck-this-');
  const message = linkedCheckoutMismatch(thisDir, './relative/checkout');
  expect(message).toContain('./relative/checkout');
});

test('restartHealthzVerdict: a matching pid running source', () => {
  const headers = new Headers({
    'x-deck-pid': '4242',
    'x-deck-run-mode': 'source',
  });
  expect(restartHealthzVerdict(headers, 4242)).toEqual({
    kind: 'match',
    runMode: 'source',
  });
});

test('restartHealthzVerdict: a matching pid running the pinned fallback', () => {
  const headers = new Headers({
    'x-deck-pid': '4242',
    'x-deck-run-mode': 'standalone',
  });
  expect(restartHealthzVerdict(headers, 4242)).toEqual({
    kind: 'match',
    runMode: 'standalone',
  });
});

test('restartHealthzVerdict: no x-deck-pid header at all (deck 1.0.6 predates it)', () => {
  const headers = new Headers({});
  expect(restartHealthzVerdict(headers, 4242)).toEqual({
    kind: 'no-pid-header',
  });
});

test('restartHealthzVerdict: a pid header naming a different process', () => {
  const headers = new Headers({ 'x-deck-pid': '9999' });
  expect(restartHealthzVerdict(headers, 4242)).toEqual({
    kind: 'pid-mismatch',
  });
});
