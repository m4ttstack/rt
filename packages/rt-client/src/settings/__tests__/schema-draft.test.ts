/**
 * Drafting: one case per row of spec 3's drafting table, the insertion into
 * the two migration files, and spec 3's first acceptance bullet on the real
 * rt.notify.eventBridges lock entry.
 */

import { describe, expect, test } from "bun:test";
import { z } from "zod";
import LOCK from "../schema.lock.json" with { type: "json" };
import * as helpers from "../migrations/helpers.ts";
import { checkLockAgainst, equivalentSchemas, type Lock } from "../schema-diff.ts";
import { toJsonSchema } from "../schema-lock.ts";
import { applyDrafts, draftMigrations, type Draft } from "../schema-draft.ts";

const evalUp = (src: string) =>
  new Function("renameProperty", "deleteProperty", "setDefault", `return ${src};`)(helpers.renameProperty, helpers.deleteProperty, helpers.setDefault) as (v: unknown) => unknown;
const rebuild = (src: string) => new Function("z", `return ${src};`)(z) as z.ZodType;
const obj = (properties: Record<string, unknown>, required: string[] = [], extra: Record<string, unknown> = {}) => ({
  type: "object",
  properties,
  ...(required.length > 0 ? { required } : {}),
  ...extra,
});
const str = { type: "string" };
const onlyStep = (drafts: Draft[]) => {
  expect(drafts).toHaveLength(1);
  const d = drafts[0]!;
  if (d.kind !== "step") throw new Error("expected a step draft");
  return d;
};

describe("draftMigrations", () => {
  test("a new required property with a default: the step sets the default", () => {
    const prev: Lock = { "t.k": { storeVersion: 1, schema: obj({ a: str }, ["a"]) } };
    const next: Lock = { "t.k": { storeVersion: 2, schema: obj({ a: str, b: { type: "number", default: 5 } }, ["a", "b"]) } };
    const d = onlyStep(draftMigrations(prev, next));
    expect(d.version).toBe(1);
    expect(evalUp(d.upSource)({ a: "x" })).toEqual({ a: "x", b: 5 });
    expect(d.notes).toEqual([]);
  });

  test("a property removed from a closed object: the step deletes it", () => {
    const prev: Lock = { "t.k": { storeVersion: 1, schema: obj({ a: str, b: str }, [], { additionalProperties: false }) } };
    const next: Lock = { "t.k": { storeVersion: 2, schema: obj({ a: str }, [], { additionalProperties: false }) } };
    expect(evalUp(onlyStep(draftMigrations(prev, next)).upSource)({ a: "x", b: "y" })).toEqual({ a: "x" });
  });

  test("a property removed from a closed object, when it was the only required property: the step still deletes it", () => {
    const prev: Lock = { "t.k": { storeVersion: 1, schema: obj({ a: str, b: str }, ["b"], { additionalProperties: false }) } };
    const next: Lock = { "t.k": { storeVersion: 2, schema: obj({ a: str }, [], { additionalProperties: false }) } };
    const d = onlyStep(draftMigrations(prev, next));
    expect(evalUp(d.upSource)({ a: "x", b: "y" })).toEqual({ a: "x" });
    expect(d.notes).toEqual([
      "drafted a delete of b: its stored values are dropped; if it was renamed, write a renameProperty instead",
    ]);
  });

  test("a property renamed while another is added to the same object: the drafted delete of the old name carries a note, since a rename plus an add looks the same as a plain delete plus an add", () => {
    const prev: Lock = { "t.k": { storeVersion: 1, schema: obj({ pattern: str, a: str }, ["pattern", "a"]) } };
    const next: Lock = {
      "t.k": { storeVersion: 2, schema: obj({ match: str, a: str, b: { type: "number", default: 5 } }, ["a", "b"]) },
    };
    const d = onlyStep(draftMigrations(prev, next));
    expect(evalUp(d.upSource)({ pattern: "p", a: "x" })).toEqual({ a: "x", b: 5 });
    expect(d.notes.join("\n")).toContain(
      "drafted a delete of pattern: its stored values are dropped; if it was renamed, write a renameProperty instead",
    );
  });

  test("a rename where the old property was the only required one and the new one is optional: the step still renames it", () => {
    const prev: Lock = { "t.k": { storeVersion: 1, schema: obj({ pattern: str }, ["pattern"], { additionalProperties: false }) } };
    const next: Lock = { "t.k": { storeVersion: 2, schema: obj({ match: str }, [], { additionalProperties: false }) } };
    const d = onlyStep(draftMigrations(prev, next));
    expect(evalUp(d.upSource)({ pattern: "p" })).toEqual({ match: "p" });
    expect(d.notes.join("\n")).toContain("confirm it is a rename");
  });

  test("one property removed and one of the same type added: a rename, flagged for confirmation", () => {
    const prev: Lock = { "t.k": { storeVersion: 1, schema: { type: "array", items: obj({ pattern: str, category: str }, ["pattern", "category"]) } } };
    const next: Lock = { "t.k": { storeVersion: 2, schema: { type: "array", items: obj({ match: str, category: str }, ["match", "category"]) } } };
    const d = onlyStep(draftMigrations(prev, next));
    expect(evalUp(d.upSource)([{ pattern: "p", category: "c" }])).toEqual([{ category: "c", match: "p" }]);
    expect(d.notes.join("\n")).toContain("confirm it is a rename");
  });

  test("a key renamed with an equal schema: a renamedFrom entry and no step", () => {
    const prev: Lock = { "t.old": { storeVersion: 1, schema: obj({ a: str }, ["a"]) } };
    const next: Lock = { "t.new": { storeVersion: 1, schema: obj({ a: str }, ["a"]) } };
    expect(draftMigrations(prev, next)).toEqual([{ kind: "rename", key: "t.new", from: "t.old", notes: [] }]);
  });

  test("anything else (an enum value removed): a step that throws TODO until written", () => {
    const prev: Lock = { "t.k": { storeVersion: 1, schema: { type: "string", enum: ["a", "b"] } } };
    const next: Lock = { "t.k": { storeVersion: 2, schema: { type: "string", enum: ["a"] } } };
    const d = onlyStep(draftMigrations(prev, next));
    expect(() => evalUp(d.upSource)("a")).toThrow("TODO");
    expect(d.notes.join("\n")).toContain("not mechanical");
  });

  test("a deep-merge key gets no default written into its layers", () => {
    const prev: Lock = { "t.k": { storeVersion: 1, schema: obj({ a: str }, ["a"]) } };
    const next: Lock = { "t.k": { storeVersion: 2, schema: obj({ a: str, b: { type: "number", default: 5 } }, ["a", "b"]) } };
    const d = onlyStep(draftMigrations(prev, next, () => true));
    expect(evalUp(d.upSource)({ a: "x" })).toEqual({ a: "x" });
    expect(d.notes.join("\n")).toContain("deep-merge key");
  });

  test("an unbumped key gets a note to bump it; an already drafted one is skipped", () => {
    const prev: Lock = { "t.k": { storeVersion: 1, schema: { type: "string", enum: ["a", "b"] } } };
    expect(onlyStep(draftMigrations(prev, { "t.k": { storeVersion: 1, schema: { type: "string", enum: ["a"] } } })).notes[0]).toContain("set storeVersion: 2");
    expect(draftMigrations(prev, { "t.k": { storeVersion: 2, schema: { type: "string", enum: ["a"] }, migrateFrom: { "1": prev["t.k"]!.schema } } })).toEqual([]);
  });

  test("the drafted source schema rebuilds to the previous lock's schema", () => {
    const was = obj({ pattern: str, n: { type: "number" } }, ["pattern"], { additionalProperties: {} });
    const d = onlyStep(draftMigrations({ "t.k": { storeVersion: 1, schema: was } }, { "t.k": { storeVersion: 2, schema: { type: "string" } } }));
    expect(equivalentSchemas(toJsonSchema(rebuild(d.schemaSource)), was)).toBe(true);
  });
});

describe("applyDrafts", () => {
  const INDEX = ["export const MIGRATION_STEPS = [", "  // @draft-steps", "];", "export const RENAMES = {", "  // @draft-renames", "};", ""].join("\n");
  const SCHEMAS = ["export const MIGRATION_SCHEMAS = [", "  // @draft-schemas", "];", ""].join("\n");

  test("inserts each draft above its marker at the marker's indentation", () => {
    const files = applyDrafts(
      [
        { kind: "step", key: "t.k", version: 1, schemaSource: "z.string()", upSource: "(value) => value", notes: [] },
        { kind: "rename", key: "t.new", from: "t.old", notes: [] },
      ],
      { index: INDEX, schemas: SCHEMAS },
    );
    expect(files.index).toBe(
      [
        "export const MIGRATION_STEPS = [",
        "  {",
        '    key: "t.k",',
        "    version: 1,",
        "    up: (value) => value,",
        "  },",
        "  // @draft-steps",
        "];",
        "export const RENAMES = {",
        '  "t.new": ["t.old"],',
        "  // @draft-renames",
        "};",
        "",
      ].join("\n"),
    );
    expect(files.schemas).toContain('    key: "t.k",\n    version: 1,\n    schema: z.string(),\n    examples: [],\n  },\n  // @draft-schemas');
  });

  test("a missing marker is an error", () => {
    expect(() => applyDrafts([{ kind: "rename", key: "t.new", from: "t.old", notes: [] }], { index: "export const X = 1;\n", schemas: SCHEMAS })).toThrow('draft marker "// @draft-renames" not found');
  });
});

describe("spec 3 acceptance: renaming a property on rt.notify.eventBridges", () => {
  test("CI fails until storeVersion is 2 with a migrateFrom entry; --draft proposes the rename; with it filled in, CI passes", () => {
    const key = "rt.notify.eventBridges";
    const was = (LOCK as Lock)[key]!;
    const renamed = structuredClone(was.schema) as { items: { properties: Record<string, unknown>; required: string[] } };
    renamed.items.properties = Object.fromEntries(Object.entries(renamed.items.properties).map(([k, v]) => [k === "pattern" ? "match" : k, v]));
    renamed.items.required = renamed.items.required.map((r) => (r === "pattern" ? "match" : r));
    const prev: Lock = { [key]: was };

    expect(checkLockAgainst(prev, { [key]: { storeVersion: 1, schema: renamed } }, {}).ok).toBe(false);
    const d = onlyStep(draftMigrations(prev, { [key]: { storeVersion: 2, schema: renamed } }));
    expect(d.version).toBe(1);
    expect(d.upSource).toContain('renameProperty(v, ["[]"], "pattern", "match")');
    const filled: Lock = { [key]: { storeVersion: 2, schema: renamed, migrateFrom: { "1": toJsonSchema(rebuild(d.schemaSource)) } } };
    expect(checkLockAgainst(prev, filled, {})).toEqual({ ok: true, problems: [] });
  });
});
