import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { z } from "zod";
import { buildLock, checkLockAgainst, classifyLockDiff, LOCK_PATH, readBreakingChanges, toJsonSchema } from "../schema-lock.ts";
import { MIGRATION_STEPS, RENAMES } from "../migrations/index.ts";
import { MIGRATION_SCHEMAS } from "../migrations/schemas.ts";

describe("toJsonSchema", () => {
  test("uses input mode: a defaulted property is optional and loose objects allow extras", () => {
    const json = toJsonSchema(z.looseObject({ a: z.string().default("x"), b: z.number() }));
    expect(json.required).toEqual(["b"]);
    expect(json.additionalProperties).not.toBe(false);
  });
  test("strict objects forbid extras", () => {
    expect(toJsonSchema(z.strictObject({ a: z.string() })).additionalProperties).toBe(false);
  });
  test("carries .meta() through as annotations", () => {
    const json = toJsonSchema(z.record(z.string(), z.string()).meta({ labels: { key: "remote URL", value: "identity" } }));
    expect(json.labels).toEqual({ key: "remote URL", value: "identity" });
  });
});

describe("buildLock", () => {
  test("is sorted and matches the committed lock byte for byte", () => {
    const built = buildLock();
    expect(Object.keys(built)).toEqual([...Object.keys(built)].sort());
    expect(JSON.parse(readFileSync(LOCK_PATH, "utf8"))).toEqual(built);
  });
});

const obj = (props: Record<string, unknown>, required: string[] = [], extra: Record<string, unknown> = {}) => ({ type: "object", properties: props, required, ...extra });
const lock = (schema: Record<string, unknown>, storeVersion = 1) => ({ "t.k": { storeVersion, schema } });

describe("classifyLockDiff", () => {
  test("safe: key added, optional property added, enum value added, limit loosened, extras loosened", () => {
    expect(classifyLockDiff({}, lock(obj({})))[0]).toMatchObject({ kind: "safe" });
    expect(classifyLockDiff(lock(obj({})), lock(obj({ a: { type: "string" } })))[0]).toMatchObject({ kind: "safe" });
    expect(classifyLockDiff(lock({ enum: ["a"] }), lock({ enum: ["a", "b"] }))[0]).toMatchObject({ kind: "safe" });
    expect(classifyLockDiff(lock({ type: "number", minimum: 1 }), lock({ type: "number" }))[0]).toMatchObject({ kind: "safe" });
    expect(classifyLockDiff(lock(obj({}, [], { additionalProperties: false })), lock(obj({})))[0]).toMatchObject({ kind: "safe" });
  });

  test("breaking: key removed, property made required, type changed, enum value removed, limit tightened, extras tightened, pattern added", () => {
    expect(classifyLockDiff(lock(obj({})), {})[0]).toMatchObject({ kind: "breaking" });
    expect(classifyLockDiff(lock(obj({ a: { type: "string" } })), lock(obj({ a: { type: "string" } }, ["a"])))[0]).toMatchObject({ kind: "breaking" });
    expect(classifyLockDiff(lock({ type: "string" }), lock({ type: "number" }))[0]).toMatchObject({ kind: "breaking" });
    expect(classifyLockDiff(lock({ enum: ["a", "b"] }), lock({ enum: ["a"] }))[0]).toMatchObject({ kind: "breaking" });
    expect(classifyLockDiff(lock({ type: "number" }), lock({ type: "number", minimum: 1 }))[0]).toMatchObject({ kind: "breaking" });
    expect(classifyLockDiff(lock(obj({})), lock(obj({}, [], { additionalProperties: false })))[0]).toMatchObject({ kind: "breaking" });
    expect(classifyLockDiff(lock({ type: "string" }), lock({ type: "string", pattern: "^x" }))[0]).toMatchObject({ kind: "breaking" });
  });

  test("property removed is safe when extras are allowed and breaking when not", () => {
    expect(classifyLockDiff(lock(obj({ a: { type: "string" } })), lock(obj({})))[0]).toMatchObject({ kind: "safe" });
    expect(classifyLockDiff(lock(obj({ a: { type: "string" } }, [], { additionalProperties: false })), lock(obj({}, [], { additionalProperties: false })))[0]).toMatchObject({ kind: "breaking" });
  });

  test("unknown keyword: unchanged is safe, changed is breaking; annotations are ignored", () => {
    expect(classifyLockDiff(lock({ type: "string", contentMediaType: "x" }), lock({ type: "string", contentMediaType: "x" }))).toEqual([]);
    expect(classifyLockDiff(lock({ type: "string", contentMediaType: "x" }), lock({ type: "string", contentMediaType: "y" }))[0]).toMatchObject({ kind: "breaking" });
    expect(classifyLockDiff(lock({ type: "string", description: "a" }), lock({ type: "string", description: "b", placeholder: "p" }))).toEqual([]);
  });

  test("enum of one and const are the same", () => {
    expect(classifyLockDiff(lock({ enum: ["human"] }), lock({ const: "human" }))).toEqual([]);
  });

  const kinds = (prev: Record<string, unknown>, next: Record<string, unknown>) => classifyLockDiff(lock(prev), lock(next)).map((c) => c.kind);

  test("adding a constraint where there was none is breaking; dropping one is safe", () => {
    expect(kinds({}, { type: "string" })).toEqual(["breaking"]);
    expect(kinds({ type: "string" }, {})).toEqual(["safe"]);
    expect(kinds({ enum: ["a", "b"] }, {})).toEqual(["safe"]);
    expect(kinds({ type: "array", items: { type: "string" } }, { type: "array" })).toEqual(["safe"]);
    expect(kinds({ anyOf: [{ type: "string" }, { type: "number" }] }, {})).toEqual(["safe"]);
  });

  test("a const widened to an enum that keeps its value is safe only", () => {
    expect(kinds({ const: "a" }, { enum: ["a", "b"] })).toEqual(["safe"]);
    expect(kinds({ const: "a" }, { const: "b" })).toEqual(["breaking"]);
  });

  test("an extras schema counts as closed; {} and true count as open", () => {
    expect(kinds(obj({}, [], { additionalProperties: { type: "string" } }), obj({}, [], { additionalProperties: {} }))).toEqual(["safe"]);
    expect(kinds(obj({}, [], { additionalProperties: {} }), obj({}, [], { additionalProperties: { type: "string" } }))).toEqual(["breaking"]);
    expect(kinds(obj({ a: { type: "number" } }, [], { additionalProperties: {} }), obj({}, [], { additionalProperties: {} }))).toEqual(["safe"]);
    expect(kinds(obj({ a: { type: "number" } }, [], { additionalProperties: { type: "string" } }), obj({}, [], { additionalProperties: { type: "string" } }))).toEqual(["breaking"]);
    expect(kinds(obj({}, [], { additionalProperties: { type: "string" } }), obj({}, [], { additionalProperties: { type: ["string", "number"] } }))).toEqual(["safe"]);
  });

  test("anyOf is safe when every old branch still fits a new one", () => {
    expect(kinds({ anyOf: [obj({})] }, { anyOf: [obj({ a: { type: "string" } }), { type: "null" }] })).toEqual(["safe"]);
    expect(kinds({ anyOf: [{ type: "string" }, { type: "null" }] }, { anyOf: [{ type: "string" }] })).toEqual(["breaking"]);
  });

  test("one case per remaining keyword rule", () => {
    expect(kinds({ type: "string" }, { type: ["string", "null"] })).toEqual(["safe"]);
    expect(kinds({ type: "string", pattern: "^x" }, { type: "string" })).toEqual(["safe"]);
    expect(kinds({ type: "string" }, { type: "string", format: "uri" })).toEqual(["breaking"]);
    expect(kinds({ type: "string", format: "uri" }, { type: "string", format: "email" })).toEqual(["breaking"]);
    expect(kinds({ type: "string", format: "uri" }, { type: "string" })).toEqual(["safe"]);
    expect(kinds({ type: "string", maxLength: 10 }, { type: "string", maxLength: 5 })).toEqual(["breaking"]);
    expect(kinds({ type: "number", maximum: 10 }, { type: "number", maximum: 5 })).toEqual(["breaking"]);
    expect(kinds({ type: "object", propertyNames: { type: "string" } }, { type: "object", propertyNames: { type: "string", pattern: "^a" } })).toEqual(["breaking"]);
    expect(kinds({ type: "object", propertyNames: { type: "string", pattern: "^a" } }, { type: "object" })).toEqual(["safe"]);
    expect(kinds({ type: "array", prefixItems: [{ type: "string" }] }, { type: "array", prefixItems: [{ type: "number" }] })).toEqual(["breaking"]);
  });

  test("oneOf: a branch added or removed is breaking, dropping oneOf entirely is safe", () => {
    expect(kinds({ oneOf: [{ type: "string" }, { type: "number" }] }, { oneOf: [{ type: "string" }] })).toEqual(["breaking"]);
    expect(kinds({ oneOf: [{ type: "number" }] }, { oneOf: [{ type: "number" }, { type: "integer" }] })).toEqual(["breaking"]);
    expect(kinds({ oneOf: [{ type: "number" }] }, {})).toEqual(["safe"]);
  });

  test("a property added under a closed extras schema is breaking; under open or false extras it is safe", () => {
    expect(kinds(obj({}, [], { additionalProperties: { type: "string" } }), obj({ a: { type: "number" } }, [], { additionalProperties: { type: "string" } }))).toEqual(["breaking"]);
    expect(kinds(obj({}, [], { additionalProperties: {} }), obj({ a: { type: "number" } }, [], { additionalProperties: {} }))).toEqual(["safe"]);
    expect(kinds(obj({}, [], { additionalProperties: false }), obj({ a: { type: "number" } }, [], { additionalProperties: false }))).toEqual(["safe"]);
  });

  test("rest tuple: dropping prefixItems lets items reach the prefixed elements, so it is breaking unless items is open", () => {
    const rest = { type: "array", prefixItems: [{ type: "string" }], items: { type: "number" } };
    expect(kinds(rest, { type: "array", items: { type: "number" } })).toEqual(["breaking"]);
    expect(kinds({ type: "array", prefixItems: [{ type: "string" }] }, { type: "array" })).toEqual(["safe"]);
  });

  test("integer widened to number is safe", () => {
    expect(kinds({ type: "integer" }, { type: "number" })).toEqual(["safe"]);
    expect(kinds({ type: "number" }, { type: "integer" })).toEqual(["breaking"]);
  });
});

describe("checkLockAgainst", () => {
  const entry = (schema: Record<string, unknown>, storeVersion = 1, migrateFrom?: Record<string, Record<string, unknown>>) => ({ storeVersion, schema, ...(migrateFrom ? { migrateFrom } : {}) });
  const V1 = { type: "string" };
  const V2 = { type: "number" };

  test("a breaking change with no migrateFrom entry fails, bumped or not, acknowledged or not", () => {
    expect(checkLockAgainst({ "t.k": entry(V1) }, { "t.k": entry(V2) }, {}).ok).toBe(false);
    expect(checkLockAgainst({ "t.k": entry(V1) }, { "t.k": entry(V2, 2) }, { "t.k": "why" }).problems).toEqual(["t.k: no migrateFrom entry for version 1"]);
  });

  test("a bump by one with an entry matching the previous lock passes", () => {
    expect(checkLockAgainst({ "t.k": entry(V1) }, { "t.k": entry(V2, 2, { "1": V1 }) }, {})).toEqual({ ok: true, problems: [] });
  });

  test("an entry that differs classifier-visibly from the previous lock fails", () => {
    const r = checkLockAgainst({ "t.k": entry(V1) }, { "t.k": entry(V2, 2, { "1": { type: "boolean" } }) }, {});
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toContain("differs from the lock on main");
  });

  test("an enum/const round trip, annotations and required order are not differences", () => {
    const prev = { "t.k": entry({ type: "object", properties: { who: { type: "string", const: "human", description: "who" }, n: { type: "number" } }, required: ["who", "n"] }) };
    const was = { type: "object", properties: { who: { type: "string", enum: ["human"] }, n: { type: "number" } }, required: ["n", "who"] };
    expect(checkLockAgainst(prev, { "t.k": entry(V2, 2, { "1": was }) }, {}).ok).toBe(true);
  });

  test("CI allows one step per change; release accepts a chain spanning two bumps since the tag", () => {
    const tag = { "t.k": entry(V1) };
    const next = { "t.k": entry({ type: "boolean" }, 3, { "1": V1, "2": V2 }) };
    expect(checkLockAgainst(tag, next, {}, { mode: "ci" }).ok).toBe(false);
    expect(checkLockAgainst(tag, next, {}, { mode: "release" })).toEqual({ ok: true, problems: [] });
    expect(checkLockAgainst(tag, { "t.k": entry({ type: "boolean" }, 3, { "2": V2 }) }, {}, { mode: "release" }).problems).toEqual(["t.k: no migrateFrom entry for version 1"]);
  });

  test("the acknowledgement hatch covers only a key absent from the shipped lock, and never at release", () => {
    const prev = { "t.k": entry(V1) };
    const next = { "t.k": entry(V2) };
    expect(checkLockAgainst(prev, next, { "t.k": "never released" }, { shipped: {} }).ok).toBe(true);
    expect(checkLockAgainst(prev, next, { "t.k": "never released" }, { shipped: prev }).ok).toBe(false);
    expect(checkLockAgainst(prev, next, { "t.k": "never released" }, { shipped: null }).ok).toBe(false);
    expect(checkLockAgainst(prev, next, { "t.k": "never released" }, { shipped: {}, mode: "release" }).ok).toBe(false);
  });

  test("a removed key passes when a key renamed from it keeps an equal schema, or when acknowledged", () => {
    const prev = { "t.old": entry(V1) };
    expect(checkLockAgainst(prev, {}, {}).ok).toBe(false);
    expect(checkLockAgainst(prev, {}, { "t.old": "retired" }).ok).toBe(true);
    expect(checkLockAgainst(prev, { "t.new": { ...entry(V1), renamedFrom: ["t.old"] } }, {}).ok).toBe(true);
    expect(checkLockAgainst(prev, { "t.new": { ...entry(V2), renamedFrom: ["t.old"] } }, {}).ok).toBe(false);
  });

  test("a storeVersion that goes down fails; an absent previous lock is all additions", () => {
    expect(checkLockAgainst({ "t.k": entry(V1, 2) }, { "t.k": entry(V1, 1) }, {}).ok).toBe(false);
    expect(checkLockAgainst({}, { "t.k": entry(V2) }, {}).ok).toBe(true);
  });
});

describe("migration schemas in the lock", () => {
  test("every runtime step has exactly one schema entry, and every schema entry a step", () => {
    const steps = MIGRATION_STEPS.map((s) => `${s.key}#${s.version}`).sort();
    const schemas = MIGRATION_SCHEMAS.map((m) => `${m.key}#${m.version}`).sort();
    expect(schemas).toEqual(steps);
    expect(new Set(schemas).size).toBe(schemas.length);
  });

  test("buildLock writes each step's source schema into its key's migrateFrom, and renames into renamedFrom", () => {
    MIGRATION_SCHEMAS.push({ key: "rt.eventRules", version: 1, schema: z.array(z.string()), examples: [] });
    RENAMES["rt.notify.eventBridges"] = ["rt.eventRules"];
    try {
      const built = buildLock()["rt.notify.eventBridges"]!;
      expect(built.migrateFrom?.["1"]).toMatchObject({ type: "array", items: { type: "string" } });
      expect(built.renamedFrom).toEqual(["rt.eventRules"]);
    } finally {
      MIGRATION_SCHEMAS.pop();
      delete RENAMES["rt.notify.eventBridges"];
    }
  });
});

describe("readBreakingChanges", () => {
  test("serves the committed acknowledgements file", () => {
    const committed = JSON.parse(readFileSync(new URL("../breaking-schema-changes.json", import.meta.url), "utf8"));
    expect(readBreakingChanges()).toEqual(committed);
  });
});
