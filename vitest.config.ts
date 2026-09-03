import { defineConfig } from "vitest/config";

// Separate from vite.config.ts (which serves the client app) so tests resolve from repo root.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Points the store at a test-only file so a run never touches the developer's real one.
    env: { BOXSCORE_DB: ".cache-test/test.sqlite" },
  },
});
