import { defineConfig } from "vitest/config";

/**
 * Node tier. Ported from soribashi's packages/ui/vitest.config.ts (`ui-logic`).
 *
 * `src/**\/*.test.ts` (non-`.tsx`) picks up pure-logic node-tier tests
 * colocated with a recipe or a hook module: no browser needed, so they belong
 * here rather than in the browser tier's `.tsx`-only glob, which would never
 * match a `.ts` file anyway.
 *
 * `root` is anchored to this file's directory for the same reason
 * vitest.browser.config.ts anchors its own: Vite's default `root` is the
 * process cwd, so a `--config` invocation from anywhere else would resolve
 * `include` against the wrong directory and silently match zero files.
 */
export default defineConfig({
  root: import.meta.dirname,
  test: {
    name: "node",
    environment: "node",
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
  },
});
