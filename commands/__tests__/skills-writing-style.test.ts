import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { writingStyleList, writingStyleShow, type WritingStyleDeps } from "../skills-writing-style.ts";

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
