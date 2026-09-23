import { describe, expect, test } from "bun:test";
import { allDefs } from "@mattstack/rt-client";
import type { SettingDefWire } from "../server.ts";
import {
  addToList, ENUMS, filterDefs, getLeaf, isSet, matchesShape, parseScalar,
  rowKind, setLeaf, SHAPES, summarize, targetScope,
} from "../shapes.ts";

function def(over: Partial<SettingDefWire> & { key: string }): SettingDefWire {
  return {
    type: "string", scopes: ["user"], merge: "replace", secret: false, teamLocked: false,
    repoScoped: false, writable: true, description: "", hasDefault: false, defaultValue: null,
    effective: { scope: null, file: null }, ...over,
  };
}

describe("SHAPES", () => {
  test("every shaped key is registered and is an object or array", () => {
    const byKey = new Map(allDefs().map((d) => [d.key, d]));
    for (const key of Object.keys(SHAPES)) {
      const d = byKey.get(key);
      expect(d, key).toBeDefined();
      expect(["object", "array"]).toContain(d!.type);
    }
  });

  test("every ENUMS key is a registered string", () => {
    const byKey = new Map(allDefs().map((d) => [d.key, d]));
    for (const key of Object.keys(ENUMS)) expect(byKey.get(key)?.type, key).toBe("string");
  });

  test("each leaves shape accepts a fully typed sample and rejects a wrong-typed leaf", () => {
    for (const [key, shape] of Object.entries(SHAPES)) {
      if (shape.kind !== "leaves") continue;
      let sample: Record<string, unknown> = {};
      for (const [path, type] of Object.entries(shape.fields)) {
        const v = type === "string" ? "x" : type === "number" ? 1 : type === "boolean" ? true : type.enum[0];
        sample = setLeaf(sample, path, v);
      }
      expect(matchesShape(shape, sample), key).toBe(true);
      const [firstPath, firstType] = Object.entries(shape.fields)[0]!;
      const wrong = setLeaf(sample, firstPath, firstType === "number" ? "one" : 42);
      expect(matchesShape(shape, wrong), key).toBe(false);
    }
  });
});

describe("matchesShape", () => {
  test("stringList accepts only arrays of strings", () => {
    const s = SHAPES["board.projects"]!;
    expect(matchesShape(s, [])).toBe(true);
    expect(matchesShape(s, ["a/b"])).toBe(true);
    expect(matchesShape(s, ["a", 1])).toBe(false);
    expect(matchesShape(s, "a")).toBe(false);
  });

  test("pairList accepts arrays of objects carrying both string fields", () => {
    const s = { kind: "pairList", fields: ["project", "repo"] } as const;
    expect(matchesShape(s, [{ project: "g/p", repo: "host/x" }])).toBe(true);
    expect(matchesShape(s, [{ project: "g/p" }])).toBe(false);
    expect(matchesShape(s, [["g/p", "x"]])).toBe(false);
  });

  test("stringMap accepts a plain object of string values", () => {
    const s = SHAPES["rt.repoIdentityOverrides"]!;
    expect(matchesShape(s, {})).toBe(true);
    expect(matchesShape(s, { "https://example.dev/a.git": "a" })).toBe(true);
    expect(matchesShape(s, { "https://example.dev/a.git": 1 })).toBe(false);
    expect(matchesShape(s, [["a", "b"]])).toBe(false);
  });

  test("leaves passes unknown keys through and checks enums", () => {
    const s = SHAPES["board.triage"]!;
    expect(matchesShape(s, {})).toBe(true);
    expect(matchesShape(s, { enabled: true, fixClasses: { retryFlake: false }, notify: "rt" })).toBe(true);
    expect(matchesShape(s, { enabled: "yes" })).toBe(false);
    expect(matchesShape(s, { notify: "loud" })).toBe(false);
    expect(matchesShape(s, { doctorSkill: "x" })).toBe(true);
    expect(matchesShape(s, [])).toBe(false);
  });

  test("leaves refuses a present parent of a dotted path that is not a plain object", () => {
    const slack = SHAPES["board.slack"]!;
    expect(matchesShape(slack, { emoji: 5 })).toBe(false);
    expect(matchesShape(slack, { emoji: null })).toBe(false);
    expect(matchesShape(slack, {})).toBe(true);
    expect(matchesShape(slack, { emoji: { looking: "eyes" } })).toBe(true);
    const triage = SHAPES["board.triage"]!;
    expect(matchesShape(triage, { fixClasses: [] })).toBe(false);
    expect(matchesShape(triage, { fixClasses: "x" })).toBe(false);
  });
});

describe("leaf access", () => {
  test("getLeaf walks dotted paths and tolerates missing branches", () => {
    expect(getLeaf({ emoji: { looking: "eyes" } }, "emoji.looking")).toBe("eyes");
    expect(getLeaf({}, "emoji.looking")).toBeUndefined();
    expect(getLeaf(undefined, "channel")).toBeUndefined();
  });

  test("setLeaf copies, creates intermediates, and removes on undefined", () => {
    const before = { channel: "reviews", emoji: { looking: "eyes" } };
    expect(setLeaf(before, "emoji.approved", "ok")).toEqual({ channel: "reviews", emoji: { looking: "eyes", approved: "ok" } });
    expect(before).toEqual({ channel: "reviews", emoji: { looking: "eyes" } });
    expect(setLeaf({ a: 1, b: 2 }, "a", undefined)).toEqual({ b: 2 });
  });
});

describe("scalars and lists", () => {
  test("parseScalar", () => {
    expect(parseScalar("string", " a ")).toEqual({ ok: true, value: " a " });
    expect(parseScalar("number", "12")).toEqual({ ok: true, value: 12 });
    expect(parseScalar("number", "")).toEqual({ ok: false, error: "enter a number" });
    expect(parseScalar("number", "1x")).toEqual({ ok: false, error: "not a number" });
  });

  test("addToList trims, drops empties, and refuses duplicates", () => {
    expect(addToList(["a"], " b ")).toEqual(["a", "b"]);
    expect(addToList(["a"], "  ")).toBeNull();
    expect(addToList(["a"], "a")).toBeNull();
  });

  test("filterDefs matches key or description, case-insensitively", () => {
    const defs = [def({ key: "rt.logLevel", description: "Daemon log level" }), def({ key: "board.title", description: "Title" })];
    expect(filterDefs(defs, "")).toHaveLength(2);
    expect(filterDefs(defs, "LOG").map((d) => d.key)).toEqual(["rt.logLevel"]);
    expect(filterDefs(defs, "title").map((d) => d.key)).toEqual(["board.title"]);
  });
});

describe("rowKind", () => {
  test("external wins even when unwritable", () => {
    expect(rowKind(def({ key: "board.members", type: "array", writable: false }))).toBe("external");
  });
  test("secrets and unwritable keys are read-only", () => {
    expect(rowKind(def({ key: "x.secret", secret: true }))).toBe("readonly");
    expect(rowKind(def({ key: "x.locked", writable: false }))).toBe("readonly");
  });
  test("composites dispatch on their shape, or read-only with none", () => {
    expect(rowKind(def({ key: "rt.repoRoots", type: "array" }))).toBe("stringList");
    expect(rowKind(def({ key: "rt.homeSnapshot", type: "object" }))).toBe("leaves");
    expect(rowKind(def({ key: "rt.cron", type: "object" }))).toBe("readonly");
  });
  test("strings in ENUMS are enum, other scalars scalar", () => {
    expect(rowKind(def({ key: "rt.logLevel" }))).toBe("enum");
    expect(rowKind(def({ key: "board.title" }))).toBe("scalar");
  });
});

describe("summarize", () => {
  test("stringList counts with a noun from the key", () => {
    expect(summarize(def({ key: "rt.repoRoots", type: "array", effective: { scope: "machine", file: null, value: ["a", "b"] } }))).toBe("2 roots");
    expect(summarize(def({ key: "board.ticketPrefixes", type: "array", effective: { scope: "team", file: null, value: ["RT"] } }))).toBe("1 prefix");
    expect(summarize(def({ key: "rt.repoRoots", type: "array" }))).toBe("0 roots");
  });
  test("stringMap and pairList count entries", () => {
    expect(summarize(def({ key: "rt.repoIdentityOverrides", type: "object", effective: { scope: "machine", file: null, value: { a: "b" } } }))).toBe("1 entry");
  });
  test("leaves count set fields", () => {
    expect(summarize(def({ key: "rt.gitStatus", type: "object", effective: { scope: "default", file: null, value: { sweep: true } } }))).toBe("1 of 3 set");
  });
  test("no shape falls back to a generic count", () => {
    expect(summarize(def({ key: "rt.cron", type: "object", effective: { scope: "machine", file: null, value: { a: 1, b: 2 } } }))).toBe("2 fields");
    expect(summarize(def({ key: "rt.cron", type: "object" }))).toBe("unset");
  });
});

describe("isSet and targetScope", () => {
  test("isSet is true only for a real store layer", () => {
    expect(isSet(def({ key: "k", effective: { scope: "user", file: "/f" } }))).toBe(true);
    expect(isSet(def({ key: "k", effective: { scope: "default", file: null } }))).toBe(false);
    expect(isSet(def({ key: "k" }))).toBe(false);
  });
  test("targetScope is the winning layer when allowed, else the first scope", () => {
    const scopes = ["user", "machine"] as SettingDefWire["scopes"];
    expect(targetScope(def({ key: "k", scopes, effective: { scope: "machine", file: "/f" } }))).toBe("machine");
    expect(targetScope(def({ key: "k", scopes, effective: { scope: "default", file: null } }))).toBe("user");
    expect(targetScope(def({ key: "k", scopes, effective: { scope: "team", file: "/f" } }))).toBe("user");
    expect(targetScope(def({ key: "k", scopes }))).toBe("user");
  });
});
