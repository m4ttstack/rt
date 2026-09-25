import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { z } from "zod";
import { buildLock, checkLockAgainst, classifyLockDiff, LOCK_PATH, readBreakingChanges, toJsonSchema } from "../schema-lock.ts";

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

  test("integer widened to number is safe", () => {
    expect(kinds({ type: "integer" }, { type: "number" })).toEqual(["safe"]);
    expect(kinds({ type: "number" }, { type: "integer" })).toEqual(["breaking"]);
  });
});

describe("checkLockAgainst", () => {
  test("a breaking change needs a storeVersion bump and an acknowledgement; an absent previous lock is all safe", () => {
    const prev = lock({ type: "string" });
    expect(checkLockAgainst(prev, lock({ type: "number" }), {}).ok).toBe(false);
    expect(checkLockAgainst(prev, lock({ type: "number" }, 2), {}).ok).toBe(false);
    expect(checkLockAgainst(prev, lock({ type: "number" }, 2), { "t.k": "renamed the value" }).ok).toBe(true);
    expect(checkLockAgainst({}, lock({ type: "number" }), {}).ok).toBe(true);
  });

  test("a removed key has no storeVersion to bump, so an acknowledgement alone clears it", () => {
    const prev = lock({ type: "string" });
    expect(checkLockAgainst(prev, {}, {})).toMatchObject({ ok: false, problems: [expect.stringContaining("t.k")] });
    expect(checkLockAgainst(prev, {}, { "t.k": "folded into t.j" }).ok).toBe(true);
  });
});

describe("readBreakingChanges", () => {
  test("serves the committed acknowledgements file", () => {
    const committed = JSON.parse(readFileSync(new URL("../breaking-schema-changes.json", import.meta.url), "utf8"));
    expect(readBreakingChanges()).toEqual(committed);
  });
});
