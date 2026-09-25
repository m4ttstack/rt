/**
 * One good, one bad and (deep keys) one partial-layer example per composite
 * key, run through the runtime check. Completeness widens as namespaces land.
 */

import { describe, expect, test } from "bun:test";
import { allDefs, getDef } from "../registry-machinery.ts";
import { checkSchema } from "../schema.ts";
import { EXAMPLES } from "./schema-examples.ts";

export const COVERED_PREFIXES = ["rt."];

describe("schema examples", () => {
  for (const [key, ex] of Object.entries(EXAMPLES)) {
    describe(key, () => {
      test("has a schema", () => {
        expect(getDef(key)?.schema, `${key} needs a schema (add it to registry-schemas.ts and regenerate the lock)`).toBeDefined();
      });
      for (const [i, good] of ex.good.entries()) {
        test(`good #${i} passes`, () => { expect(checkSchema(getDef(key)!, good, { layer: false })).toEqual([]); });
      }
      for (const [i, bad] of ex.bad.entries()) {
        test(`bad #${i} fails at ${JSON.stringify(bad.path)}`, () => {
          const issues = checkSchema(getDef(key)!, bad.value, { layer: false });
          expect(issues.length).toBeGreaterThan(0);
          expect(issues[0]!.path).toEqual(bad.path);
        });
      }
      for (const [i, layer] of (ex.layer ?? []).entries()) {
        test(`layer #${i} passes the layer schema`, () => { expect(checkSchema(getDef(key)!, layer, { layer: true })).toEqual([]); });
      }
      test("the registry default, when present, passes", () => {
        const def = getDef(key)!;
        if (!("default" in def)) return;
        expect(checkSchema(def, def.default, { layer: false })).toEqual([]);
      });
    });
  }

  test("every composite key in a covered namespace has a schema and an example", () => {
    const covered = allDefs().filter((d) => (d.type === "object" || d.type === "array") && COVERED_PREFIXES.some((p) => d.key.startsWith(p)));
    expect(covered.filter((d) => !d.schema).map((d) => d.key)).toEqual([]);
    expect(covered.map((d) => d.key).filter((k) => !(k in EXAMPLES))).toEqual([]);
  });
});
