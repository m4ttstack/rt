/**
 * The schema lock: every composite key's storeVersion and JSON Schema,
 * generated from the zod schemas and committed. It is both the CI record a
 * breaking change is diffed against and the runtime source of every def's
 * schema, so the two cannot disagree.
 */

import { fileURLToPath } from "url";
import { z } from "zod";
import { REGISTRY } from "./registry-defs.ts";
import { SCHEMAS } from "./registry-schemas.ts";
import type { Lock } from "./schema-diff.ts";
import type { JsonSchema } from "./schema.ts";

export { checkLockAgainst, classifyLockDiff, isMissingPathAtRef, readBreakingChanges, type Change, type Lock } from "./schema-diff.ts";

export const LOCK_PATH = fileURLToPath(new URL("./schema.lock.json", import.meta.url));

export function toJsonSchema(schema: z.ZodType): JsonSchema {
  return z.toJSONSchema(schema, { io: "input" }) as JsonSchema;
}

export function buildLock(): Lock {
  const versions = new Map(REGISTRY.map((d) => [d.key, d.storeVersion ?? 1]));
  const out: Lock = {};
  for (const [key, schema] of Object.entries(SCHEMAS) as [string, z.ZodType][]) {
    out[key] = { storeVersion: versions.get(key) ?? 1, schema: toJsonSchema(schema) };
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}
