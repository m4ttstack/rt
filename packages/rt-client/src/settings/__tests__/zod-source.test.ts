/**
 * zodSource: zod source rebuilt from a lock's JSON Schema must convert back
 * to an equivalent schema, for every key in the committed lock, so a
 * drafted migrateFrom entry passes the CI acceptance rule unedited.
 */

import { describe, expect, test } from "bun:test";
import { z } from "zod";
import LOCK from "../schema.lock.json" with { type: "json" };
import { equivalentSchemas } from "../schema-diff.ts";
import { toJsonSchema } from "../schema-lock.ts";
import { zodSource } from "../zod-source.ts";

const rebuild = (src: string) => new Function("z", `return ${src};`)(z) as z.ZodType;
const roundTrips = (json: Record<string, unknown>) => equivalentSchemas(toJsonSchema(rebuild(zodSource(json))), json);

const FIXTURES: [Record<string, unknown>, string][] = [
  [{ type: "object", propertyNames: { type: "string" }, additionalProperties: { type: "string" } }, "z.record(z.string(), z.string())"],
  [{ type: "object", properties: { a: { type: "string" } }, required: ["a"], additionalProperties: {} }, "z.looseObject({ a: z.string() })"],
  [{ type: "object", properties: { a: { type: "number" } }, additionalProperties: false }, "z.strictObject({ a: z.number().optional() })"],
  [{ type: "string", const: "human" }, 'z.literal("human")'],
  [{ type: "string", enum: ["a", "b"] }, 'z.enum(["a","b"])'],
  [{ anyOf: [{ type: "string" }, { type: "object", properties: { a: { type: "string" } }, required: ["a"], additionalProperties: {} }] }, "z.union([z.string(), z.looseObject({ a: z.string() })])"],
  [{ type: "number", exclusiveMinimum: 0 }, "z.number().gt(0)"],
  [{ type: "array", items: { type: "string" }, minItems: 1 }, "z.array(z.string()).min(1)"],
  [{ type: "string", minLength: 1 }, "z.string().min(1)"],
];

describe("zodSource", () => {
  for (const [json, src] of FIXTURES) {
    test(`${src} is rebuilt and round-trips`, () => {
      expect(zodSource(json)).toBe(src);
      expect(roundTrips(json)).toBe(true);
    });
  }

  test("a keyword outside the covered set is flagged for review", () => {
    expect(zodSource({ type: "string", format: "email" })).toBe("z.string() /* not rebuilt: format */");
  });

  test("every schema in the committed lock rebuilds to an equivalent zod schema", () => {
    const lock = LOCK as Record<string, { schema: Record<string, unknown> }>;
    expect(Object.keys(lock).filter((k) => !roundTrips(lock[k]!.schema))).toEqual([]);
  });
});
