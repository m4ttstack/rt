import { describe, it, expect } from "bun:test";
import { execSync } from "child_process";
import { rt, createTestHome } from "../harness.ts";

describe("rt glitter", () => {
  it("gates a plain non-TTY spawn at the tree level", async () => {
    const { path: home, cleanup } = createTestHome();
    try {
      const result = await rt(["glitter"], { home });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("rt glitter requires an interactive terminal");
    } finally {
      cleanup();
    }
  });

  it("gates a non-TTY spawn under RT_BATCH at the handler level", async () => {
    const { path: home, cleanup } = createTestHome();
    try {
      execSync("git init", { cwd: home, stdio: "pipe" });
      const result = await rt(["glitter"], { home, env: { RT_BATCH: "1" } });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(
        "rt glitter needs an interactive terminal (it drives a live board from the one you are in)",
      );
    } finally {
      cleanup();
    }
  });
});
