import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { Resolved } from "../../settings/resolve.ts";
import {
  FALLBACK_WRITING_STYLE, isPresetId, isValidSkillId, parsePreferencesStyle, preferencesPath, resolveWritingStyle,
} from "../writing-style.ts";

let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), "rt-writing-style-")); });
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

const unset = (): Resolved<unknown> => ({ value: undefined, provenance: [] });
const at = (value: unknown, scope: "user" | "team"): Resolved<unknown> => ({ value, provenance: [{ scope, file: `/x/${scope}.jsonc` }] });

function writePrefs(text: string) {
  const path = preferencesPath(home);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}

describe("isValidSkillId", () => {
  test("accepts plugin:name and bare names; refuses flags and paths", () => {
    for (const ok of ["mattstack:writing-style-sparse", "acme:team-writing-style", "team-voice", "a.b_c"]) expect(isValidSkillId(ok)).toBe(true);
    for (const bad of ["-rf", "../x", "a/b", "", "Upper", "a:b:c", " x"]) expect(isValidSkillId(bad)).toBe(false);
  });
});

describe("parsePreferencesStyle", () => {
  test("reads the backticked value on the keyed line", () => {
    expect(parsePreferencesStyle("## Writing style\n\nwriting-style: `acme:team-writing-style`\n\nLoad it first.\n")).toBe("acme:team-writing-style");
  });
  test("reads an unquoted value", () => {
    expect(parsePreferencesStyle("## Writing style\nwriting-style: team-voice\n")).toBe("team-voice");
  });
  test("no keyed line, no section, or a keyed line in another section reads nothing", () => {
    expect(parsePreferencesStyle("## Writing style\nLoad `x:y` before drafting.\n")).toBeNull();
    expect(parsePreferencesStyle("## Dev process runner\nwriting-style: `x:y`\n")).toBeNull();
    expect(parsePreferencesStyle("## Writing style\n\n## Other\nwriting-style: `x:y`\n")).toBeNull();
  });
  test("an invalid id reads nothing", () => {
    expect(parsePreferencesStyle("## Writing style\nwriting-style: `-rf`\n")).toBeNull();
  });
  test("an indented next heading still ends the section", () => {
    expect(parsePreferencesStyle("## Writing style\n\n  ## Other\nwriting-style: `x:y`\n")).toBeNull();
  });
});

describe("resolveWritingStyle", () => {
  test("a user value wins over preferences.md", () => {
    writePrefs("## Writing style\nwriting-style: `x:from-prefs`\n");
    expect(resolveWritingStyle({ home, read: () => at("mattstack:writing-style-sparse", "user") })).toEqual({ skill: "mattstack:writing-style-sparse", source: "user" });
  });
  test("a team value reads as the team default", () => {
    expect(resolveWritingStyle({ home, read: () => at("mattstack:writing-style-structured", "team") })).toEqual({ skill: "mattstack:writing-style-structured", source: "team" });
  });
  test("preferences.md is the second rung", () => {
    writePrefs("## Writing style\nwriting-style: `acme:team-writing-style`\n");
    expect(resolveWritingStyle({ home, read: unset })).toEqual({ skill: "acme:team-writing-style", source: "preferences" });
  });
  test("nothing anywhere falls back to conversational", () => {
    expect(resolveWritingStyle({ home, read: unset })).toEqual({ skill: FALLBACK_WRITING_STYLE, source: "fallback" });
    expect(isPresetId(FALLBACK_WRITING_STYLE)).toBe(true);
  });
  test("an invalid stored value is skipped, not returned", () => {
    expect(resolveWritingStyle({ home, read: () => at("-rf", "user") }).source).toBe("fallback");
  });
});
