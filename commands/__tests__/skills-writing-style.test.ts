import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { writingStyleList, writingStyleShow, writingStyleUse, type WritingStyleDeps } from "../skills-writing-style.ts";

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
  test("--json carries current and the presets first", async () => {
    await writingStyleList(["--json"], {}, fakeDeps());
    const body = JSON.parse(out[0]!);
    expect(body.current).toEqual({ skill: "mattstack:writing-style-conversational", source: "fallback" });
    expect(body.options.slice(0, 3).map((o: { id: string }) => o.id)).toEqual([
      "mattstack:writing-style-sparse", "mattstack:writing-style-conversational", "mattstack:writing-style-structured",
    ]);
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
    const dir = join(home, ".mattstack", "user", "skills", "my-voice");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), "---\nname: my-voice\ndescription: x\n---\nbody\n");
    await writingStyleUse(["my-voice", "--json"], {}, fakeDeps());
    expect(lstatSync(join(home, ".claude", "skills", "my-voice")).isSymbolicLink()).toBe(true);
    expect(writes[0]!.value).toBe("my-voice");
  });

  test("no id without a TTY is usage; with a TTY it picks", async () => {
    homeRepo();
    await expect(writingStyleUse(["--json"], {}, fakeDeps())).rejects.toThrow("exit 2");
    expect(JSON.parse(out[0]!).error.code).toBe("usage");
    out.length = 0;
    await writingStyleUse([], {}, fakeDeps({ isTTY: () => true, pick: async () => "mattstack:writing-style-conversational" }));
    expect(writes[0]!.value).toBe("mattstack:writing-style-conversational");
  });
});
