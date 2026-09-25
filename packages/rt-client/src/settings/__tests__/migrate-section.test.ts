/**
 * migrate.ts, one section: the current name wins, else the highest older
 * name is migrated in memory; older names beside a current one are labeled
 * leftover, stale or diverged against the $migrated baselines. Pure:
 * synthetic defs and plain section objects.
 */

import { describe, expect, test } from "bun:test";
import type { SettingDef } from "../registry-machinery.ts";
import { baselinesToRecord, canonicalJson, readSection, valueHash, worstLabel, type OlderNameRead } from "../migrate.ts";
import { renameProperty } from "../migrations/helpers.ts";

const def = (over: Partial<SettingDef>): SettingDef => ({ key: "t.k", type: "array", scopes: ["user"], merge: "replace", description: "test", ...over });

const SCHEMA_V2 = { type: "array", items: { type: "object", properties: { match: { type: "string" } }, required: ["match"] } };
const renameStep = { version: 1, up: (v: unknown) => renameProperty(v, ["[]"], "pattern", "match") };
const d = def({ storeVersion: 2, migrateFrom: [renameStep], schema: SCHEMA_V2 });

const V1 = [{ pattern: "gate/*" }];
const V2 = [{ match: "gate/*" }];
const V2_EDITED = [{ match: "herd/*" }];
const LAYER = { layer: true };

describe("readSection", () => {
  test("an absent section, or one without any name of the key, is not present", () => {
    expect(readSection(d, undefined, LAYER)).toEqual({ present: false, older: [] });
    expect(readSection(d, { "t.other": 1 }, LAYER)).toEqual({ present: false, older: [] });
  });

  test("the current name wins and carries no labels when alone", () => {
    expect(readSection(d, { "t.k@2": V2 }, LAYER)).toEqual({ present: true, storeName: "t.k@2", storedVersion: 2, value: V2, authored: V2, older: [] });
  });

  test("with the current name absent, the highest older name is migrated in memory", () => {
    expect(readSection(d, { "t.k": V1 }, LAYER)).toEqual({ present: true, storeName: "t.k", storedVersion: 1, value: V2, authored: V1, older: [] });
  });

  test("leftover: an older name whose migrated value equals the current value", () => {
    const older = readSection(d, { "t.k": V1, "t.k@2": V2 }, LAYER).older;
    expect(older).toEqual([{ storeName: "t.k", storedVersion: 1, label: "leftover", value: V2, authored: V1 }]);
  });

  test("stale: it differs, and its baseline matches its authored value", () => {
    const older = readSection(d, { "t.k": V1, "t.k@2": V2_EDITED, $migrated: { "t.k": valueHash(V1) } }, LAYER).older;
    expect(older[0]).toMatchObject({ label: "stale", value: V2, authored: V1 });
  });

  test("diverged: it differs and has no baseline, or a baseline that no longer matches", () => {
    expect(readSection(d, { "t.k": V1, "t.k@2": V2_EDITED }, LAYER).older[0]?.label).toBe("diverged");
    const edited = readSection(d, { "t.k": V1, "t.k@2": V2_EDITED, $migrated: { "t.k": valueHash([{ pattern: "old/*" }]) } }, LAYER);
    expect(edited.older[0]?.label).toBe("diverged");
  });

  test("two older names are labeled independently and the worst label wins", () => {
    const d3 = def({ storeVersion: 3, migrateFrom: [renameStep, { version: 2, up: (v) => v }], schema: SCHEMA_V2 });
    const read = readSection(d3, { "t.k": V1, "t.k@2": V2_EDITED, "t.k@3": V2 }, LAYER);
    expect(read.older.map((o) => [o.storeName, o.label])).toEqual([["t.k@2", "diverged"], ["t.k", "leftover"]]);
    expect(worstLabel(read.older)).toBe("diverged");
    const labels = (ls: OlderNameRead["label"][]) => ls.map((label) => ({ label }) as OlderNameRead);
    expect(worstLabel(labels(["leftover", "stale"]))).toBe("stale");
    expect(worstLabel([])).toBeUndefined();
  });

  test("a throwing step keeps the stored value in effect and names the step", () => {
    const bad = def({ storeVersion: 2, migrateFrom: [{ version: 1, up: () => { throw new Error("boom"); } }], schema: SCHEMA_V2 });
    expect(readSection(bad, { "t.k": V1 }, LAYER)).toMatchObject({ value: V1, authored: V1, migrationError: "migration 1 -> 2 threw: boom" });
  });

  test("a migrated value that fails the schema keeps the stored value in effect", () => {
    const wrong = def({ storeVersion: 2, migrateFrom: [{ version: 1, up: (v) => v }], schema: SCHEMA_V2 });
    const read = readSection(wrong, { "t.k": V1 }, LAYER);
    expect(read.value).toEqual(V1);
    expect(read.migrationError).toBe('migration 1 -> 2 gives a value that fails the schema: [0].match: required property "match" is missing');
  });

  test("a deep layer stays partial: the layer schema judges a migrated layer", () => {
    const deep = def({
      type: "object",
      merge: "deep",
      storeVersion: 2,
      migrateFrom: [{ version: 1, up: (v) => renameProperty(v, [], "on", "enabled") }],
      schema: { type: "object", properties: { enabled: { type: "boolean" }, debounceSec: { type: "number" } }, required: ["enabled", "debounceSec"] },
    });
    expect(readSection(deep, { "t.k": { on: true } }, { layer: true })).toMatchObject({ value: { enabled: true } });
    expect(readSection(deep, { "t.k": { on: true } }, { layer: true }).migrationError).toBeUndefined();
    expect(readSection(deep, { "t.k": { on: true } }, { layer: false }).migrationError).toContain("debounceSec");
  });

  test("a renamed key's name at the heir's version needs no step; older ones continue the chain", () => {
    expect(readSection(def({ renamedFrom: ["t.old"] }), { "t.old": [{ a: 1 }] }, LAYER)).toMatchObject({ storeName: "t.old", storedVersion: 1, value: [{ a: 1 }] });
    const heir = def({ storeVersion: 2, migrateFrom: [renameStep], renamedFrom: ["t.old"], schema: SCHEMA_V2 });
    expect(readSection(heir, { "t.old": V1 }, LAYER)).toMatchObject({ storeName: "t.old", value: V2 });
  });

  test("a step that mutates its input disturbs neither the authored value nor the label", () => {
    const mutating = def({
      storeVersion: 2,
      schema: SCHEMA_V2,
      migrateFrom: [{ version: 1, up: (v) => { for (const item of v as Record<string, unknown>[]) { item.match = item.pattern; delete item.pattern; } return v; } }],
    });
    const read = readSection(mutating, { "t.k": [{ pattern: "gate/*" }], "t.k@2": V2_EDITED, $migrated: { "t.k": valueHash(V1) } }, LAYER);
    expect(read.older[0]).toMatchObject({ label: "stale", authored: V1 });
  });
});

describe("hashing and baselines", () => {
  test("canonical JSON ignores key order; a hash is sha256: plus 16 hex", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
    expect(valueHash({ a: 1, b: 2 })).toBe(valueHash({ b: 2, a: 1 }));
    expect(valueHash([1])).toMatch(/^sha256:[0-9a-f]{16}$/);
  });

  test("the first write of the current name records a baseline for each present older name without one", () => {
    expect(baselinesToRecord(d, { "t.k": V1 })).toEqual({ "t.k": valueHash(V1) });
    expect(baselinesToRecord(d, { "t.k": V1, $migrated: { "t.k": "sha256:0000000000000000" } })).toEqual({});
    expect(baselinesToRecord(d, { "t.k": V1, "t.k@2": V2 })).toEqual({});
    expect(baselinesToRecord(d, {})).toEqual({});
    expect(baselinesToRecord(d, undefined)).toEqual({});
  });
});
