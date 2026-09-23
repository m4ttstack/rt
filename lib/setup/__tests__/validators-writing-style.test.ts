import { describe, expect, test } from "bun:test";
import { DONE_ACTION_TYPES, FINISH_GATED_ROW_IDS, WAIVABLE_ROW_IDS, finishBlockers } from "../contract.ts";
import { unwaiveRow } from "../finish-gate.ts";
import { writingStyleRow, writingStyleRowFor } from "../validators/writing-style.ts";
import type { SkillInventory } from "../../skills/writing-style-sources.ts";

const inv = (installed: string[] = [], disabled: [string, string][] = []): SkillInventory => ({
  installed: new Set(installed), disabledPluginFor: new Map(disabled), personal: [],
});
const opts = [{ id: "mattstack:writing-style-sparse", label: "Sparse", detail: "d", sample: "s", kind: "preset" as const, installed: false }];

describe("writingStyleRow", () => {
  test("before Install: needs-you, no action", () => {
    const r = writingStyleRow({ homeReady: false, resolved: { skill: "x", source: "fallback" }, inventory: inv(), options: opts });
    expect(r.status).toBe("needs-you");
    expect(r.action).toBeNull();
    expect(r.detail).toBe("You'll choose this after Install");
    expect(r.finishGated).toBe(true);
    expect(r.kind).toBe("tool");
  });

  test("after Install with nothing chosen: needs-you with the choose action", () => {
    const r = writingStyleRow({ homeReady: true, resolved: { skill: "mattstack:writing-style-conversational", source: "fallback" }, inventory: inv(), options: opts });
    expect(r.status).toBe("needs-you");
    expect(r.detail).toBe("Not chosen yet");
    expect(r.action).toMatchObject({ type: "choose", verb: ["skills", "writing-style", "use"] });
    expect((r.action as { options: unknown[] }).options).toHaveLength(1);
    expect((r.action as { other?: { label: string } }).other?.label).toBe("Use my own skill…");
  });

  test("the choose action carries its sheet copy", () => {
    const r = writingStyleRow({ homeReady: true, resolved: { skill: "x", source: "fallback" }, inventory: inv(), options: opts });
    const action = r.action as { subtitle?: string; footnote?: string };
    expect(action.subtitle).toBe("The voice agents use for reviews, replies and PR descriptions posted under your name.");
    expect(action.footnote).toBe("You can also choose from a terminal: rt skills writing-style use");
  });

  test("other.suggestions lists installed and personal ids not already offered as options, deduplicated and sorted", () => {
    const inventory: SkillInventory = {
      installed: new Set(["x:y", "mattstack:writing-style-sparse"]),
      disabledPluginFor: new Map(),
      personal: [{ name: "team-voice", dir: "/home/.mattstack/user/skills/team-voice" }],
    };
    const r = writingStyleRow({ homeReady: true, resolved: { skill: "x", source: "fallback" }, inventory, options: opts });
    const action = r.action as { other?: { suggestions?: string[] } };
    expect(action.other?.suggestions).toEqual(["team-voice", "x:y"]);
  });

  test("a team default naming a preset is ready on a fresh Mac", () => {
    const r = writingStyleRow({ homeReady: true, resolved: { skill: "mattstack:writing-style-sparse", source: "team" }, inventory: inv(), options: opts });
    expect(r.status).toBe("ready");
    expect(r.detail).toBe("Sparse (team default)");
  });

  test("a configured skill that is not installed is invalid; a disabled plugin is named", () => {
    expect(writingStyleRow({ homeReady: true, resolved: { skill: "x:writing-style-a", source: "user" }, inventory: inv(), options: opts }).status).toBe("invalid");
    const d = writingStyleRow({ homeReady: true, resolved: { skill: "x:y", source: "user" }, inventory: inv([], [["x:y", "x@m"]]), options: opts });
    expect(d.detail).toContain("enable x@m");
  });

  test("preferences.md and personal choices read ready with their source", () => {
    expect(writingStyleRow({ homeReady: true, resolved: { skill: "acme:team-writing-style", source: "preferences" }, inventory: inv(["acme:team-writing-style"]), options: opts }).detail).toBe("acme:team-writing-style (from preferences.md)");
    expect(writingStyleRow({ homeReady: true, resolved: { skill: "team-voice", source: "user" }, inventory: inv(["team-voice"]), options: opts }).detail).toBe("team-voice (yours)");
  });

  test("every action this row can carry is one the Done screen handles", () => {
    const r = writingStyleRow({ homeReady: true, resolved: { skill: "x", source: "fallback" }, inventory: inv(), options: opts });
    expect((DONE_ACTION_TYPES as readonly string[]).includes(r.action!.type)).toBe(true);
  });

  test("a ready row preselects the current style in its choose action", () => {
    const r = writingStyleRow({ homeReady: true, resolved: { skill: "mattstack:writing-style-sparse", source: "user" }, inventory: inv(), options: opts });
    expect((r.action as { selected?: string }).selected).toBe("mattstack:writing-style-sparse");
  });
});

describe("writing-style row in the finish gate", () => {
  test("the row id is finish-gated and not waivable; unwaive still clears a stale entry", () => {
    expect(FINISH_GATED_ROW_IDS).toContain("skills.writing-style");
    expect(WAIVABLE_ROW_IDS).not.toContain("skills.writing-style");
    const store = { ids: ["skills.writing-style"], read() { return this.ids; }, write(ids: string[]) { this.ids = ids; } };
    expect(unwaiveRow("skills.writing-style", store)).toEqual({ waived: [], changed: true });
  });

  test("an error row never blocks Finish: a gate that could not be evaluated must not strand the wizard", () => {
    const broken = writingStyleRowFor(
      { home: "/nonexistent-home", exists: () => { throw new Error("store unreadable"); } },
      { code: 0, stdout: "[]", stderr: "" },
    );
    expect(broken.status).toBe("error");
    expect(broken.finishGated).toBe(false);
    expect(finishBlockers([{ id: "tools", title: "Tools", rows: [broken] }])).toEqual([]);
  });
});
