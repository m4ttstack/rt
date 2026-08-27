import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BEGIN_MARKER = 'BEGIN SYNCED RULES';
const END_MARKER = 'END SYNCED RULES';

// Built from fileURLToPath, not `new URL(path, import.meta.url)`: Vite's
// asset-import-meta-url rewrite mangles that idiom under the jsdom env.
const STYLESHEET = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../boot/simple-loading-bar.css'
);

function normalize(css: string): string {
  return css.replace(/\s+/g, ' ').trim();
}

function extractBetweenMarkers(source: string, label: string): string {
  const beginIndex = source.indexOf(BEGIN_MARKER);
  const endIndex = source.indexOf(END_MARKER);
  if (beginIndex === -1 || endIndex === -1 || endIndex < beginIndex) {
    throw new Error(
      `Expected both "${BEGIN_MARKER}" and "${END_MARKER}" markers in ${label}.`
    );
  }
  const afterBeginLine = source.indexOf('\n', beginIndex);
  const endLineStart = source.lastIndexOf('\n', endIndex);
  if (afterBeginLine === -1 || endLineStart <= afterBeginLine) {
    throw new Error(`Could not extract the synced-rules region from ${label}.`);
  }
  return source.slice(afterBeginLine + 1, endLineStart);
}

/**
 * The pre-bundle loading bar's CSS exists twice by necessity: inlined in the
 * app's index.html (the only copy that paints before any bundle loads) and
 * as the package's stylesheet. Reads the stylesheet off disk so the package
 * copy is the one source, and throws when the app's inline block drifts.
 */
export function expectLoadingBarInSync(indexHtml: string): void {
  const css = readFileSync(STYLESHEET, 'utf-8');
  const expected = normalize(
    extractBetweenMarkers(css, 'simple-loading-bar.css')
  );
  const actual = normalize(extractBetweenMarkers(indexHtml, 'index.html'));
  if (expected !== actual) {
    throw new Error(
      'index.html loading-bar styles drift from @mattstack/app-kit/boot/simple-loading-bar.css; copy the block between the SYNCED RULES markers.'
    );
  }
}
