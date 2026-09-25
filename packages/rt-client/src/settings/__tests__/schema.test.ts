/**
 * settings/schema.ts: the runtime check over a def's JSON Schema, the
 * derived layer schema for deep-merge keys, and issue formatting. No zod
 * here: this module is what rt loads at startup.
 */

import { describe, expect, test } from "bun:test";
import type { SettingDef } from "../registry-machinery.ts";
import { checkSchema, firstIssueText, formatIssuePath, layerJsonSchema, validateJson } from "../schema.ts";

const ruleSchema = {
  type: "object",
  properties: { pattern: { type: "string" }, category: { type: "string" }, url: { type: "string" }, owner: { const: "human" } },
  required: ["pattern", "category"],
};
const listSchema = { type: "array", items: ruleSchema };
const deepSchema = {
  type: "object",
  properties: {
    enabled: { type: "boolean" },
    debounceSec: { type: "number" },
    nested: { type: "object", properties: { a: { type: "string" } }, required: ["a"] },
  },
  required: ["enabled", "debounceSec"],
};

function def(over: Partial<SettingDef> & Pick<SettingDef, "key" | "type" | "merge">): SettingDef {
  return { scopes: ["user"], description: "test", ...over };
}
const listDef = def({ key: "t.list", type: "array", merge: "replace", schema: listSchema });
const deepDef = def({ key: "t.deep", type: "object", merge: "deep", schema: deepSchema, layerSchema: layerJsonSchema(deepSchema) });

describe("layerJsonSchema", () => {
  test("drops required at every object level but keeps it inside array items, even nested", () => {
    const json = {
      type: "object",
      properties: {
        a: { type: "string" },
        b: { type: "object", properties: { c: { type: "number" } }, required: ["c"] },
        items: { type: "array", items: { type: "object", properties: { d: { type: "string" }, e: { type: "object", properties: { f: { type: "string" } }, required: ["f"] } }, required: ["d"] } },
      },
      required: ["a"],
    };
    const layer = layerJsonSchema(json) as any;
    expect(layer.required).toBeUndefined();
    expect(layer.properties.b.required).toBeUndefined();
    expect(layer.properties.items.items.required).toEqual(["d"]);
    expect(layer.properties.items.items.properties.e.required).toEqual(["f"]);
  });
});

describe("validateJson", () => {
  test("reports the deepest failing path with a normalized message", () => {
    const issues = validateJson(listSchema, [{ pattern: 1, category: "gate" }]);
    expect(issues[0]!.path).toEqual([0, "pattern"]);
    expect(issues[0]!.message).toBe("expected string, got number");
  });

  test("a missing required property is reported at the property, not the parent", () => {
    const issues = validateJson(listSchema, [{ category: "gate" }]);
    expect(issues[0]!.path).toEqual([0, "pattern"]);
    expect(issues[0]!.message).toBe('required property "pattern" is missing');
  });

  test("a const mismatch names the expected value", () => {
    const issues = validateJson(listSchema, [{ pattern: "x", category: "gate", owner: "herd" }]);
    expect(issues[0]!.path).toEqual([0, "owner"]);
    expect(issues[0]!.message).toBe('expected "human"');
  });

  test("limits, enums and unexpected properties read as plain rules", () => {
    expect(validateJson({ type: "number", minimum: 1 }, 0)[0]!.message).toBe("must be >= 1");
    expect(validateJson({ enum: ["a", "b"] }, "c")[0]!.message).toBe("expected one of a, b");
    const extra = validateJson({ type: "object", properties: { a: { type: "string" } }, additionalProperties: false }, { a: "x", b: 1 });
    expect(extra[0]).toEqual({ path: ["b"], message: 'unexpected property "b"' });
  });

  test("a conforming value with extras passes", () => {
    expect(validateJson(listSchema, [{ pattern: "gate/*", category: "gate", extra: true }])).toEqual([]);
  });
});

describe("checkSchema", () => {
  test("a def without a schema never reports issues", () => {
    expect(checkSchema(def({ key: "t.plain", type: "object", merge: "replace" }), { anything: 1 }, { layer: false })).toEqual([]);
  });

  test("layer check accepts a partial deep layer and still types what is present", () => {
    expect(checkSchema(deepDef, { enabled: false }, { layer: true })).toEqual([]);
    expect(checkSchema(deepDef, { enabled: "yes" }, { layer: true })[0]!.path).toEqual(["enabled"]);
  });

  test("layer check keeps array items whole", () => {
    const d = def({ key: "t.deepList", type: "object", merge: "deep", schema: { type: "object", properties: { rules: listSchema }, required: ["rules"] } });
    d.layerSchema = layerJsonSchema(d.schema!);
    expect(checkSchema(d, { rules: [{ category: "gate" }] }, { layer: true })[0]!.path).toEqual(["rules", 0, "pattern"]);
  });

  test("full check rejects a partial layer of a deep key; a replace key ignores the layer flag", () => {
    expect(checkSchema(deepDef, { enabled: false }, { layer: false }).length).toBeGreaterThan(0);
    expect(checkSchema(listDef, [{ category: "gate" }], { layer: true }).length).toBeGreaterThan(0);
  });
});

describe("formatIssuePath and firstIssueText", () => {
  test("formats indexes in brackets and properties with dots", () => {
    expect(formatIssuePath([0, "pattern"])).toBe("[0].pattern");
    expect(formatIssuePath(["emoji", "looking"])).toBe("emoji.looking");
    expect(formatIssuePath([])).toBe("(root)");
  });

  test("firstIssueText joins path and message", () => {
    expect(firstIssueText([{ path: [0, "pattern"], message: "expected string, got number" }])).toBe("[0].pattern: expected string, got number");
    expect(firstIssueText([])).toBe("");
  });
});
