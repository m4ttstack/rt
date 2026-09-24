import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, expect, test } from 'bun:test';

import { bundleHelpersDir, bundleRootFromExec } from './bundle-layout.ts';

// macOS's /tmp is itself a symlink (-> /private/tmp); bundleRootFromExec
// realpath-resolves execPath, so expectations must be built on the same
// resolved base or every assertion below mismatches on the /private/ prefix.
const TMPDIR = realpathSync(tmpdir());

const dirs: string[] = [];
function tmpApp(): { appRoot: string; exec: string } {
  const dir = mkdtempSync(join(TMPDIR, 'bundle-layout-'));
  dirs.push(dir);
  const appRoot = join(dir, 'mattstack.app');
  const contents = join(appRoot, 'Contents');
  const helpers = join(contents, 'Helpers');
  mkdirSync(helpers, { recursive: true });
  writeFileSync(join(contents, 'Info.plist'), '');
  const exec = join(helpers, 'deck');
  writeFileSync(exec, '');
  return { appRoot, exec };
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

test('resolves the .app root from a Contents/Helpers/<name> execPath', () => {
  const { appRoot, exec } = tmpApp();
  expect(bundleRootFromExec(exec)).toBe(appRoot);
});

test('resolves through a symlink to the real Helpers-relative execPath', () => {
  const { appRoot, exec } = tmpApp();
  const dir = mkdtempSync(join(TMPDIR, 'bundle-layout-link-'));
  dirs.push(dir);
  const link = join(dir, 'deck-link');
  symlinkSync(exec, link);
  expect(bundleRootFromExec(link)).toBe(appRoot);
});

test("resolves the .app root from a Contents/MacOS/<name> execPath too (rt's own layout)", () => {
  const dir = mkdtempSync(join(TMPDIR, 'bundle-layout-macos-'));
  dirs.push(dir);
  const appRoot = join(dir, 'mattstack.app');
  const contents = join(appRoot, 'Contents');
  const macos = join(contents, 'MacOS');
  mkdirSync(macos, { recursive: true });
  writeFileSync(join(contents, 'Info.plist'), '');
  const exec = join(macos, 'rt');
  writeFileSync(exec, '');
  expect(bundleRootFromExec(exec)).toBe(appRoot);
});

test('returns null for a dev-checkout execPath (no Contents/Helpers or Contents/MacOS ancestry)', () => {
  const dir = mkdtempSync(join(TMPDIR, 'bundle-layout-checkout-'));
  dirs.push(dir);
  const exec = join(dir, 'bun');
  writeFileSync(exec, '');
  expect(bundleRootFromExec(exec)).toBeNull();
});

test('returns null when the parent dir looks right but Info.plist is missing (not a real bundle)', () => {
  const dir = mkdtempSync(join(TMPDIR, 'bundle-layout-noplist-'));
  dirs.push(dir);
  const helpers = join(dir, 'notanapp.app', 'Contents', 'Helpers');
  mkdirSync(helpers, { recursive: true });
  const exec = join(helpers, 'deck');
  writeFileSync(exec, '');
  expect(bundleRootFromExec(exec)).toBeNull();
});

test('returns null for a nonexistent execPath', () => {
  expect(bundleRootFromExec('/no/such/binary')).toBeNull();
});

test('bundleHelpersDir joins the resolved root with Contents/Helpers', () => {
  const { appRoot, exec } = tmpApp();
  expect(bundleHelpersDir(exec)).toBe(join(appRoot, 'Contents', 'Helpers'));
});

test('bundleHelpersDir returns null outside a bundle', () => {
  expect(bundleHelpersDir('/no/such/binary')).toBeNull();
});

test('an unargumented call honors a valid DECK_BUNDLE_ROOT', () => {
  const { appRoot } = tmpApp();
  const prev = process.env.DECK_BUNDLE_ROOT;
  process.env.DECK_BUNDLE_ROOT = appRoot;
  try {
    expect(bundleRootFromExec()).toBe(appRoot);
    expect(bundleHelpersDir()).toBe(join(appRoot, 'Contents', 'Helpers'));
  } finally {
    if (prev === undefined) delete process.env.DECK_BUNDLE_ROOT;
    else process.env.DECK_BUNDLE_ROOT = prev;
  }
});

test('an invalid DECK_BUNDLE_ROOT is ignored', () => {
  const { appRoot } = tmpApp();
  const prev = process.env.DECK_BUNDLE_ROOT;
  try {
    for (const bad of [
      'relative/mattstack.app',
      join(TMPDIR, 'not-a-bundle'),
      join(TMPDIR, 'missing.app'),
    ]) {
      process.env.DECK_BUNDLE_ROOT = bad;
      expect(bundleRootFromExec()).not.toBe(bad);
    }
    process.env.DECK_BUNDLE_ROOT = join(appRoot, 'Contents');
    expect(bundleRootFromExec()).not.toBe(join(appRoot, 'Contents'));
  } finally {
    if (prev === undefined) delete process.env.DECK_BUNDLE_ROOT;
    else process.env.DECK_BUNDLE_ROOT = prev;
  }
});

test('an explicit execPath ignores DECK_BUNDLE_ROOT', () => {
  const a = tmpApp();
  const b = tmpApp();
  const prev = process.env.DECK_BUNDLE_ROOT;
  process.env.DECK_BUNDLE_ROOT = a.appRoot;
  try {
    expect(bundleRootFromExec(b.exec)).toBe(b.appRoot);
    expect(bundleRootFromExec(join(TMPDIR, 'nowhere', 'deck'))).toBeNull();
  } finally {
    if (prev === undefined) delete process.env.DECK_BUNDLE_ROOT;
    else process.env.DECK_BUNDLE_ROOT = prev;
  }
});
