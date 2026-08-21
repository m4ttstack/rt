// src/__tests__/skill-path.test.ts
import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveSkillPath, runPluginList, makeCachedPluginListRunner, type PluginEntry } from "../skill-path.ts";

function fixturePlugin(installPath: string, extra: Partial<PluginEntry> = {}): PluginEntry {
  return { id: "acme@acme", enabled: true, installPath, ...extra };
}

/** A fake "claude" binary: a shell script that prints `stdout` and exits `code`. */
function fakeClaudeBin(dir: string, stdout: string, code = 0): string {
  const path = join(dir, "fake-claude.sh");
  writeFileSync(path, `#!/bin/sh\nprintf '%s' ${JSON.stringify(stdout)}\nexit ${code}\n`);
  chmodSync(path, 0o755);
  return path;
}

function writeSkillMd(dir: string) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), "---\nname: fixture\n---\n\nfixture body\n");
}

describe("resolveSkillPath", () => {
  test("resolves a skills/<name>/SKILL.md path", async () => {
    const root = mkdtempSync(join(tmpdir(), "skill-path-"));
    try {
      writeSkillMd(join(root, "skills", "mr-board-review"));
      const listPlugins = async () => [fixturePlugin(root)];
      const path = await resolveSkillPath("acme:mr-board-review", listPlugins);
      expect(path).toBe(realpathSync(join(root, "skills", "mr-board-review", "SKILL.md")));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("resolves a skills/<category>/<name>/SKILL.md path", async () => {
    const root = mkdtempSync(join(tmpdir(), "skill-path-"));
    try {
      writeSkillMd(join(root, "skills", "board", "mr-board-doctor"));
      const listPlugins = async () => [fixturePlugin(root)];
      const path = await resolveSkillPath("acme:mr-board-doctor", listPlugins);
      expect(path).toBe(realpathSync(join(root, "skills", "board", "mr-board-doctor", "SKILL.md")));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("resolves an attachments/<name>/SKILL.md path when not under skills/", async () => {
    const root = mkdtempSync(join(tmpdir(), "skill-path-"));
    try {
      writeSkillMd(join(root, "attachments", "mr-board-respond"));
      const listPlugins = async () => [fixturePlugin(root)];
      const path = await resolveSkillPath("acme:mr-board-respond", listPlugins);
      expect(path).toBe(realpathSync(join(root, "attachments", "mr-board-respond", "SKILL.md")));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("prefers skills/ over attachments/ when both exist", async () => {
    const root = mkdtempSync(join(tmpdir(), "skill-path-"));
    try {
      writeSkillMd(join(root, "skills", "dup"));
      writeSkillMd(join(root, "attachments", "dup"));
      const listPlugins = async () => [fixturePlugin(root)];
      const path = await resolveSkillPath("acme:dup", listPlugins);
      expect(path).toBe(realpathSync(join(root, "skills", "dup", "SKILL.md")));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("returns null when the skill is not found anywhere in the plugin", async () => {
    const root = mkdtempSync(join(tmpdir(), "skill-path-"));
    try {
      mkdirSync(join(root, "skills"), { recursive: true });
      const listPlugins = async () => [fixturePlugin(root)];
      const path = await resolveSkillPath("acme:missing", listPlugins);
      expect(path).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("returns null when no plugin id matches the name's prefix", async () => {
    const listPlugins = async () => [fixturePlugin("/nowhere", { id: "other@marketplace" })];
    expect(await resolveSkillPath("acme:mr-board-review", listPlugins)).toBeNull();
  });

  test("returns null when the matching plugin is disabled", async () => {
    const root = mkdtempSync(join(tmpdir(), "skill-path-"));
    try {
      writeSkillMd(join(root, "skills", "mr-board-review"));
      const listPlugins = async () => [fixturePlugin(root, { enabled: false })];
      expect(await resolveSkillPath("acme:mr-board-review", listPlugins)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("returns null for a name with no plugin prefix", async () => {
    const listPlugins = async () => [fixturePlugin("/nowhere")];
    expect(await resolveSkillPath("no-colon-here", listPlugins)).toBeNull();
  });

  test("returns null when the plugin list source throws", async () => {
    const listPlugins = async () => {
      throw new Error("claude: command not found");
    };
    expect(await resolveSkillPath("acme:mr-board-review", listPlugins)).toBeNull();
  });

  test("returns null when installPath does not exist on disk", async () => {
    const listPlugins = async () => [fixturePlugin("/definitely/not/a/real/path/xyz")];
    expect(await resolveSkillPath("acme:mr-board-review", listPlugins)).toBeNull();
  });
});

describe("runPluginList", () => {
  test("ok:true with the parsed array on a clean exit", async () => {
    const dir = mkdtempSync(join(tmpdir(), "skill-path-runner-"));
    try {
      const bin = fakeClaudeBin(dir, JSON.stringify([{ id: "acme@acme", enabled: true, installPath: "/x" }]));
      const result = await runPluginList(bin);
      expect(result).toEqual({ ok: true, plugins: [{ id: "acme@acme", enabled: true, installPath: "/x" }] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("ok:false on a non-zero exit", async () => {
    const dir = mkdtempSync(join(tmpdir(), "skill-path-runner-"));
    try {
      const bin = fakeClaudeBin(dir, "boom", 1);
      expect(await runPluginList(bin)).toEqual({ ok: false });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("ok:false on malformed JSON", async () => {
    const dir = mkdtempSync(join(tmpdir(), "skill-path-runner-"));
    try {
      const bin = fakeClaudeBin(dir, "not json at all");
      expect(await runPluginList(bin)).toEqual({ ok: false });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("ok:false on valid JSON that isn't an array", async () => {
    const dir = mkdtempSync(join(tmpdir(), "skill-path-runner-"));
    try {
      const bin = fakeClaudeBin(dir, JSON.stringify({ not: "an array" }));
      expect(await runPluginList(bin)).toEqual({ ok: false });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("ok:false when the binary doesn't exist (spawn failure)", async () => {
    expect(await runPluginList("/definitely/not/a/real/binary/xyz")).toEqual({ ok: false });
  });
});

describe("makeCachedPluginListRunner", () => {
  test("caches a successful result across calls", async () => {
    let calls = 0;
    const plugins = [fixturePlugin("/x")];
    const run = async () => {
      calls++;
      return { ok: true as const, plugins };
    };
    const runner = makeCachedPluginListRunner(run);
    expect(await runner()).toEqual(plugins);
    expect(await runner()).toEqual(plugins);
    expect(await runner()).toEqual(plugins);
    expect(calls).toBe(1);
  });

  test("does NOT cache a failure -- retries on the next call", async () => {
    let calls = 0;
    const run = async () => {
      calls++;
      return { ok: false as const };
    };
    const runner = makeCachedPluginListRunner(run);
    expect(await runner()).toEqual([]);
    expect(await runner()).toEqual([]);
    expect(calls).toBe(2);
  });

  test("a transient failure doesn't pin a later success out of the cache", async () => {
    let calls = 0;
    const plugins = [fixturePlugin("/x")];
    const run = async () => {
      calls++;
      return calls === 1 ? { ok: false as const } : { ok: true as const, plugins };
    };
    const runner = makeCachedPluginListRunner(run);
    expect(await runner()).toEqual([]); // transient failure, not cached
    expect(await runner()).toEqual(plugins); // succeeds and is now cached
    expect(await runner()).toEqual(plugins); // served from cache
    expect(calls).toBe(2);
  });

  test("caches a successful empty list (still a real answer)", async () => {
    let calls = 0;
    const run = async () => {
      calls++;
      return { ok: true as const, plugins: [] };
    };
    const runner = makeCachedPluginListRunner(run);
    expect(await runner()).toEqual([]);
    expect(await runner()).toEqual([]);
    expect(calls).toBe(1);
  });
});
