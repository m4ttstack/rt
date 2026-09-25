/**
 * The one write gate: validateValue (type + path guard, the resolver's own
 * skip rule), then the layer schema, then the merged result. The merged
 * check refuses only a write that makes a passing merge fail, so a layer
 * already broken elsewhere never blocks an unrelated edit.
 */

import { checkSchema, firstIssueText, hasSchema, type SchemaIssue } from "./schema.ts";
import { validateValue, type SettingDef, type SettingScope } from "./registry-machinery.ts";
import { currentMergedValue, listStoreRepoIdentities, mergedValueWith } from "./resolve.ts";

export type WriteRefusalKind = "type" | "pathGuard" | "schema";
export type WriteVerdict = { ok: true } | { ok: false; kind: WriteRefusalKind; reason: string; issues: SchemaIssue[] };

export function validateWrite(def: SettingDef, value: unknown, opts: { scope: SettingScope; repoIdentity?: string; team?: string }): WriteVerdict {
  const unguarded: SettingDef = { ...def, pathGuardFields: undefined };
  const typed = validateValue(unguarded, value);
  if (!typed.ok) return { ok: false, kind: "type", reason: typed.reason, issues: [] };
  if (opts.scope !== "machine") {
    const guarded = validateValue(def, value);
    if (!guarded.ok) return { ok: false, kind: "pathGuard", reason: guarded.reason, issues: [] };
  }
  if (!hasSchema(def)) return { ok: true };

  const layerIssues = checkSchema(def, value, { layer: true });
  if (layerIssues.length > 0) return { ok: false, kind: "schema", reason: firstIssueText(layerIssues), issues: layerIssues };

  const contexts: (string | null)[] =
    opts.repoIdentity !== undefined ? [opts.repoIdentity] : def.repoScoped ? [null, ...listStoreRepoIdentities()] : [null];
  for (const repoIdentity of contexts) {
    const after = mergedValueWith(def, { scope: opts.scope, repoIdentity: opts.repoIdentity, team: opts.team, value }, { repoIdentity, expand: false });
    // A team write with no local team store patches nothing, so `after` is the current merge,
    // undefined only when nothing is set anywhere; setSetting refuses that write afterwards.
    if (after === undefined) continue;
    const afterIssues = checkSchema(def, after, { layer: false });
    if (afterIssues.length === 0) continue;
    const before = currentMergedValue(def, { repoIdentity, expand: false });
    if (before === undefined || checkSchema(def, before, { layer: false }).length === 0) {
      const where = repoIdentity ? ` for ${repoIdentity}` : "";
      return { ok: false, kind: "schema", reason: `merged value${where} would fail: ${firstIssueText(afterIssues)}`, issues: afterIssues };
    }
  }
  return { ok: true };
}
