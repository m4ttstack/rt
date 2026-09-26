/**
 * Gives a live registry def a storeVersion, migration steps, renames and
 * (optionally) a schema for the duration of one assertion. Defs are shared
 * objects (`getDef` returns the live entry), so every field is restored
 * afterward or one test's bump would leak into the next.
 */

import { getDef, type MigrationStep, type SettingDef } from "../registry-machinery.ts";
import { layerJsonSchema } from "../schema.ts";

export interface MigrationFixture {
  storeVersion?: number;
  migrateFrom?: MigrationStep[];
  renamedFrom?: string[];
  schema?: Record<string, unknown>;
}

type Saved = Pick<SettingDef, "storeVersion" | "migrateFrom" | "renamedFrom" | "schema" | "layerSchema">;

function apply(key: string, fixture: MigrationFixture): { def: SettingDef; saved: Saved } {
  const def = getDef(key) as SettingDef;
  const saved: Saved = { storeVersion: def.storeVersion, migrateFrom: def.migrateFrom, renamedFrom: def.renamedFrom, schema: def.schema, layerSchema: def.layerSchema };
  if (fixture.storeVersion !== undefined) def.storeVersion = fixture.storeVersion;
  if (fixture.migrateFrom !== undefined) def.migrateFrom = fixture.migrateFrom;
  if (fixture.renamedFrom !== undefined) def.renamedFrom = fixture.renamedFrom;
  if (fixture.schema !== undefined) {
    def.schema = fixture.schema;
    def.layerSchema = def.merge === "deep" && def.type === "object" ? layerJsonSchema(fixture.schema) : undefined;
  }
  return { def, saved };
}

export function withMigration(key: string, fixture: MigrationFixture, fn: () => void): void {
  const { def, saved } = apply(key, fixture);
  try {
    fn();
  } finally {
    Object.assign(def, saved);
  }
}

export async function withMigrationAsync(key: string, fixture: MigrationFixture, fn: () => Promise<void>): Promise<void> {
  const { def, saved } = apply(key, fixture);
  try {
    await fn();
  } finally {
    Object.assign(def, saved);
  }
}
