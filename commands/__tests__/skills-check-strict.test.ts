import { describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { mcpTools } from "../../lib/mcp/tools.ts";
import { checkPack, skillsCheck } from "../skills.ts";

function makePack(manifest: Record<string, unknown>, body = "Record it with `rt runs snapshot`."): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-check-strict-")));
  mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
  writeFileSync(join(dir, ".claude-plugin", "plugin.json"), JSON.stringify(manifest));
  mkdirSync(join(dir, "skills", "x"), { recursive: true });
  writeFileSync(join(dir, "skills", "x", "SKILL.md"), `---\nname: x\n---\n${body}\n`);
  return dir;
}

/** Bun ignores process.exitCode = undefined once it is truthy, so 0 is the
    only value that clears it before the suite's own exit status. */
async function runCheck(args: string[]): Promise<{ exitCode: number; logs: string[] }> {
  const logs: string[] = [];
  const logSpy = spyOn(console, "log").mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(" ")); });
  process.exitCode = 0;
  try {
    await skillsCheck(args);
    return { exitCode: Number(process.exitCode ?? 0), logs };
  } finally {
    logSpy.mockRestore();
    process.exitCode = 0;
  }
}

describe("checkPack strictness", () => {
  test("a pack that does not opt in reports its hits and is not strict", async () => {
    const dir = makePack({ name: "acme", version: "1.0.0" });
    try {
      const payload = await checkPack({ packDir: dir });
      expect(payload.mcpLint.length).toBe(1);
      expect(payload.strictLint).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("\"strictLint\": true in plugin.json makes the pack strict", async () => {
    const dir = makePack({ name: "acme", version: "1.0.0", strictLint: true });
    try {
      const payload = await checkPack({ packDir: dir });
      expect(payload.mcpLint.length).toBe(1);
      expect(payload.strictLint).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("only rules naming a tool the server publishes report", async () => {
    const published = new Set(mcpTools().map((t) => t.name));
    const dir = makePack({ name: "acme", version: "1.0.0" }, "Push with `git push`, then `rt runs snapshot`.");
    try {
      const payload = await checkPack({ packDir: dir });
      expect(payload.mcpLint.every((h) => published.has(h.tool))).toBe(true);
      expect(payload.mcpLint.map((h) => h.rule)).toContain("rt-runs");
      expect(payload.mcpLint.some((h) => h.rule === "git-push")).toBe(published.has("git_push"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a pack named mattstack without the flag is not strict", async () => {
    const dir = makePack({ name: "mattstack", version: "1.0.0" });
    try {
      const payload = await checkPack({ packDir: dir });
      expect(payload.mcpLint.length).toBe(1);
      expect(payload.strictLint).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a pack named mattstack with \"strictLint\": true in plugin.json is strict", async () => {
    const dir = makePack({ name: "mattstack", version: "1.0.0", strictLint: true });
    try {
      const payload = await checkPack({ packDir: dir });
      expect(payload.mcpLint.length).toBe(1);
      expect(payload.strictLint).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("skills check --strict", () => {
  test("exits 1 on hits with --strict and 0 without, naming the policy in the summary line", async () => {
    const dir = makePack({ name: "acme", version: "1.0.0" });
    try {
      const strict = await runCheck(["--pack-dir", dir, "--strict"]);
      expect(strict.exitCode).toBe(1);
      expect(strict.logs).toContain("mcp lint: 1 hits (strict: --strict and rt skills sync fail on them)");

      const advisory = await runCheck(["--pack-dir", dir]);
      expect(advisory.exitCode).toBe(0);
      expect(advisory.logs).toContain("mcp lint: 1 hits (advisory; --strict fails on them)");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a strictLint pack gets the strict summary line even without --strict", async () => {
    const dir = makePack({ name: "acme", version: "1.0.0", strictLint: true });
    try {
      const { exitCode, logs } = await runCheck(["--pack-dir", dir]);
      expect(exitCode).toBe(0);
      expect(logs).toContain("mcp lint: 1 hits (strict: --strict and rt skills sync fail on them)");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--json carries mcpLint and strictLint", async () => {
    const dir = makePack({ name: "acme", version: "1.0.0", strictLint: true });
    try {
      const { logs } = await runCheck(["--pack-dir", dir, "--json"]);
      const parsed = JSON.parse(logs.at(-1)!) as { mcpLint: Array<{ rule: string; tool: string }>; strictLint: boolean };
      expect(parsed.mcpLint.map((h) => h.rule)).toEqual(["rt-runs"]);
      expect(parsed.mcpLint[0]!.tool).toBe("run_stage");
      expect(parsed.strictLint).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
