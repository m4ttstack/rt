/**
 * The zod schema of each registered migration step's source version, with
 * values saved from real stores (invented data only, per repo purity).
 * Authoring only, like registry-schemas.ts: buildLock writes each schema
 * into the lock's migrateFrom as JSON Schema, which is what CI and release
 * preflight compare with the previous lock, and the proof test samples it.
 * One entry per MIGRATION_STEPS entry. `rt settings schema diff --draft`
 * inserts entries directly above the @draft marker; keep it.
 */

import { z } from "zod";

export interface MigrationSchema {
  key: string;
  version: number;
  schema: z.ZodType;
  examples: unknown[];
}

export const MIGRATION_SCHEMAS: MigrationSchema[] = [
  // @draft-schemas
];
