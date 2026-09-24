import { describe, expect, test } from "bun:test";
import { parseInitArgs, renderInitOutcome } from "../skills-init.ts";
import type { InitOutcome } from "../../lib/skills/init.ts";

describe("parseInitArgs", () => {
  test("defaults: cwd repo, no zone, human output", () => {
    expect(parseInitArgs([])).toEqual({ repo: process.cwd(), zone: null, json: false });
  });
  test("reads every flag", () => {
    expect(parseInitArgs(["--repo", "/r", "--zone", "z", "--json"])).toEqual({ repo: "/r", zone: "z", json: true });
  });
  test("a flag without a value throws a usage error", () => {
    expect(() => parseInitArgs(["--zone"])).toThrow(/--zone needs a value/);
  });
  test("--pack is not an argument", () => {
    expect(() => parseInitArgs(["--pack", "x"])).toThrow(/unrecognized argument "--pack"/);
  });
});

describe("renderInitOutcome", () => {
  const okOutcome: InitOutcome = {
    ok: true,
    pack: { name: "acme", dir: "/z/mattstack/packs/acme", zone: "acme", marketplace: "acme" },
    repo: { slug: "gitlab.com-acme-api", manifest: "/h/.mattstack/repos/gitlab.com-acme-api/skills.jsonc" },
    wrote: ["/z/mattstack/packs/acme/pack/stubs.jsonc"],
    installed: { plugin: "acme@acme", version: "0.1.0" },
    restartNeeded: true,
    tryNext: "/acme:work <ticket>",
  };
  test("human output names the pack dir, the restart, and what to try", () => {
    const text = renderInitOutcome(okOutcome);
    expect(text).toContain("/z/mattstack/packs/acme");
    expect(text).toContain("restart");
    expect(text).toContain("/acme:work <ticket>");
  });
  test("a refusal renders as rt skills init: <detail>", () => {
    const text = renderInitOutcome({ ok: false, refused: true, code: "pack-exists", detail: "exists" });
    expect(text).toBe("rt skills init: exists");
  });
  test("a failure lists what was written", () => {
    const text = renderInitOutcome({ ok: false, refused: false, code: "compile-failed", detail: "boom", wrote: ["/a", "/b"] });
    expect(text).toContain("boom");
    expect(text).toContain("/a");
    expect(text).toContain("/b");
  });
});
