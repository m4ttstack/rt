/**
 * The one write gate: validateValue (type + path guard, the resolver's own
 * skip rule), then the layer schema, then the merged result. The merged
 * check refuses only a write that makes a passing merge fail, so a layer
 * already broken elsewhere never blocks an unrelated edit.
 */

import { checkSchema, firstIssueText, hasSchema, type SchemaIssue } from "./schema.ts";
import { validateValue, type SettingDef, type SettingScope } from "./registry-machinery.ts";
import { getSetting, listStoreRepoIdentities, mergedValueWith } from "./resolve.ts";

export type WriteVerdict = { ok: true } | { ok: false; reason: string; issues: SchemaIssue[] };

export function validateWrite(def: SettingDef, value: unknown, opts: { scope: SettingScope; repoIdentity?: string; team?: string }): WriteVerdict {
  const guarded: SettingDef = opts.scope === "machine" ? { ...def, pathGuardFields: undefined } : def;
  const typed = validateValue(guarded, value);
  if (!typed.ok) return { ok: false, reason: typed.reason, issues: [] };
  if (!hasSchema(def)) return { ok: true };

  const layerIssues = checkSchema(def, value, { layer: true });
  if (layerIssues.length > 0) return { ok: false, reason: firstIssueText(layerIssues), issues: layerIssues };

  const contexts: (string | null)[] =
    opts.repoIdentity !== undefined ? [opts.repoIdentity] : def.repoScoped ? [null, ...listStoreRepoIdentities()] : [null];
  for (const repoIdentity of contexts) {
    const after = mergedValueWith(def, { scope: opts.scope, repoIdentity: opts.repoIdentity, team: opts.team, value }, { repoIdentity, expand: false });
    const afterIssues = checkSchema(def, after, { layer: false });
    if (afterIssues.length === 0) continue;
    const before = mergedNow(def, repoIdentity);
    if (before === undefined || checkSchema(def, before, { layer: false }).length === 0) {
      const where = repoIdentity ? ` for ${repoIdentity}` : "";
      return { ok: false, reason: `merged value${where} would fail: ${firstIssueText(afterIssues)}`, issues: afterIssues };
    }
  }
  return { ok: true };
}

function mergedNow(def: SettingDef, repoIdentity: string | null): unknown {
  try {
    return getSetting(def.key, { repoIdentity, expand: false }).value;
  } catch {
    return undefined;
  }
}
