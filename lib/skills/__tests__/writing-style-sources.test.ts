import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  isStyleUsable, linkPersonalSkills, listWritingStyles, parsePluginEntries, personalSkillsDir, readSkillInventory,
} from "../writing-style-sources.ts";

let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), "rt-ws-sources-")); });
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

function skill(dir: string, name: string) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: x\n---\nbody\n`);
}

function plugin(id: string, enabled: boolean, skills: string[], manifestSkills?: string[]) {
  const installPath = join(home, "cache", id);
  mkdirSync(join(installPath, ".claude-plugin"), { recursive: true });
  writeFileSync(join(installPath, ".claude-plugin", "plugin.json"), JSON.stringify({ name: id.split("@")[0], version: "1.0.0", ...(manifestSkills ? { skills: manifestSkills } : {}) }));
  for (const s of skills) skill(join(installPath, "skills", s), s);
  return { id, enabled, installPath };
}

describe("parsePluginEntries", () => {
  test("keeps id, enabled and installPath", () => {
    expect(parsePluginEntries('[{"id":"a@m","enabled":true,"installPath":"/p"},{"id":"b@m"}]')).toEqual([
      { id: "a@m", enabled: true, installPath: "/p" },
      { id: "b@m", enabled: false, installPath: null },
    ]);
  });
  test("rejects a non-array or an entry without an id", () => {
    expect(parsePluginEntries("nope")).toBeNull();
    expect(parsePluginEntries('[{"enabled":true}]')).toBeNull();
  });
});

describe("readSkillInventory", () => {
  test("enabled plugin skills are installed; disabled ones name the plugin to enable", () => {
    const inv = readSkillInventory(home, [plugin("team@m", true, ["team-writing-style"]), plugin("off@m", false, ["off-writing-style"])]);
    expect(inv.installed.has("team:team-writing-style")).toBe(true);
    expect(inv.installed.has("off:off-writing-style")).toBe(false);
    expect(inv.disabledPluginFor.get("off:off-writing-style")).toBe("off@m");
  });

  test("a manifest skills root other than ./skills is honored", () => {
    const p = plugin("alt@m", true, [], ["./skills", "./plugin/skills"]);
    skill(join(p.installPath, "plugin", "skills", "alt-writing-style"), "alt-writing-style");
    expect(readSkillInventory(home, [p]).installed.has("alt:alt-writing-style")).toBe(true);
  });

  test("~/.claude/skills entries are installed; personal skills are listed", () => {
    skill(join(home, ".claude", "skills", "matt:matts-writing-style"), "matt:matts-writing-style");
    skill(join(personalSkillsDir(home), "my-voice"), "my-voice");
    const inv = readSkillInventory(home, null);
    expect(inv.installed.has("matt:matts-writing-style")).toBe(true);
    expect(inv.personal.map((s) => s.name)).toEqual(["my-voice"]);
  });
});

describe("isStyleUsable and listWritingStyles", () => {
  test("presets are usable with no plugin at all", () => {
    expect(isStyleUsable("mattstack:writing-style-sparse", readSkillInventory(home, null))).toBe(true);
    expect(isStyleUsable("nobody:writing-style-x", readSkillInventory(home, null))).toBe(false);
  });

  test("lists presets, personal and installed styles once each, with current", () => {
    const mattstack = plugin("mattstack@mattstack", true, ["writing-style-sparse"]);
    skill(join(home, ".claude", "skills", "matt:matts-writing-style"), "matt:matts-writing-style");
    skill(join(personalSkillsDir(home), "my-voice"), "my-voice");
    const inv = readSkillInventory(home, [mattstack]);
    const out = listWritingStyles(inv, { skill: "matt:matts-writing-style", source: "user" });
    expect(out.current).toEqual({ skill: "matt:matts-writing-style", source: "user" });
    const ids = out.options.map((o) => o.id);
    expect(ids.slice(0, 3)).toEqual(["mattstack:writing-style-sparse", "mattstack:writing-style-conversational", "mattstack:writing-style-structured"]);
    expect(ids.filter((id) => id === "mattstack:writing-style-sparse")).toHaveLength(1);
    expect(out.options.find((o) => o.id === "mattstack:writing-style-sparse")?.kind).toBe("preset");
    expect(out.options.find((o) => o.id === "my-voice")?.kind).toBe("personal");
    expect(out.options.find((o) => o.id === "matt:matts-writing-style")?.kind).toBe("installed");
  });
});

describe("linkPersonalSkills", () => {
  test("links personal skill directories into ~/.claude/skills and ignores plain files", () => {
    const dir = personalSkillsDir(home);
    skill(join(dir, "my-voice"), "my-voice");
    writeFileSync(join(dir, "preferences.md"), "## Writing style\n");
    linkPersonalSkills(home);
    expect(lstatSync(join(home, ".claude", "skills", "my-voice")).isSymbolicLink()).toBe(true);
    expect(existsSync(join(home, ".claude", "skills", "preferences.md"))).toBe(false);
  });

  test("no personal skills directory is a no-op", () => {
    expect(linkPersonalSkills(home)).toBeNull();
  });
});
