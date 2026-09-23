import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { getDef, validateValue } from "../../settings/registry.ts";
import { getSetting } from "../../settings/resolve.ts";
import { setSetting } from "../../settings/write.ts";
import { FINISH_GATED_ROW_IDS, WAIVABLE_ROW_IDS, finishBlockers, row } from "../contract.ts";
import { UserActionableError } from "../errors.ts";
import { WAIVED_SETTING_KEY, applyFinishGate, readWaived, realWaiverStore, unwaiveRow, waiveRow } from "../finish-gate.ts";

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

  test("a user or team scope write is refused by the resolver's own scope check", () => {
    expect(() => setSetting(WAIVED_SETTING_KEY, ["tool.fast-browser-extension"], "user")).toThrow(/cannot be set in the user store \(allowed: machine\)/);
    expect(() => setSetting(WAIVED_SETTING_KEY, ["tool.fast-browser-extension"], "team")).toThrow(/cannot be set in the team store \(allowed: machine\)/);
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

function fakeStore(initial: string[] = []) {
  const writes: string[][] = [];
  let ids = initial;
  return {
    writes,
    store: {
      read: () => ids,
      write: (next: string[]) => {
        writes.push(next);
        ids = next;
      },
    },
  };
}

describe("waiveRow / unwaiveRow", () => {
  test("waive adds the id once; a second waive writes nothing and reports no change", () => {
    const { store, writes } = fakeStore();
    expect(waiveRow("tool.fast-browser-extension", store)).toEqual({ waived: ["tool.fast-browser-extension"], changed: true });
    expect(waiveRow("tool.fast-browser-extension", store)).toEqual({ waived: ["tool.fast-browser-extension"], changed: false });
    expect(writes).toEqual([["tool.fast-browser-extension"]]);
  });

  test("unwaive removes the id; unwaiving an absent id writes nothing and reports no change", () => {
    const { store, writes } = fakeStore(["tool.fast-browser-extension"]);
    expect(unwaiveRow("tool.fast-browser-extension", store)).toEqual({ waived: [], changed: true });
    expect(unwaiveRow("tool.fast-browser-extension", store)).toEqual({ waived: [], changed: false });
    expect(writes).toEqual([[]]);
  });

  test("an id that is not finish-gated is a user error, and nothing is written", () => {
    const { store, writes } = fakeStore();
    expect(() => waiveRow("tool.chrome", store)).toThrow(UserActionableError);
    expect(() => unwaiveRow("tool.chrome", store)).toThrow(UserActionableError);
    expect(writes).toEqual([]);
  });

  test("the real store round-trips through the machine scope", () => {
    const store = realWaiverStore();
    waiveRow("tool.fast-browser-extension", store);
    expect(readWaived()).toEqual(["tool.fast-browser-extension"]);
    expect(getSetting(WAIVED_SETTING_KEY).provenance.map((p) => p.scope)).toEqual(["machine"]);
    unwaiveRow("tool.fast-browser-extension", store);
    expect(readWaived()).toEqual([]);
  });
});

describe("non-waivable finish gates", () => {
  const style = row({ id: "skills.writing-style", kind: "tool", title: "Writing style", why: "x", required: false, status: "needs-you", detail: "d", finishGated: true });
  const ext = row({ id: "tool.fast-browser-extension", kind: "tool", title: "Ext", why: "x", required: false, status: "needs-you", detail: "d", finishGated: true });
  const groups = [{ id: "tools" as const, title: "Tools", rows: [style, ext] }];

  test("only the Fast Browser row is waivable", () => {
    expect(WAIVABLE_ROW_IDS).toEqual(["tool.fast-browser-extension"]);
  });

  test("a stored waiver for a non-waivable row is ignored where the gate is read", () => {
    const waived = ["skills.writing-style", "tool.fast-browser-extension"];
    expect(finishBlockers(groups, waived)).toEqual(["skills.writing-style"]);
    const applied = applyFinishGate(groups, "status", waived)[0]!.rows;
    expect(applied.find((r) => r.id === "skills.writing-style")?.waived).toBeFalsy();
    expect(applied.find((r) => r.id === "tool.fast-browser-extension")?.waived).toBe(true);
  });

  test("every finish-gated row carries waivable", () => {
    const applied = applyFinishGate(groups, "plan", [])[0]!.rows;
    expect(applied.map((r) => [r.id, r.waivable])).toEqual([["skills.writing-style", false], ["tool.fast-browser-extension", true]]);
  });

  test("waive refuses a finish-gated row that is not waivable", () => {
    const store = { ids: [] as string[], read() { return this.ids; }, write(ids: string[]) { this.ids = ids; } };
    expect(() => waiveRow("skills.writing-style", store)).toThrow(UserActionableError);
    expect(store.ids).toEqual([]);
  });
});
