import { defineConfig } from 'vite';

import { mattstackVite } from '@mattstack/app-kit/vite';

const base = mattstackVite({ apiPort: 11005 });

export default defineConfig({
  ...base,
  optimizeDeps: {
    ...base.optimizeDeps,
    include: [
      ...(base.optimizeDeps?.include ?? []),
      // @mattstack/app-kit's router/useHash.ts statically imports this
      // wouter subpath, but app-kit itself sits in the preset's
      // optimizeDeps.exclude, so Vite's scanner never crawls into its
      // source to discover the specifier and serves it unbundled. Its
      // raw use-sync-external-store/shim CJS re-export has no named ESM
      // export Vite 8's dep pre-bundler can read, which crashes `bun run
      // dev` on first load. console/chat don't hit this only because
      // their own app source happens to import this same subpath
      // directly (for wouter's navigate()), incidentally pre-bundling
      // it; boxscore has no such direct import, so it needs listing here.
      'wouter/use-browser-location',
    ],
  },
});
