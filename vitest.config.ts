import { defineConfig } from "vitest/config";

// Separate from vite.config.ts (which is rooted at web/) so tests resolve from repo root.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Tests derive their scope from the same config the server uses, so warming "the
    // current base window" produces the byte-identical key the running server wrote.
    // Without a separate directory, a test run overwrites and then deletes the live cache.
    env: { BOXSCORE_CACHE_DIR: ".cache-test", BOXSCORE_DB: ".cache-test/test.sqlite" },
  },
});
