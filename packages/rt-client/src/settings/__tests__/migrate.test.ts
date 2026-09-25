/**
 * migrate.ts, names and chain: versioned store names, how a stored name is
 * classified, which older names a def can read, and the migration chain.
 * Pure: synthetic defs, except where a name must resolve through the live
 * registry (withMigration restores the def afterward).
 */

import { describe, expect, test } from "bun:test";
import type { MigrationStep, SettingDef } from "../registry-machinery.ts";
import { chainProblem, currentStoreName, olderStoreNames, parseStoreName, runChain, storeNameFor, storeNameStatus } from "../migrate.ts";
import { deleteProperty, renameProperty, setDefault } from "../migrations/helpers.ts";
import { withMigration } from "./with-migration.ts";

const def = (over: Partial<SettingDef>): SettingDef => ({ key: "t.k", type: "object", scopes: ["user"], merge: "replace", description: "test", ...over });
const step = (version: number, up: (v: unknown) => unknown = (v) => v): MigrationStep => ({ version, up });

describe("store names", () => {
  test("version 1 is the bare key, above it the key carries @N", () => {
    expect(storeNameFor("t.k", 1)).toBe("t.k");
    expect(storeNameFor("t.k", 3)).toBe("t.k@3");
    expect(currentStoreName(def({ storeVersion: 2 }))).toBe("t.k@2");
    expect(currentStoreName(def({}))).toBe("t.k");
  });

  test("parseStoreName splits a trailing @N and reads anything else as a version 1 name", () => {
    expect(parseStoreName("rt.roles@2")).toEqual({ key: "rt.roles", version: 2 });
    expect(parseStoreName("rt.roles")).toEqual({ key: "rt.roles", version: 1 });
    expect(parseStoreName("rt.roles@0")).toEqual({ key: "rt.roles@0", version: 1 });
  });

  test("olderStoreNames lists readable versions highest first, the key's own name before renamed keys", () => {
    const d = def({ storeVersion: 3, migrateFrom: [step(1), step(2)], renamedFrom: ["t.old"] });
    expect(olderStoreNames(d)).toEqual([
      { name: "t.old@3", version: 3 },
      { name: "t.k@2", version: 2 },
      { name: "t.old@2", version: 2 },
      { name: "t.k", version: 1 },
      { name: "t.old", version: 1 },
    ]);
  });

  test("a version with no step is not readable", () => {
    expect(olderStoreNames(def({ storeVersion: 3, migrateFrom: [step(2)] })).map((o) => o.name)).toEqual(["t.k@2"]);
    expect(olderStoreNames(def({}))).toEqual([]);
  });
});

describe("storeNameStatus", () => {
  test("classifies metadata, current, older, newer, retired and unknown names", () => {
    withMigration("rt.notify.eventBridges", { storeVersion: 2, migrateFrom: [step(1)] }, () => {
      expect(storeNameStatus("$migrated")).toBe("metadata");
      expect(storeNameStatus("rt.notify.eventBridges@2")).toBe("current");
      expect(storeNameStatus("rt.notify.eventBridges")).toBe("older");
      expect(storeNameStatus("rt.notify.eventBridges@3")).toBe("newer");
      expect(storeNameStatus("rt.notify.eventBridges@1")).toBe("unknown");
      expect(storeNameStatus("mattstack.mode")).toBe("retired");
      expect(storeNameStatus("t.nothing")).toBe("unknown");
    });
  });

  test("a renamed key's names are older names of its heir, above the heir's version newer", () => {
    withMigration("rt.notify.eventBridges", { renamedFrom: ["rt.eventRules"] }, () => {
      expect(storeNameStatus("rt.eventRules")).toBe("older");
      expect(storeNameStatus("rt.eventRules@2")).toBe("newer");
    });
  });
});

describe("chainProblem", () => {
  test("an unbroken chain to storeVersion, or no chain at version 1, passes", () => {
    expect(chainProblem(def({ storeVersion: 3, migrateFrom: [step(1), step(2)] }))).toBeNull();
    expect(chainProblem(def({ storeVersion: 3, migrateFrom: [step(2)] }))).toBeNull();
    expect(chainProblem(def({}))).toBeNull();
  });

  test("a gap, an overlap, a backwards step and a bump with no step are rejected", () => {
    expect(chainProblem(def({ storeVersion: 4, migrateFrom: [step(1), step(3)] }))).toContain("no migration from version 2");
    expect(chainProblem(def({ storeVersion: 2, migrateFrom: [step(1), step(1)] }))).toContain("two migrations from version 1");
    expect(chainProblem(def({ storeVersion: 2, migrateFrom: [step(1), step(2)] }))).toContain("not below storeVersion 2");
    expect(chainProblem(def({ storeVersion: 3, migrateFrom: [step(1)] }))).toContain("no migration from version 2 to 3");
    expect(chainProblem(def({ storeVersion: 2 }))).toContain("with no migration");
  });
});

describe("runChain", () => {
  const d = def({ storeVersion: 3, migrateFrom: [step(1, (v) => ({ ...(v as object), a: 1 })), step(2, (v) => ({ ...(v as object), b: 2 }))] });

  test("runs every step from the stored version up to storeVersion", () => {
    expect(runChain(d, {}, 1)).toEqual({ ok: true, value: { a: 1, b: 2 } });
    expect(runChain(d, {}, 2)).toEqual({ ok: true, value: { b: 2 } });
    expect(runChain(d, { z: 0 }, 3)).toEqual({ ok: true, value: { z: 0 } });
  });

  test("a throwing step is named", () => {
    const bad = def({ storeVersion: 2, migrateFrom: [step(1, () => { throw new Error("boom"); })] });
    expect(runChain(bad, {}, 1)).toEqual({ ok: false, message: "migration 1 -> 2 threw: boom" });
  });

  test("a step that mutates its input leaves the caller's value alone", () => {
    const mutating = def({ storeVersion: 2, migrateFrom: [step(1, (v) => { (v as Record<string, unknown>).x = 9; return v; })] });
    const authored = { x: 1 };
    expect(runChain(mutating, authored, 1)).toEqual({ ok: true, value: { x: 9 } });
    expect(authored).toEqual({ x: 1 });
  });
});

describe("migration helpers", () => {
  test("renameProperty walks array items and leaves items without the property alone", () => {
    expect(renameProperty([{ pattern: "a", x: 1 }, { x: 2 }], ["[]"], "pattern", "match")).toEqual([{ x: 1, match: "a" }, { x: 2 }]);
  });

  test("deleteProperty walks record values", () => {
    expect(deleteProperty({ a: { keep: 1, drop: 2 }, b: { keep: 3 } }, ["{}"], "drop")).toEqual({ a: { keep: 1 }, b: { keep: 3 } });
  });

  test("setDefault fills only a missing property and ignores a missing parent", () => {
    expect(setDefault({ inner: { a: 1 } }, ["inner"], "b", 2)).toEqual({ inner: { a: 1, b: 2 } });
    expect(setDefault({ inner: { b: 5 } }, ["inner"], "b", 2)).toEqual({ inner: { b: 5 } });
    expect(setDefault({}, ["inner"], "b", 2)).toEqual({});
  });

  test("helpers never mutate their input", () => {
    const input = [{ pattern: "a" }];
    renameProperty(input, ["[]"], "pattern", "match");
    expect(input).toEqual([{ pattern: "a" }]);
  });
});
