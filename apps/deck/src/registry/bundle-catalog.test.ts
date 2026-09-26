import { createHash } from 'crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { expect, test } from 'bun:test';

import { parseServeCatalog, readBundleCatalog } from './bundle-catalog.ts';

// Parity anchor: byte-identical twin at repo-tools
// scripts/lib/__tests__/fixtures/deps-lock-serve.fixture.json, whose test pins
// the same digest and asserts repo-tools' parser derives expectedCatalog.
// Change both files together and move the digest in both tests.
const FIXTURE_SHA256 =
  '95256df5809898010329ed5c0c331c806a4ba8ad9e860768c1b130a604b14230';

type LockRow = Record<string, unknown>;

interface Fixture {
  lock: { tools: LockRow[] };
  expectedCatalog: Array<{ name: string; port: number; args: string[] }>;
}

const BYTES = readFileSync(
  join(import.meta.dir, '__fixtures__', 'deps-lock-serve.fixture.json')
);
const fixture = JSON.parse(BYTES.toString('utf8')) as Fixture;
const LOCK = JSON.stringify(fixture.lock);
const EXPECTED = Object.fromEntries(
  fixture.expectedCatalog.map(({ name, ...v }) => [name, v])
);

function lockCopy(): Fixture['lock'] {
  return structuredClone(fixture.lock);
}

function row(lock: Fixture['lock'], name: string): LockRow {
  const found = lock.tools.find(t => t.name === name);
  if (!found) throw new Error(`fixture has no ${name} row`);
  return found;
}

function resources(lock: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), 'resources-'));
  if (lock !== null) writeFileSync(join(dir, 'deps.lock'), lock);
  return dir;
}

test('the fixture bytes match the digest its repo-tools twin pins', () => {
  expect(createHash('sha256').update(BYTES).digest('hex')).toBe(FIXTURE_SHA256);
});

test('the shared fixture parses to the catalog repo-tools derives from it', () => {
  expect(Object.fromEntries(parseServeCatalog(LOCK))).toEqual(EXPECTED);
});

test('readBundleCatalog reads Resources/deps.lock', () => {
  expect(Object.fromEntries(readBundleCatalog(resources(LOCK))!)).toEqual(
    EXPECTED
  );
});

test('no catalog outside a bundle, without a lock, with a broken lock, or with no served rows', () => {
  expect(readBundleCatalog(null)).toBeNull();
  expect(readBundleCatalog(resources(null))).toBeNull();
  expect(readBundleCatalog(resources('{not json'))).toBeNull();
  const unserved = lockCopy();
  for (const t of unserved.tools) delete t.serve;
  expect(readBundleCatalog(resources(JSON.stringify(unserved)))).toBeNull();
});

test('pending and buildtool rows never serve, even carrying serve', () => {
  const lock = lockCopy();
  row(lock, 'chat').status = 'pending';
  row(lock, 'sparkle').serve = { port: 11098, args: [] };
  const catalog = parseServeCatalog(JSON.stringify(lock));
  expect(catalog.has('chat')).toBe(false);
  expect(catalog.has('sparkle')).toBe(false);
  expect(catalog.has('boxscore')).toBe(false);
  expect(catalog.has('board')).toBe(true);
});

test('a malformed serve on a served row is rejected, not guessed', () => {
  const bad: unknown[] = [
    { port: '11006', args: [] },
    { port: 11006.5, args: [] },
    { port: 70000, args: [] },
    { port: 11006, args: 'serve' },
    { port: 11006, args: [1] },
    null,
  ];
  for (const serve of bad) {
    const lock = lockCopy();
    row(lock, 'board').serve = serve;
    expect(() => parseServeCatalog(JSON.stringify(lock))).toThrow(
      /board serve/
    );
  }
});
