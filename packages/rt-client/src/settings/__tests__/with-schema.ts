/**
 * Attaches a JSON Schema to a live registry def for the duration of one
 * assertion. Defs are shared objects (`getDef` returns the live entry, the
 * `withTeamLocked` pattern in resolve.test.ts), so this must restore the
 * previous schema/layerSchema afterward or one test's schema would leak into
 * the next.
 */

import { getDef, type SettingDef } from "../registry-machinery.ts";
import { layerJsonSchema } from "../schema.ts";

export function withSchema(key: string, schema: Record<string, unknown>, fn: () => void): void {
  const def = getDef(key) as SettingDef;
  const prev = { schema: def.schema, layer: def.layerSchema };
  def.schema = schema;
  def.layerSchema = def.merge === "deep" && def.type === "object" ? layerJsonSchema(schema) : undefined;
  try {
    fn();
  } finally {
    def.schema = prev.schema;
    def.layerSchema = prev.layer;
  }
}
