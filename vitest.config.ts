import { defineConfig } from "vitest/config";

// Separate from vite.config.ts (which is rooted at web/) so tests resolve from repo root.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
