import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { getDef, validateValue } from "../../settings/registry.ts";
import { getSetting } from "../../settings/resolve.ts";
import { setSetting } from "../../settings/write.ts";
import { WAIVED_SETTING_KEY, readWaived } from "../finish-gate.ts";

let home: string;
let prevHome: string | undefined;
beforeEach(() => {
  prevHome = process.env.HOME;
  home = mkdtempSync(join(tmpdir(), "rt-finish-gate-"));
  process.env.HOME = home;
});
afterEach(() => {
  process.env.HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

describe("setup.waived registry row", () => {
  test("machine scope only, array, default []", () => {
    const def = getDef(WAIVED_SETTING_KEY)!;
    expect(def.scopes).toEqual(["machine"]);
    expect(def.type).toBe("array");
    expect(def.default).toEqual([]);
    expect(validateValue(def, ["tool.fast-browser-extension"]).ok).toBe(true);
    expect(validateValue(def, "tool.fast-browser-extension").ok).toBe(false);
  });

  test("a user or team scope write is refused by the resolver", () => {
    expect(() => setSetting(WAIVED_SETTING_KEY, ["tool.fast-browser-extension"], "user")).toThrow();
    expect(() => setSetting(WAIVED_SETTING_KEY, ["tool.fast-browser-extension"], "team")).toThrow();
  });
});

describe("readWaived", () => {
  test("unset reads as none", () => {
    expect(readWaived()).toEqual([]);
  });

  test("reads the machine store through the resolver", () => {
    setSetting(WAIVED_SETTING_KEY, ["tool.fast-browser-extension"], "machine");
    expect(readWaived()).toEqual(["tool.fast-browser-extension"]);
    expect(getSetting(WAIVED_SETTING_KEY).provenance.map((p) => p.scope)).toEqual(["machine"]);
  });

  test("a non-array or non-string entry reads as none of it", () => {
    expect(readWaived({ read: () => "tool.fast-browser-extension" as never })).toEqual([]);
    expect(readWaived({ read: () => ["tool.fast-browser-extension", 7] as never })).toEqual(["tool.fast-browser-extension"]);
  });

  test("a resolver throw reads as none, with one warning", () => {
    const warnings: string[] = [];
    const ids = readWaived({
      read: () => {
        throw new Error("malformed store");
      },
      warn: (m) => warnings.push(m),
    });
    expect(ids).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("setup.waived");
  });
});
