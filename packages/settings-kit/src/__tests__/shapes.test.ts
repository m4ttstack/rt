import { describe, expect, test } from "bun:test";
import { allDefs, validateJson } from "@mattstack/rt-client";
import type { SettingDefWire } from "../server.ts";
import { LEGACY_SHAPES } from "./shapes-legacy-fixture.ts";
import {
  addToList, checkValue, ENUMS, filterDefs, getLeaf, isSet, matchesSchema, parseScalar,
  recognize, rowKind, setLeaf, SHAPES, summarize, targetScope, type CompositeShape,
} from "../shapes.ts";

function def(over: Partial<SettingDefWire> & { key: string }): SettingDefWire {
  return {
    type: "string", scopes: ["user"], merge: "replace", secret: false, teamLocked: false,
    repoScoped: false, writable: true, description: "", hasDefault: false, defaultValue: null,
    effective: { scope: null, file: null }, storeVersion: 1, ...over,
  };
}

const byKey = new Map(allDefs().map((d) => [d.key, d]));
const schemaOf = (key: string) => byKey.get(key)!.schema!;

describe("recognize", () => {
  test("reproduces every legacy shape: kind, fields, labels and fallbacks", () => {
    for (const [key, entry] of Object.entries(LEGACY_SHAPES)) {
      const legacy = entry as CompositeShape;
      if (legacy.kind === "external") continue;
      const r = recognize(schemaOf(key));
      expect(`${key}: ${r.kind}`).toBe(`${key}: ${legacy.kind}`);
      if (legacy.kind === "leaves" && r.kind === "leaves") {
        expect(r.fields).toEqual(legacy.fields);
        expect(r.placeholders).toEqual(legacy.fallbacks ?? {});
      }
      if (legacy.kind === "stringMap" && r.kind === "stringMap") expect(r.labels).toEqual([...legacy.labels]);
    }
  });

  test("an array of flat objects is an objectList with its required names", () => {
    const r = recognize(schemaOf("rt.notify.eventBridges"));
    expect(r.kind).toBe("objectList");
    if (r.kind === "objectList") expect(r.required).toEqual(["pattern", "category", "title", "message"]);
  });

  test("a map of flat objects is an objectMap", () => {
    const r = recognize({ type: "object", propertyNames: { type: "string" }, additionalProperties: { type: "object", properties: { port: { type: "number" }, dir: { type: "string" } }, required: ["port"] } });
    expect(r).toMatchObject({ kind: "objectMap", required: ["port"] });
  });

  test("anything deeper is json", () => {
    expect(recognize({ type: "object", properties: { a: { type: "object", properties: { b: { type: "array", items: { type: "object" } } } } } }).kind).toBe("json");
    expect(recognize(schemaOf("deck.apps")).kind).toBe("json");
    expect(recognize(undefined).kind).toBe("json");
  });
});

describe("checkValue", () => {
  test("matches the server's issue shape and messages", () => {
    const issues = checkValue({ type: "array", items: { type: "object", properties: { pattern: { type: "string" } }, required: ["pattern"] } }, [{ pattern: 1 }]);
    expect(issues).toEqual([{ path: [0, "pattern"], message: "expected string, got number" }]);
    expect(checkValue({ type: "object", properties: { a: { type: "string" } }, required: ["a"] }, {})).toEqual([{ path: ["a"], message: 'required property "a" is missing' }]);
  });

  test("record keys come back verbatim, not in their URI-encoded pointer form", () => {
    const map = { type: "object", additionalProperties: { type: "string" } };
    for (const key of ["remote:gitlab.example.com%2Facme%2Fapp", "/Users/dev/My App", "a~b/c", "café"]) {
      expect(checkValue(map, { [key]: 1 })[0]!.path).toEqual([key]);
    }
  });

  test("never drifts from rt-client's validateJson: same fixtures, same issues", () => {
    const ruleSchema = {
      type: "object",
      properties: { pattern: { type: "string" }, category: { type: "string" }, url: { type: "string" }, owner: { const: "human" } },
      required: ["pattern", "category"],
    };
    const listSchema = { type: "array", items: ruleSchema };
    const cases: [schema: Record<string, unknown>, value: unknown][] = [
      [listSchema, [{ pattern: 1, category: "gate" }]],
      [listSchema, [{ category: "gate" }]],
      [listSchema, [{ pattern: "x", category: "gate", owner: "herd" }]],
      [{ type: "number", minimum: 1 }, 0],
      [{ enum: ["a", "b"] }, "c"],
      [{ type: "object", properties: { a: { type: "string" } }, additionalProperties: false }, { a: "x", b: 1 }],
      [{ type: "object", additionalProperties: { type: "string" } }, { "remote:gitlab.example.com%2Facme%2Fapp": 1 }],
      [listSchema, [{ pattern: "gate/*", category: "gate", extra: true }]],
    ];
    for (const [schema, value] of cases) {
      expect(checkValue(schema, value)).toEqual(validateJson(schema, value));
    }
  });
});

describe("matchesSchema", () => {
  test("true only when the value matches the def's layer schema, false with no schema at all", () => {
    const d = def({ key: "rt.homeSnapshot", type: "object", merge: "deep", schema: { type: "object", properties: { enabled: { type: "boolean" } }, required: ["enabled"] }, layerSchema: { type: "object", properties: { enabled: { type: "boolean" } } } });
    expect(matchesSchema(d, { enabled: true })).toBe(true);
    expect(matchesSchema(d, { enabled: "yes" })).toBe(false);
    expect(matchesSchema(def({ key: "x.none" }), {})).toBe(false);
  });
});

describe("SHAPES", () => {
  test("holds only external keys", () => {
    for (const shape of Object.values(SHAPES)) expect(shape.kind).toBe("external");
  });
});

describe("ENUMS", () => {
  test("every ENUMS key is a registered string", () => {
    for (const key of Object.keys(ENUMS)) expect(byKey.get(key)?.type, key).toBe("string");
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
  test("composites dispatch on their recognized shape", () => {
    expect(rowKind(def({ key: "rt.repoRoots", type: "array", schema: { type: "array", items: { type: "string" } } }))).toBe("stringList");
    expect(rowKind(def({ key: "rt.homeSnapshot", type: "object", schema: { type: "object", properties: { enabled: { type: "boolean" } } } }))).toBe("leaves");
    expect(rowKind(def({ key: "rt.cron", type: "object", schema: { type: "object", properties: { triggers: { type: "array", items: {} } } } }))).toBe("json");
  });
  test("strings in ENUMS are enum, other scalars scalar", () => {
    expect(rowKind(def({ key: "rt.logLevel" }))).toBe("enum");
    expect(rowKind(def({ key: "board.title" }))).toBe("scalar");
  });
});

describe("summarize", () => {
  const stringListSchema = { type: "array", items: { type: "string" } };
  const stringMapSchema = { type: "object", propertyNames: { type: "string" }, additionalProperties: { type: "string" } };
  const gitStatusSchema = {
    type: "object",
    properties: { sweep: { type: "boolean" }, sweepIntervalSec: { type: "number" }, fetchIntervalSec: { type: "number" } },
  };

  test("stringList counts with a noun from the key", () => {
    expect(summarize(def({ key: "rt.repoRoots", type: "array", schema: stringListSchema, effective: { scope: "machine", file: null, value: ["a", "b"] } }))).toBe("2 roots");
    expect(summarize(def({ key: "board.ticketPrefixes", type: "array", schema: stringListSchema, effective: { scope: "team", file: null, value: ["RT"] } }))).toBe("1 prefix");
    expect(summarize(def({ key: "rt.repoRoots", type: "array", schema: stringListSchema }))).toBe("0 roots");
  });
  test("stringMap counts entries", () => {
    expect(summarize(def({ key: "rt.repoIdentityOverrides", type: "object", schema: stringMapSchema, effective: { scope: "machine", file: null, value: { a: "b" } } }))).toBe("1 entry");
  });
  test("replace-merged leaves count fields in the effective value", () => {
    expect(summarize(def({ key: "rt.gitStatus", type: "object", schema: gitStatusSchema, effective: { scope: "default", file: null, value: { sweep: true } } }))).toBe("1 of 3 set");
  });
  test("deep-merged leaves count only the fields a store layer authored", () => {
    const effective = { scope: "machine", file: "/f", value: { sweep: true, sweepIntervalSec: 60, fetchIntervalSec: 30 }, authored: { sweep: true } };
    expect(summarize(def({ key: "rt.gitStatus", type: "object", schema: gitStatusSchema, merge: "deep", effective }))).toBe("1 of 3 set");
  });
  test("deep-merged leaves with no authored layer read as none set", () => {
    const effective = { scope: "default", file: null, value: { sweep: true, sweepIntervalSec: 60, fetchIntervalSec: 30 } };
    expect(summarize(def({ key: "rt.gitStatus", type: "object", schema: gitStatusSchema, merge: "deep", effective }))).toBe("0 of 3 set");
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
