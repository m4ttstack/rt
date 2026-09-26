/**
 * Proves one migration step: samples of the step's source schema (and, for
 * a deep-merge key, of its layer form) plus saved examples, run up the rest
 * of the chain, must land in the current schema. A full sample of a deep
 * key is overlaid on the registry default first, because a store holds one
 * layer of it, never the merged whole. Authoring and CI only.
 */

import { runChain } from "./migrate.ts";
import type { SettingDef } from "./registry-machinery.ts";
import { sampleValues } from "./sample-values.ts";
import { firstIssueText, layerJsonSchema, validateJson, type JsonSchema } from "./schema.ts";

export interface ProofFailure {
  sample: unknown;
  layer: boolean;
  message: string;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

function overlayDeep(base: unknown, over: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(over)) return over;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = isPlainObject(v) && isPlainObject(out[k]) ? overlayDeep(out[k], v) : v;
  return out;
}

export function proveMigration(def: SettingDef & { schema: JsonSchema }, version: number, fromSchema: JsonSchema, examples: unknown[]): ProofFailure[] {
  const deep = def.merge === "deep" && def.type === "object";
  const full = sampleValues(fromSchema);
  if (full.length === 0 && examples.length === 0) {
    return [{ sample: undefined, layer: false, message: `no sample value passes the version ${version} schema; add examples` }];
  }
  const runs = [
    ...full.map((value) => ({ value, layer: false })),
    ...examples.map((value) => ({ value, layer: deep })),
    ...(deep ? sampleValues(layerJsonSchema(fromSchema)).map((value) => ({ value, layer: true })) : []),
  ];
  const layerSchema = deep ? (def.layerSchema ?? layerJsonSchema(def.schema)) : def.schema;
  const failures: ProofFailure[] = [];
  for (const run of runs) {
    const out = runChain(def, run.value, version);
    if (!out.ok) {
      failures.push({ sample: run.value, layer: run.layer, message: out.message });
      continue;
    }
    const value = deep && !run.layer ? overlayDeep(def.default, out.value) : out.value;
    const issues = validateJson(run.layer ? layerSchema : def.schema, value);
    if (issues.length > 0) failures.push({ sample: run.value, layer: run.layer, message: firstIssueText(issues) });
  }
  return failures;
}
