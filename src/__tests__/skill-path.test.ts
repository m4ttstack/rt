// src/__tests__/skill-path.test.ts
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveSkillPath, type PluginEntry } from "../skill-path.ts";

function fixturePlugin(installPath: string, extra: Partial<PluginEntry> = {}): PluginEntry {
  return { id: "acme@acme", enabled: true, installPath, ...extra };
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
