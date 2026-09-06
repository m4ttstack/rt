import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const FETCH_PIPELINE_DIRS = [
  'src/server/linear',
  'src/server/source',
  'src/server/store',
  'src/server/refresh',
];

// Matches both static `from "../metrics/x.js"` and dynamic `import("../metrics/x.js")`,
// one or two levels up, with or without a leading server/ segment.
const METRICS_IMPORT = /["']\.\.\/(\.\.\/)?(server\/)?metrics\//;

/**
 * Ratchet: the data-producing directories in FETCH_PIPELINE_DIRS feed the metrics layer
 * and never import from it, so metrics stays swappable for an external data source.
 * src/server/bots.ts is a settings-side helper outside the ratchet.
 */
describe('layering', () => {
  it('the fetch pipeline never imports server/metrics', () => {
    for (const dir of FETCH_PIPELINE_DIRS) {
      for (const file of readdirSync(dir)) {
        if (!file.endsWith('.ts')) continue;
        const src = readFileSync(`${dir}/${file}`, 'utf8');
        expect(src, `${dir}/${file}`).not.toMatch(METRICS_IMPORT);
      }
    }
  });
});
