// @vitest-environment node
// Under the package's default jsdom environment, Vite's client asset
// transform rewrites the `new URL(literal, import.meta.url)` calls below
// into browser asset URLs (`import.meta.url` becomes `self.location`),
// which breaks `readFileSync`. This check is pure Node/string logic with
// no DOM dependency, so it opts into the node environment instead.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

import { expectLoadingBarInSync } from './loading-bar';

const css = readFileSync(
  new URL('../boot/simple-loading-bar.css', import.meta.url),
  'utf-8'
);

function htmlWith(block: string): string {
  return `<html><head><style>\n/* BEGIN SYNCED RULES: x */\n${block}\n/* END SYNCED RULES */\n</style></head></html>`;
}

function syncedBlock(): string {
  const begin = css.indexOf('\n', css.indexOf('BEGIN SYNCED RULES')) + 1;
  const end = css.lastIndexOf('\n', css.indexOf('END SYNCED RULES'));
  return css.slice(begin, end);
}

test('passes when index.html carries the stylesheet block', () => {
  expect(() => expectLoadingBarInSync(htmlWith(syncedBlock()))).not.toThrow();
});

test('ignores whitespace differences', () => {
  const reindented = syncedBlock().replace(/\n\s+/g, '\n');
  expect(() => expectLoadingBarInSync(htmlWith(reindented))).not.toThrow();
});

test('fails when a rule drifted', () => {
  const drifted = syncedBlock().replace('height: 3px', 'height: 4px');
  expect(() => expectLoadingBarInSync(htmlWith(drifted))).toThrow(/drift/);
});

test('fails when index.html has no markers', () => {
  expect(() => expectLoadingBarInSync('<html></html>')).toThrow(
    /BEGIN SYNCED RULES/
  );
});
