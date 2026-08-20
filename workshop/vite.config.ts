import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Ported from soribashi's apps/workshop/vite.config.ts, with one addition:
 * `@mattstack/tui-kit` resolves straight to the live `../src` tree, never to
 * an installed copy of the kit. There is no `file:` self-dependency in
 * workshop/package.json for that reason — a published-package round trip
 * would only ever show yesterday's kit, and this workshop exists to preview
 * today's.
 *
 * Vite's alias matching (via @rollup/plugin-alias under the hood) treats a
 * string key as a PREFIX: it matches the bare specifier itself and anything
 * under `<key>/...`, so `@mattstack/tui-kit/theme` resolves through here too
 * (to `../src/theme.ts`) without a second alias entry. That trick only holds
 * for subpaths that mirror `src/`'s own layout, though — the two generated
 * CSS files (`src/generated/theme.css`, `src/canvas.css`) do NOT match their
 * package.json export names 1:1 (`./theme.css` -> `./src/generated/theme.css`
 * is a renamed, nested path, not a subpath echo), so main.tsx imports those
 * two by plain relative path instead of through this alias.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@mattstack/tui-kit": path.resolve(import.meta.dirname, "../src"),
    },
  },
});
