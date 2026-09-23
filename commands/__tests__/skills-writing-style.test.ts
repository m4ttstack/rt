import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { writingStyleList, writingStyleNew, writingStyleShow, writingStyleUse, type WritingStyleDeps } from "../skills-writing-style.ts";

class Exit extends Error { constructor(public code: number) { super(`exit ${code}`); } }

let home: string;
let out: string[];
let writes: { key: string; value: unknown; scope: string }[];
beforeEach(() => { home = mkdtempSync(join(tmpdir(), "rt-ws-cmd-")); out = []; writes = []; });
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

export function fakeDeps(over: Partial<WritingStyleDeps> = {}): WritingStyleDeps {
  return {
    home: () => home,
    now: () => new Date("2026-09-22T00:00:00Z"),
    print: (s) => { out.push(s); },
    exit: (code) => { throw new Exit(code); },
    isTTY: () => false,
    pick: async () => null,
    prompt: async () => null,
    pluginListStdout: async () => "[]",
    writeSetting: (key, value, scope) => { writes.push({ key, value, scope }); },
    resolve: () => ({ skill: "mattstack:writing-style-conversational", source: "fallback" }),
    ...over,
  };
}

describe("show", () => {
  test("--json prints the envelope with skill and source", async () => {
    await writingStyleShow(["--json"], {}, fakeDeps());
    expect(JSON.parse(out[0]!)).toEqual({ contract: 1, at: "2026-09-22T00:00:00.000Z", skill: "mattstack:writing-style-conversational", source: "fallback" });
  });
  test("plain output names the skill and where it came from", async () => {
    await writingStyleShow([], {}, fakeDeps({ resolve: () => ({ skill: "mattstack:writing-style-sparse", source: "team" }) }));
    expect(out[0]).toBe("mattstack:writing-style-sparse (team default)");
  });
});

describe("list", () => {
  const teamVoice = () => {
    const dir = join(home, ".mattstack", "user", "skills", "team-voice");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), "---\nname: team-voice\ndescription: x\n---\nbody\n");
  };

  test("--json carries current, presets-only options, and suggestions for personal/installed writing-style skills", async () => {
    teamVoice();
    await writingStyleList(["--json"], {}, fakeDeps());
    const body = JSON.parse(out[0]!);
    expect(body.current).toEqual({ skill: "mattstack:writing-style-conversational", source: "fallback" });
    expect(body.options.map((o: { id: string }) => o.id)).toEqual([
      "mattstack:writing-style-sparse", "mattstack:writing-style-conversational", "mattstack:writing-style-structured",
    ]);
    expect(body.options.every((o: { kind: string }) => o.kind === "preset")).toBe(true);
    expect(body.suggestions.map((o: { id: string }) => o.id)).toEqual(["team-voice"]);
  });

  test("plain output lists the presets, then Also available for suggestions, marking the current with *", async () => {
    teamVoice();
    await writingStyleList([], {}, fakeDeps({ resolve: () => ({ skill: "team-voice", source: "user" }) }));
    expect(out[0]).toContain("mattstack:writing-style-sparse");
    expect(out).toContain("Also available (type the id):");
    expect(out.some((l) => l.startsWith("*") && l.includes("team-voice"))).toBe(true);
  });

  test("a current value in neither list prints after the presets as current", async () => {
    await writingStyleList([], {}, fakeDeps({ resolve: () => ({ skill: "x:custom-note", source: "user" }) }));
    expect(out).toContain("* x:custom-note (current)");
  });
});

describe("use", () => {
  const homeRepo = () => mkdirSync(join(home, ".mattstack", "user", ".git"), { recursive: true });

  test("refuses before Install and writes nothing", async () => {
    await expect(writingStyleUse(["mattstack:writing-style-sparse", "--json"], {}, fakeDeps())).rejects.toThrow("exit 2");
    expect(JSON.parse(out[0]!).error.code).toBe("no-home-repo");
    expect(writes).toEqual([]);
    expect(existsSync(join(home, ".mattstack", "user"))).toBe(false);
  });

  test("writes a preset at user scope with the plugin absent", async () => {
    homeRepo();
    await writingStyleUse(["mattstack:writing-style-sparse", "--json"], {}, fakeDeps({ pluginListStdout: async () => null }));
    expect(writes).toEqual([{ key: "skills.writingStyle", value: "mattstack:writing-style-sparse", scope: "user" }]);
    const body = JSON.parse(out[0]!);
    expect(body.skill).toBe("mattstack:writing-style-sparse");
    expect(body.scope).toBe("user");
  });

  test("--scope team writes the team default", async () => {
    homeRepo();
    await writingStyleUse(["mattstack:writing-style-structured", "--scope", "team", "--json"], {}, fakeDeps());
    expect(writes[0]!.scope).toBe("team");
  });

  test("a bad id shape is bad-id; an unknown skill is unknown-skill listing the choices", async () => {
    homeRepo();
    await expect(writingStyleUse(["-rf", "--json"], {}, fakeDeps())).rejects.toThrow("exit 2");
    expect(JSON.parse(out[0]!).error.code).toBe("bad-id");
    out.length = 0;
    await expect(writingStyleUse(["nobody:writing-style-x", "--json"], {}, fakeDeps())).rejects.toThrow("exit 2");
    const e = JSON.parse(out[0]!).error;
    expect(e.code).toBe("unknown-skill");
    expect(e.message).toContain("mattstack:writing-style-sparse");
    expect(writes).toEqual([]);
  });

  test("a bad id is refused before the home-repo check or any lookup", async () => {
    let listed = false;
    await expect(writingStyleUse(["-rf", "--json"], {}, fakeDeps({ pluginListStdout: async () => { listed = true; return "[]"; } }))).rejects.toThrow("exit 2");
    expect(JSON.parse(out[0]!).error.code).toBe("bad-id");
    expect(listed).toBe(false);
  });

  test("a personal skill is linked, then accepted", async () => {
    homeRepo();
    const dir = join(home, ".mattstack", "user", "skills", "team-voice");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), "---\nname: team-voice\ndescription: x\n---\nbody\n");
    await writingStyleUse(["team-voice", "--json"], {}, fakeDeps());
    expect(lstatSync(join(home, ".claude", "skills", "team-voice")).isSymbolicLink()).toBe(true);
    expect(writes[0]!.value).toBe("team-voice");
  });

  test("a --scope with a missing value does not swallow --json; the usage refusal is still the envelope", async () => {
    homeRepo();
    await expect(writingStyleUse(["--scope", "--json"], {}, fakeDeps())).rejects.toThrow("exit 2");
    expect(JSON.parse(out[0]!).error.code).toBe("usage");
  });

  test("no id without a TTY is usage; with a TTY it picks", async () => {
    homeRepo();
    await expect(writingStyleUse(["--json"], {}, fakeDeps())).rejects.toThrow("exit 2");
    expect(JSON.parse(out[0]!).error.code).toBe("usage");
    out.length = 0;
    await writingStyleUse([], {}, fakeDeps({ isTTY: () => true, pick: async () => "mattstack:writing-style-conversational" }));
    expect(writes[0]!.value).toBe("mattstack:writing-style-conversational");
  });

  test("no id with a TTY: the picker offers the presets and then the suggestion entries", async () => {
    homeRepo();
    const dir = join(home, ".mattstack", "user", "skills", "team-voice");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), "---\nname: team-voice\ndescription: x\n---\nbody\n");
    let seen: { value: string }[] = [];
    await writingStyleUse([], {}, fakeDeps({
      isTTY: () => true,
      pick: async (_message, options) => { seen = options; return "team-voice"; },
    }));
    expect(seen.slice(0, 3).map((o) => o.value)).toEqual([
      "mattstack:writing-style-sparse", "mattstack:writing-style-conversational", "mattstack:writing-style-structured",
    ]);
    expect(seen.map((o) => o.value)).toContain("team-voice");
  });
});

describe("new", () => {
  const homeRepo = () => mkdirSync(join(home, ".mattstack", "user", ".git"), { recursive: true });
  function mattstackPlugin(): string {
    const installPath = join(home, "cache", "mattstack");
    const dir = join(installPath, "skills", "writing-style-sparse");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), [
      "---",
      "name: writing-style-sparse",
      'description: "Use only when the mattstack writing-style lookup names mattstack:writing-style-sparse. Terse."',
      "---",
      "",
      "<!-- compiled by rt skills compile from the sources below; slots pre-resolved; edits here are working-tree drift (rt skills promote) -->",
      "<!-- part: step source=mattstack:writing-style-sparse version=0.18.0 path=x lines=1-9 -->",
      "# Sparse",
      "",
    ].join("\n"));
    writeFileSync(join(dir, "pr-description.md"), "# PR descriptions (sparse)\n");
    return JSON.stringify([{ id: "mattstack@mattstack", enabled: true, installPath }]);
  }

  test("copies the preset into the home repo, strips compiler comments, renames, links", async () => {
    homeRepo();
    const list = mattstackPlugin();
    await writingStyleNew(["team-voice", "--from", "sparse", "--json"], {}, fakeDeps({ pluginListStdout: async () => list }));
    const dir = join(home, ".mattstack", "user", "skills", "team-voice");
    const text = readFileSync(join(dir, "SKILL.md"), "utf8");
    expect(text).toContain("name: team-voice");
    expect(text).toContain("names team-voice.");
    expect(text).not.toContain("<!-- ");
    expect(readFileSync(join(dir, "pr-description.md"), "utf8")).toContain("PR descriptions");
    expect(lstatSync(join(home, ".claude", "skills", "team-voice")).isSymbolicLink()).toBe(true);
    const body = JSON.parse(out[0]!);
    expect(body).toMatchObject({ name: "team-voice", from: "mattstack:writing-style-sparse" });
  });

  test("refusals: no-home-repo, bad-name, bad-preset, exists, no-plugin, usage", async () => {
    const code = async (args: string[], over: Partial<WritingStyleDeps> = {}) => {
      out.length = 0;
      await expect(writingStyleNew([...args, "--json"], {}, fakeDeps(over))).rejects.toThrow("exit 2");
      return JSON.parse(out[0]!).error.code;
    };
    expect(await code(["team-voice"])).toBe("no-home-repo");
    homeRepo();
    expect(await code(["../x"])).toBe("bad-name");
    expect(await code(["team-voice", "--from", "loud"])).toBe("bad-preset");
    expect(await code(["team-voice"], { pluginListStdout: async () => "[]" })).toBe("no-plugin");
    const list = mattstackPlugin();
    mkdirSync(join(home, ".mattstack", "user", "skills", "taken"), { recursive: true });
    expect(await code(["taken"], { pluginListStdout: async () => list })).toBe("exists");
    expect(await code([])).toBe("usage");
  });

  test("CRLF preset SKILL.md yields a copy with normalized LF and retargeted frontmatter", async () => {
    homeRepo();
    const installPath = join(home, "cache", "mattstack");
    const dir = join(installPath, "skills", "writing-style-sparse");
    mkdirSync(dir, { recursive: true });
    const crlfContent = "---\r\nname: writing-style-sparse\r\ndescription: \"Use only mattstack:writing-style-sparse\"\r\n---\r\n\r\n# Sparse\r\n";
    writeFileSync(join(dir, "SKILL.md"), crlfContent);
    const list = JSON.stringify([{ id: "mattstack@mattstack", enabled: true, installPath }]);
    await writingStyleNew(["team-voice", "--from", "sparse", "--json"], {}, fakeDeps({ pluginListStdout: async () => list }));
    const text = readFileSync(join(home, ".mattstack", "user", "skills", "team-voice", "SKILL.md"), "utf8");
    expect(text).toContain("name: team-voice");
    expect(text).not.toContain("\r\n");
  });

  test("preset SKILL.md with no frontmatter refuses no-plugin and leaves no directory", async () => {
    homeRepo();
    const installPath = join(home, "cache", "mattstack");
    const dir = join(installPath, "skills", "writing-style-sparse");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), "# No frontmatter\nJust content\n");
    const list = JSON.stringify([{ id: "mattstack@mattstack", enabled: true, installPath }]);
    out.length = 0;
    await expect(writingStyleNew(["team-voice", "--from", "sparse", "--json"], {}, fakeDeps({ pluginListStdout: async () => list }))).rejects.toThrow("exit 2");
    expect(JSON.parse(out[0]!).error.code).toBe("no-plugin");
    expect(existsSync(join(home, ".mattstack", "user", "skills", "team-voice"))).toBe(false);
  });

  test("unreadable pr-description.md (directory) fails without leaving skills directory behind", async () => {
    homeRepo();
    const installPath = join(home, "cache", "mattstack");
    const dir = join(installPath, "skills", "writing-style-sparse");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), [
      "---",
      "name: writing-style-sparse",
      'description: "mattstack:writing-style-sparse"',
      "---",
      "# Sparse",
    ].join("\n"));
    mkdirSync(join(dir, "pr-description.md"));
    const list = JSON.stringify([{ id: "mattstack@mattstack", enabled: true, installPath }]);
    out.length = 0;
    await expect(writingStyleNew(["team-voice", "--from", "sparse", "--json"], {}, fakeDeps({ pluginListStdout: async () => list }))).rejects.toThrow();
    expect(existsSync(join(home, ".mattstack", "user", "skills", "team-voice"))).toBe(false);
  });
});
