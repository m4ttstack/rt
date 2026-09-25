/**
 * The schema lock: every composite key's storeVersion and JSON Schema,
 * generated from the zod schemas and committed. It is both the CI record a
 * breaking change is diffed against and the runtime source of every def's
 * schema, so the two cannot disagree.
 */

import { fileURLToPath } from "url";
import { z } from "zod";
import { RENAMES } from "./migrations/index.ts";
import { MIGRATION_SCHEMAS } from "./migrations/schemas.ts";
import { REGISTRY } from "./registry-defs.ts";
import { SCHEMAS } from "./registry-schemas.ts";
import type { Lock, LockEntry } from "./schema-diff.ts";
import type { JsonSchema } from "./schema.ts";

export {
  checkLockAgainst,
  classifyLockDiff,
  equivalentSchemas,
  isMissingPathAtRef,
  readBreakingChanges,
  type AcceptanceOpts,
  type Change,
  type Lock,
  type LockEntry,
} from "./schema-diff.ts";

export const LOCK_PATH = fileURLToPath(new URL("./schema.lock.json", import.meta.url));

export function toJsonSchema(schema: z.ZodType): JsonSchema {
  return z.toJSONSchema(schema, { io: "input" }) as JsonSchema;
}

export function buildLock(): Lock {
  const versions = new Map(REGISTRY.map((d) => [d.key, d.storeVersion ?? 1]));
  const out: Lock = {};
  for (const [key, schema] of Object.entries(SCHEMAS) as [string, z.ZodType][]) {
    const entry: LockEntry = { storeVersion: versions.get(key) ?? 1, schema: toJsonSchema(schema) };
    const owners = new Set([key, ...(RENAMES[key] ?? [])]);
    const steps = MIGRATION_SCHEMAS.filter((m) => owners.has(m.key)).sort((a, b) => a.version - b.version);
    if (steps.length > 0) entry.migrateFrom = Object.fromEntries(steps.map((m) => [String(m.version), toJsonSchema(m.schema)]));
    if (RENAMES[key]) entry.renamedFrom = [...RENAMES[key]!];
    out[key] = entry;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}
