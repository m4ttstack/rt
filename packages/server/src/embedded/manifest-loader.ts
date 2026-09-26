import type { EmbeddedManifest } from './types';

export type EmbeddedManifestModule = { manifest: EmbeddedManifest };

/**
 * `resolve` is the app's own `() => import('./embedded/manifest' as string)`,
 * which exists only after `mattstack-embed-assets` ran. Null means disk mode.
 */
export async function loadEmbeddedManifest(
  resolve: (() => Promise<EmbeddedManifestModule | null>) | undefined
): Promise<EmbeddedManifest | null> {
  if (!resolve) return null;
  try {
    const mod = await resolve();
    return mod?.manifest ?? null;
  } catch {
    return null;
  }
}
