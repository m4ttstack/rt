import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { expect, test } from 'bun:test';

import { isDevBundle } from './dev-mode.ts';

function bundle(devBuild: string | null): string {
  const root = join(mkdtempSync(join(tmpdir(), 'devbundle-')), 'mattstack.app');
  mkdirSync(join(root, 'Contents'), { recursive: true });
  const key =
    devBuild === null ? '' : `\t<key>MSDevBuild</key>\n\t${devBuild}\n`;
  writeFileSync(
    join(root, 'Contents', 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n\t<key>CFBundleIdentifier</key>\n\t<string>com.mattstack.app</string>\n${key}</dict>\n</plist>\n`
  );
  return root;
}

test('dev when the bundle is stamped MSDevBuild true', () => {
  expect(isDevBundle(bundle('<true/>'))).toBe(true);
});

test('prod when the bundle is stamped MSDevBuild false', () => {
  expect(isDevBundle(bundle('<false/>'))).toBe(false);
});

test('prod when the bundle carries no MSDevBuild key', () => {
  expect(isDevBundle(bundle(null))).toBe(false);
});

test('prod outside any bundle (a bare source run)', () => {
  expect(isDevBundle(null)).toBe(false);
});

test('the dev shim run (bun src/main.ts serve with DECK_BUNDLE_ROOT) reads as the dev bundle', () => {
  const prev = process.env.DECK_BUNDLE_ROOT;
  process.env.DECK_BUNDLE_ROOT = bundle('<true/>');
  try {
    expect(isDevBundle()).toBe(true);
  } finally {
    if (prev === undefined) delete process.env.DECK_BUNDLE_ROOT;
    else process.env.DECK_BUNDLE_ROOT = prev;
  }
});

test('prod when Info.plist cannot be read', () => {
  expect(isDevBundle(join(tmpdir(), 'no-such', 'mattstack.app'))).toBe(false);
});
