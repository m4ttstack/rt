import type { EmbeddedManifest } from './types';

/**
 * `./generated/manifest` exists only after `scripts/generate-embedded-assets.ts`
 * has run (the `build:binary` script's first step, right after `vite build`) --
 * never in `dev` or `serve`, and the path is gitignored so a fresh checkout
 * never has it either. This is how the server picks its serving mode: no env
 * var, just "did the generated manifest load."
 *
 * The `as string` cast keeps the specifier out of TypeScript's static module
 * resolution -- a bare literal fails `tsc -b` whenever the generated file is
 * absent -- while leaving the emitted JS a bare string-literal `import(...)`
 * call, which is what `bun build --compile` scans for to embed the target
 * module (and, transitively, the `dist/` files it imports with
 * `{ type: 'file' }`) into the compiled binary.
 */
export async function loadEmbeddedManifest(): Promise<EmbeddedManifest | null> {
  try {
    const mod = (await import('./generated/manifest' as string)) as {
      manifest: EmbeddedManifest;
    };
    return mod.manifest;
  } catch {
    return null;
  }
}
