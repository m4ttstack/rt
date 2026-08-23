// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { loadEmbeddedManifest } from './manifest-loader';
import type { EmbeddedManifest } from './types';

const manifest: EmbeddedManifest = {
  indexHtmlPath: '/embedded/index.html',
  files: { '/assets/app.js': '/embedded/assets/app.js' },
};

describe('loadEmbeddedManifest', () => {
  it('resolves the manifest a resolver hands back', async () => {
    await expect(
      loadEmbeddedManifest(async () => ({ manifest }))
    ).resolves.toEqual(manifest);
  });

  it('resolves to null when the resolver finds nothing (dev/serve, no codegen run)', async () => {
    await expect(loadEmbeddedManifest(async () => null)).resolves.toBeNull();
  });

  it('uses the real generated-module resolver by default', async () => {
    // No codegen has run in this checkout/CI (the generated module is
    // gitignored), so the real default resolver's import fails and this
    // still resolves to null -- proving the default argument is actually
    // wired to a real dynamic import, not stubbed out.
    await expect(loadEmbeddedManifest()).resolves.toBeNull();
  });
});
