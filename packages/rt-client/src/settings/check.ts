/**
 * rt settings check: every stored value against its type check and layer
 * schema, every merged value against the full schema, plus unregistered
 * keys. Read-only; it uses this rt's registry.
 */

import { machineSettingsPath, teamSettingsPath, userSettingsPath } from "./paths.ts";
import { allDefs, getDef, validateValue, type SettingScope } from "./registry-machinery.ts";
import { checkSchema, hasSchema, type SchemaIssue } from "./schema.ts";
import { getSetting, listStoreRepoIdentities, listUnregisteredSettings } from "./resolve.ts";
import { listTeams, readStore, type StoreFile } from "./stores.ts";

export interface CheckFinding { key: string; scope: SettingScope; file: string; repo?: string; kind: "invalid" | "nonconforming" | "merged" | "unregistered"; issues: SchemaIssue[] }
export interface CheckReport { findings: CheckFinding[]; failing: number }

export function checkStores(): CheckReport {
  const findings: CheckFinding[] = [];
  const stores: { scope: SettingScope; store: StoreFile }[] = [
    ...listTeams().map((t) => ({ scope: "team" as const, store: readStore(teamSettingsPath(t)) })),
    { scope: "user", store: readStore(userSettingsPath()) },
    { scope: "machine", store: readStore(machineSettingsPath()) },
  ];
  for (const { scope, store } of stores) {
    if (!store.exists) continue;
    checkSection(scope, store.file, store.global, undefined, findings);
    for (const [repo, section] of Object.entries(store.repos)) checkSection(scope, store.file, section, repo, findings);
  }
  for (const def of allDefs()) {
    if (!hasSchema(def)) continue;
    for (const repo of [null, ...(def.repoScoped ? listStoreRepoIdentities() : [])]) {
      let value: unknown;
      try { value = getSetting(def.key, { repoIdentity: repo, expand: false }).value; } catch { continue; }
      if (value === undefined) continue;
      const issues = checkSchema(def, value, { layer: false });
      if (issues.length > 0) findings.push({ key: def.key, scope: "user", file: "(merged)", ...(repo ? { repo } : {}), kind: "merged", issues });
    }
  }
  for (const u of listUnregisteredSettings()) findings.push({ key: u.key, scope: u.scope.replace(".repo", "") as SettingScope, file: u.file, kind: "unregistered", issues: [] });
  return { findings, failing: findings.filter((f) => f.kind !== "unregistered").length };
}

function checkSection(scope: SettingScope, file: string, section: Record<string, unknown>, repo: string | undefined, out: CheckFinding[]): void {
  for (const [key, value] of Object.entries(section)) {
    const def = getDef(key);
    if (!def) continue;
    const guarded = scope === "machine" ? { ...def, pathGuardFields: undefined } : def;
    const typed = validateValue(guarded, value);
    const at = { key, scope, file, ...(repo ? { repo } : {}) };
    if (!typed.ok) { out.push({ ...at, kind: "invalid", issues: [{ path: [], message: typed.reason }] }); continue; }
    if (!hasSchema(def)) continue;
    const issues = checkSchema(def, value, { layer: true });
    if (issues.length > 0) out.push({ ...at, kind: "nonconforming", issues });
  }
}
