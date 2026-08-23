// @vitest-environment node
//
// Only the absent-manifest branch is covered here -- which is also the only
// state `bun run test` ever actually runs in (the generated module is
// gitignored and nothing in this repo's test/lint/typecheck pipeline
// generates it). The present-manifest branch is real-runtime-only: Vite's
// module runner caches a *failed* dynamic-import resolution and won't
// re-stat the filesystem for the same specifier within one process, so a
// test that writes the fixture mid-run after this test's import already
// failed keeps replaying that cached failure -- it would be pinning Vite's
// loader behavior, not this code's. The present branch is proven instead by
// actually running the server: `bun run generate:embedded` then `bun run
// serve` serves the embedded assets (manually verified), and the compiled
// binary does the same with `dist/` deleted (see
// .superpowers/compile-binary-report.md).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { loadEmbeddedManifest } from './manifest-loader';

describe('loadEmbeddedManifest', () => {
  it('resolves to null when no codegen has run (the checked-out, dev/serve state)', async () => {
    expect(
      existsSync(join(import.meta.dirname, 'generated', 'manifest.ts'))
    ).toBe(false);

    await expect(loadEmbeddedManifest()).resolves.toBeNull();
  });
});
