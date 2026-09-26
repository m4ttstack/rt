// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { loadEmbeddedManifest } from './manifest-loader';
import type { EmbeddedManifest } from './types';

const manifest: EmbeddedManifest = {
  indexHtmlPath: '/embedded/index.html',
  files: { '/assets/app.js': '/embedded/assets/app.js' },
};

describe('loadEmbeddedManifest', () => {
  it('resolves to null when no resolver is given (disk mode)', async () => {
    await expect(loadEmbeddedManifest(undefined)).resolves.toBeNull();
  });

  it('resolves the manifest a resolver hands back', async () => {
    await expect(
      loadEmbeddedManifest(async () => ({ manifest }))
    ).resolves.toEqual(manifest);
  });

  it('resolves to null when the resolver finds nothing (dev/serve, no codegen run)', async () => {
    await expect(loadEmbeddedManifest(async () => null)).resolves.toBeNull();
  });

  it('resolves to null when the resolver throws', async () => {
    await expect(
      loadEmbeddedManifest(async () => {
        throw new Error('boom');
      })
    ).resolves.toBeNull();
  });
});
