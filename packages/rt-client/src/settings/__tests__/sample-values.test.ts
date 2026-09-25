/**
 * sampleValues: deterministic samples that pass the schema they came from,
 * wide enough to exercise a migration: minimal and full objects, every enum
 * value and union branch, short arrays, records, extras.
 */

import { describe, expect, test } from "bun:test";
import { allDefs } from "../registry-machinery.ts";
import { hasSchema, validateJson } from "../schema.ts";
import { sampleValues } from "../sample-values.ts";

const SHAPE = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["a", "b"] },
    n: { anyOf: [{ type: "string" }, { type: "number" }] },
    tags: { type: "array", items: { type: "string" }, minItems: 1 },
    env: { type: "object", propertyNames: { type: "string" }, additionalProperties: { type: "string" } },
  },
  required: ["kind"],
  additionalProperties: {},
};

describe("sampleValues", () => {
  test("every sample passes the schema it came from", () => {
    const samples = sampleValues(SHAPE);
    expect(samples.length).toBeGreaterThan(3);
    for (const s of samples) expect(validateJson(SHAPE, s)).toEqual([]);
  });

  test("covers the minimal object, every enum value, every union branch, records and extras", () => {
    const samples = sampleValues(SHAPE) as Record<string, unknown>[];
    expect(samples).toContainEqual({ kind: "a" });
    expect(samples.some((s) => s.kind === "b")).toBe(true);
    expect(samples.some((s) => typeof s.n === "string")).toBe(true);
    expect(samples.some((s) => typeof s.n === "number")).toBe(true);
    expect(samples.some((s) => s.env !== undefined && Object.keys(s.env as object).length > 0)).toBe(true);
    expect(samples.some((s) => "extraProperty" in s)).toBe(true);
  });

  test("is deterministic", () => {
    expect(sampleValues(SHAPE)).toEqual(sampleValues(SHAPE));
  });

  test("a pattern it cannot satisfy yields no sample rather than a wrong one", () => {
    expect(sampleValues({ type: "string", pattern: "^[0-9]{6}$" })).toEqual([]);
  });

  test("every registry schema, and every deep key's layer schema, yields at least one sample", () => {
    const empty = allDefs()
      .filter(hasSchema)
      .filter((d) => sampleValues(d.schema).length === 0 || (d.layerSchema !== undefined && sampleValues(d.layerSchema).length === 0))
      .map((d) => d.key);
    expect(empty).toEqual([]);
  });

  test("a property anyOf [wide object, null] yields a null variant", () => {
    const fields = ["a", "b", "c", "d", "e", "f", "g"];
    const wide = { type: "object", properties: Object.fromEntries(fields.map((k) => [k, { type: "string" }])), required: fields, additionalProperties: {} };
    const schema = { type: "object", properties: { x: { anyOf: [wide, { type: "null" }] } }, required: ["x"] };
    const samples = sampleValues(schema) as Record<string, unknown>[];
    expect(samples.some((s) => s.x === null)).toBe(true);
  });

  test("an 8-value property enum yields all 8", () => {
    const values = ["v1", "v2", "v3", "v4", "v5", "v6", "v7", "v8"];
    const schema = { type: "object", properties: { kind: { type: "string", enum: values } }, required: ["kind"] };
    const samples = sampleValues(schema) as Record<string, unknown>[];
    for (const v of values) expect(samples.some((s) => s.kind === v)).toBe(true);
  });

  test("a union nested under additionalProperties yields each branch", () => {
    const schema = {
      type: "object",
      additionalProperties: {
        anyOf: [{ type: "string" }, { type: "boolean" }, { type: "object", properties: { z: { type: "string" } }, required: ["z"], additionalProperties: {} }],
      },
    };
    const values = (sampleValues(schema) as Record<string, unknown>[]).flatMap((s) => Object.values(s));
    expect(values.some((v) => typeof v === "string")).toBe(true);
    expect(values.some((v) => typeof v === "boolean")).toBe(true);
    expect(values.some((v) => typeof v === "object" && v !== null && "z" in (v as object))).toBe(true);
  });

  test("two constrained required properties next to an enum: every enum value appears", () => {
    const schema = {
      type: "object",
      properties: {
        port: { type: "integer", exclusiveMinimum: 0 },
        name: { type: "string", minLength: 1 },
        mode: { type: "string", enum: ["a", "b", "c"] },
      },
      required: ["port", "name", "mode"],
    };
    const samples = sampleValues(schema) as Record<string, unknown>[];
    expect(samples.length).toBeGreaterThan(0);
    for (const v of ["a", "b", "c"]) expect(samples.some((s) => s.mode === v)).toBe(true);
  });
});
