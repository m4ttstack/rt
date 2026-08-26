import { readFileSync } from 'node:fs';
import path from 'node:path';

// Guards against exactly the drift the header comments warn about: the
// pre-bundle loading bar's CSS exists in two copies -- the load-bearing
// inline `<style>` block in `index.html` (the only one actually served
// before any bundler-owned CSS or JS exists) and the reviewable, lintable
// reference copy in `simple-loading-bar.css`. Historically the only thing
// keeping them identical was a comment asking humans to remember. This test
// reads both files directly off disk and fails the moment the rules
// between their `BEGIN/END SYNCED RULES` markers diverge, so drift is
// caught by `bun run test`, not by someone noticing in review.
const BEGIN_MARKER = 'BEGIN SYNCED RULES';
const END_MARKER = 'END SYNCED RULES';

// vitest (per vite.config.ts) runs with the repo root as cwd, so these
// paths are stable regardless of which file imports/runs this test from.
const INDEX_HTML_PATH = path.resolve(process.cwd(), 'index.html');
const CSS_PATH = path.resolve(process.cwd(), 'src/boot/simple-loading-bar.css');

function normalize(css: string): string {
  return css.replace(/\s+/g, ' ').trim();
}

function extractBetweenMarkers(source: string, filePath: string): string {
  const beginIndex = source.indexOf(BEGIN_MARKER);
  const endIndex = source.indexOf(END_MARKER);

  if (beginIndex === -1 || endIndex === -1 || endIndex < beginIndex) {
    throw new Error(
      `Expected to find both "${BEGIN_MARKER}" and "${END_MARKER}" markers in ${filePath}, but did not.`
    );
  }

  // Start after the BEGIN marker's own comment line, end right before the
  // END marker's comment starts, so neither marker's own comment text (which
  // legitimately differs between the two files -- one points at the other)
  // is included in the compared content.
  const afterBeginLineEnd = source.indexOf('\n', beginIndex);
  const endMarkerLineStart = source.lastIndexOf('\n', endIndex);

  if (
    afterBeginLineEnd === -1 ||
    endMarkerLineStart === -1 ||
    endMarkerLineStart <= afterBeginLineEnd
  ) {
    throw new Error(
      `Could not extract synced-rules region between markers in ${filePath}.`
    );
  }

  return source.slice(afterBeginLineEnd + 1, endMarkerLineStart);
}

test('index.html inline loading-bar styles stay in sync with src/boot/simple-loading-bar.css', () => {
  const htmlSource = readFileSync(INDEX_HTML_PATH, 'utf-8');
  const cssSource = readFileSync(CSS_PATH, 'utf-8');

  const htmlRules = extractBetweenMarkers(htmlSource, INDEX_HTML_PATH);
  const cssRules = extractBetweenMarkers(cssSource, CSS_PATH);

  expect(normalize(htmlRules)).toBe(normalize(cssRules));
});
