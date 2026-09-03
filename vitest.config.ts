import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Separate from vite.config.ts (which serves the client app) so tests resolve from repo root.
//
// Two projects, not one shared config: the 236 server tests need the real filesystem
// (environment: "node") and must keep running under `bun --bun`, while the component tests
// need jsdom + the app-kit/Mantine test harness. `test.projects` (vitest 4's replacement for
// the removed `environmentMatchGlobs`) keeps that split per-directory instead of flipping the
// whole suite to jsdom.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src/app", import.meta.url)) },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "server",
          include: ["test/**/*.test.ts"],
          environment: "node",
          // Points the store at a test-only file so a run never touches the developer's real one.
          env: { BOXSCORE_DB: ".cache-test/test.sqlite" },
        },
      },
      {
        extends: true,
        test: {
          name: "component",
          include: ["src/app/**/*.test.tsx"],
          environment: "jsdom",
          setupFiles: ["./src/app/test-setup.ts"],
        },
      },
    ],
  },
});
