import { createHash } from 'crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { afterEach, expect, test } from 'bun:test';

import {
  effectiveIdentity,
  readBundledIdentity,
  setBundledResourcesDir,
  statusIconUrl,
} from './bundled-identity.ts';
import { iconPathFor } from './manifest.ts';
import type { AppRecord } from './records.ts';

// Parity anchor: byte-identical twin at repo-tools
// scripts/lib/__tests__/fixtures/bundle-resources/, the form its stageIdentity
// writes for board. Change both copies together and move these digests in
// both repos' tests.
const FIXTURE_SHA256 = {
  'mattstack.deck.json':
    '50f5e9e8ac66f05befbe8d819f8d2a8d23c1d190e39fb5d505d2aa199f668523',
  'src/favicon.svg':
    '1226b22e369865eaf8b319d5aba863a7c531f313552cf47b4f0dbcec6d199142',
};
const FIXTURE_RESOURCES = join(
  import.meta.dir,
  '__fixtures__',
  'bundle-resources'
);
const BOARD_ICON = join(
  FIXTURE_RESOURCES,
  'apps',
  'board',
  'src',
  'favicon.svg'
);

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16"/></svg>';

function resources(
  name: string,
  manifest: object,
  files: Record<string, string>
): string {
  const root = mkdtempSync(join(tmpdir(), 'bundle-resources-'));
  const dir = join(root, 'apps', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'mattstack.deck.json'), JSON.stringify(manifest));
  for (const [rel, body] of Object.entries(files)) {
    const p = join(dir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
  return root;
}

test('the fixture bytes match the digests its repo-tools twin pins', () => {
  const board = join(FIXTURE_RESOURCES, 'apps', 'board');
  for (const [rel, digest] of Object.entries(FIXTURE_SHA256))
    expect(
      createHash('sha256')
        .update(readFileSync(join(board, rel)))
        .digest('hex')
    ).toBe(digest);
});

test('reads the staged identity bundle-apps ships', () => {
  expect(readBundledIdentity(FIXTURE_RESOURCES, 'board')).toEqual({
    displayName: 'Board',
    description: 'Open MRs ready for review.',
    badge: '/api/badge',
    iconFile: BOARD_ICON,
  });
});

test('an app with no identity dir has none', () => {
  expect(readBundledIdentity(FIXTURE_RESOURCES, 'chat')).toBeNull();
});

test('a manifest naming a different app is ignored', () => {
  const root = resources(
    'board',
    { name: 'chat', displayName: 'Chat', icon: './i.svg' },
    { 'i.svg': SVG }
  );
  expect(readBundledIdentity(root, 'board')).toBeNull();
});

test('a manifest without displayName or icon is no identity', () => {
  const noName = resources(
    'board',
    { name: 'board', icon: './i.svg' },
    { 'i.svg': SVG }
  );
  expect(readBundledIdentity(noName, 'board')).toBeNull();
  const noIcon = resources(
    'board',
    { name: 'board', displayName: 'Board' },
    { 'i.svg': SVG }
  );
  expect(readBundledIdentity(noIcon, 'board')).toBeNull();
});

test('an icon path that escapes the identity dir is refused', () => {
  const up = resources(
    'board',
    { name: 'board', displayName: 'Board', icon: '../../escape.svg' },
    { '../../escape.svg': SVG }
  );
  expect(readBundledIdentity(up, 'board')).toBeNull();
  const abs = resources(
    'board',
    { name: 'board', displayName: 'Board', icon: join(up, 'escape.svg') },
    {}
  );
  expect(readBundledIdentity(abs, 'board')).toBeNull();
});

test('an oversize or non-svg bundled icon yields no identity', () => {
  const big = resources(
    'board',
    { name: 'board', displayName: 'Board', icon: './i.svg' },
    { 'i.svg': `<svg>${' '.repeat(64 * 1024)}</svg>` }
  );
  expect(readBundledIdentity(big, 'board')).toBeNull();
  const png = resources(
    'board',
    { name: 'board', displayName: 'Board', icon: './i.svg' },
    { 'i.svg': 'PNG' }
  );
  expect(readBundledIdentity(png, 'board')).toBeNull();
});

function record(over: Partial<AppRecord> = {}): AppRecord {
  return {
    name: 'board',
    managedBy: 'rt',
    port: 11006,
    kind: 'service',
    createdAt: '2026-09-24T00:00:00Z',
    ...over,
  };
}

afterEach(() => setBundledResourcesDir(undefined));

test('an unlinked managed row takes its identity from the bundle', () => {
  expect(effectiveIdentity(record(), FIXTURE_RESOURCES)).toEqual({
    displayName: 'Board',
    description: 'Open MRs ready for review.',
    badge: '/api/badge',
    iconFile: BOARD_ICON,
  });
});

test('bundled identity replaces a stale stored identity on an unlinked row', () => {
  const id = effectiveIdentity(
    record({ displayName: 'Old', icon: { ext: 'svg' } }),
    FIXTURE_RESOURCES
  );
  expect(id.displayName).toBe('Board');
  expect(id.iconFile).toBe(BOARD_ICON);
});

test('a linked row with an ingested identity keeps it', () => {
  const id = effectiveIdentity(
    record({
      dev: { workingDirectory: '/src/board' },
      displayName: 'Board (source)',
      icon: { ext: 'svg' },
    }),
    FIXTURE_RESOURCES
  );
  expect(id.displayName).toBe('Board (source)');
  expect(id.iconFile).toBe(iconPathFor('board'));
});

test('a linked row that never ingested an identity falls back to the bundle', () => {
  const id = effectiveIdentity(
    record({ dev: { workingDirectory: '/src/board' } }),
    FIXTURE_RESOURCES
  );
  expect(id.displayName).toBe('Board');
});

test('user and platform rows never read the bundle', () => {
  expect(
    effectiveIdentity(record({ managedBy: 'user' }), FIXTURE_RESOURCES)
  ).toEqual({ displayName: 'board', iconFile: null });
  expect(
    effectiveIdentity(record({ managedBy: 'deck' }), FIXTURE_RESOURCES)
  ).toEqual({ displayName: 'board', iconFile: null });
});

test('outside a bundle the stored fields are the identity', () => {
  expect(effectiveIdentity(record(), null)).toEqual({
    displayName: 'board',
    iconFile: null,
  });
});

test('statusIconUrl follows the effective identity through the seam', () => {
  setBundledResourcesDir(FIXTURE_RESOURCES);
  expect(statusIconUrl(record())).toBe('/api/apps/board/icon');
  expect(statusIconUrl(record({ managedBy: 'deck' }))).toBe('/favicon.svg');
  setBundledResourcesDir(null);
  expect(statusIconUrl(record())).toBeNull();
});
