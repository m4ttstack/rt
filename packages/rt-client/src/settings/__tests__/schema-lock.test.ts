import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { z } from "zod";
import { buildLock, LOCK_PATH, toJsonSchema } from "../schema-lock.ts";

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
