import type { EmbeddedManifest } from './types';

type GeneratedManifestModule = { manifest: EmbeddedManifest };

/**
 * `./generated/manifest` exists only after `scripts/generate-embedded-assets.ts`
 * has run (the `build:binary` script's first step, right after `vite build`) --
 * never in `dev` or `serve`, and the path is gitignored so a fresh checkout
 * never has it either.
 *
 * The `as string` cast keeps the specifier out of TypeScript's static module
 * resolution -- a bare literal fails `tsc -b` whenever the generated file is
 * absent -- while leaving the emitted JS a bare string-literal `import(...)`
 * call, which is what `bun build --compile` scans for to embed the target
 * module (and, transitively, the `dist/` files it imports with
 * `{ type: 'file' }`) into the compiled binary. Kept as the default resolver
 * (rather than inlined in `loadEmbeddedManifest`) so tests can substitute a
 * fake and cover both branches without writing to this real, gitignored path
 * -- Vite's module runner caches a *failed* resolution of this exact
 * specifier and won't re-stat disk for it later in the same process, so a
 * test relying on the real file appearing mid-run is unreliable.
 */
async function importGeneratedManifest(): Promise<GeneratedManifestModule | null> {
  try {
    return (await import(
      './generated/manifest' as string
    )) as GeneratedManifestModule;
  } catch {
    return null;
  }
}

/**
 * This resolves-or-null result is how the server picks its serving mode: no
 * env var, just "did the generated manifest load" (see `serving-mode.ts`).
 */
export async function loadEmbeddedManifest(
  resolve: () => Promise<GeneratedManifestModule | null> = importGeneratedManifest
): Promise<EmbeddedManifest | null> {
  const mod = await resolve();
  return mod?.manifest ?? null;
}
