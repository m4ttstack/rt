/**
 * proveMigration: samples of a step's source schema, run up the chain, must
 * land in the current schema (layer schema for layer samples). A wrong or
 * throwing migration fails; so does every registered step that does not
 * carry its samples.
 */

import { describe, expect, test } from "bun:test";
import { getDef, type SettingDef } from "../registry-machinery.ts";
import type { JsonSchema } from "../schema.ts";
import { renamedHeir } from "../migrate.ts";
import { renameProperty } from "../migrations/helpers.ts";
import { MIGRATION_SCHEMAS } from "../migrations/schemas.ts";
import { toJsonSchema } from "../schema-lock.ts";
import { proveMigration } from "../migration-proof.ts";

type Proven = SettingDef & { schema: JsonSchema };
const def = (over: Partial<SettingDef>): Proven => ({ key: "t.k", type: "array", scopes: ["user"], merge: "replace", description: "test", schema: {}, ...over }) as Proven;

const V1_ITEMS = { type: "array", items: { type: "object", properties: { pattern: { type: "string" }, title: { type: "string" } }, required: ["pattern", "title"], additionalProperties: {} } };
const V2_ITEMS = { type: "array", items: { type: "object", properties: { match: { type: "string" }, title: { type: "string" } }, required: ["match", "title"], additionalProperties: {} } };
const rename = { version: 1, up: (v: unknown) => renameProperty(v, ["[]"], "pattern", "match") };

const SNAP_V1 = { type: "object", properties: { on: { type: "boolean" }, debounceSec: { type: "number" } }, required: ["on", "debounceSec"], additionalProperties: {} };
const SNAP_V2 = { type: "object", properties: { enabled: { type: "boolean" }, debounceSec: { type: "number" } }, required: ["enabled", "debounceSec"], additionalProperties: {} };

describe("proveMigration", () => {
  test("a correct migration passes over its samples", () => {
    expect(proveMigration(def({ storeVersion: 2, schema: V2_ITEMS, migrateFrom: [rename] }), 1, V1_ITEMS, [])).toEqual([]);
  });

  test("a wrong migration fails, naming the path", () => {
    const failures = proveMigration(def({ storeVersion: 2, schema: V2_ITEMS, migrateFrom: [{ version: 1, up: (v) => v }] }), 1, V1_ITEMS, []);
    expect(failures.length).toBeGreaterThan(0);
    expect(failures[0]!.message).toContain('required property "match" is missing');
  });

  test("a throwing migration fails with the step named", () => {
    const failures = proveMigration(def({ storeVersion: 2, schema: V2_ITEMS, migrateFrom: [{ version: 1, up: () => { throw new Error("boom"); } }] }), 1, V1_ITEMS, []);
    expect(failures[0]!.message).toBe("migration 1 -> 2 threw: boom");
  });

  test("a correct deep migration passes over full samples (on the default) and layer samples", () => {
    const deep = def({ type: "object", merge: "deep", default: { enabled: false, debounceSec: 5 }, storeVersion: 2, schema: SNAP_V2, migrateFrom: [{ version: 1, up: (v) => renameProperty(v, [], "on", "enabled") }] });
    expect(proveMigration(deep, 1, SNAP_V1, [])).toEqual([]);
  });

  test("a wrong deep migration fails on a layer sample", () => {
    const v1 = { ...SNAP_V2, properties: { enabled: { type: "boolean" }, debounceSec: { type: "string" } } };
    const deep = def({ type: "object", merge: "deep", default: { enabled: false, debounceSec: 5 }, storeVersion: 2, schema: SNAP_V2, migrateFrom: [{ version: 1, up: (v) => v }] });
    expect(proveMigration(deep, 1, v1, []).some((f) => f.layer)).toBe(true);
  });

  test("a source schema no sample can satisfy needs examples", () => {
    const d = def({ type: "string", storeVersion: 2, schema: { type: "number" }, migrateFrom: [{ version: 1, up: (v) => Number(v) }] });
    expect(proveMigration(d, 1, { type: "string", pattern: "^[0-9]{6}$" }, [])[0]!.message).toBe("no sample value passes the version 1 schema; add examples");
    expect(proveMigration(d, 1, { type: "string", pattern: "^[0-9]{6}$" }, ["123456"])).toEqual([]);
  });
});

describe("registered migrations", () => {
  test("every registered step lands every sample and example in the current schema", () => {
    for (const m of MIGRATION_SCHEMAS) {
      const d = getDef(m.key) ?? renamedHeir(m.key);
      expect(d?.schema, `${m.key}: no current schema`).toBeDefined();
      expect(proveMigration(d as Proven, m.version, toJsonSchema(m.schema), m.examples), `${m.key} from version ${m.version}`).toEqual([]);
    }
  });
});
