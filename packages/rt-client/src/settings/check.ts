/**
 * rt settings check: every stored value against its type check and layer
 * schema, every merged value against the full schema, older store names
 * labeled per section, plus unregistered keys. Read-only; it uses this
 * rt's registry.
 */

import { allDefs, validateValue, type SettingScope } from "./registry-machinery.ts";
import { checkSchema, hasSchema, type SchemaIssue } from "./schema.ts";
import { currentMergedValue, listStoreRepoIdentities, listUnregisteredSettings } from "./resolve.ts";
import { readSection } from "./migrate.ts";
import { storeSections, type StoreSection } from "./migrate-stores.ts";

/** A `merged` finding belongs to no one store, so it carries no `scope` or `file`. */
export interface CheckFinding {
  key: string;
  scope?: SettingScope;
  file?: string;
  repo?: string;
  kind: "invalid" | "nonconforming" | "merged" | "unregistered" | "diverged" | "stale" | "leftover";
  issues: SchemaIssue[];
  /** For an older-name finding: the older name, its value migrated, and the current name's value. */
  storeName?: string;
  olderValue?: unknown;
  currentValue?: unknown;
  /** An unregistered name a newer rt writes. */
  newer?: true;
}
export interface CheckReport { findings: CheckFinding[]; failing: number }

const FAILING: ReadonlySet<CheckFinding["kind"]> = new Set(["invalid", "nonconforming", "merged", "diverged"]);

export function checkStores(): CheckReport {
  const findings: CheckFinding[] = [];
  for (const s of storeSections()) checkSection(s, findings);
  for (const def of allDefs()) {
    if (!hasSchema(def)) continue;
    for (const repo of [null, ...(def.repoScoped ? listStoreRepoIdentities() : [])]) {
      const value = currentMergedValue(def, { repoIdentity: repo, expand: false });
      if (value === undefined) continue;
      const issues = checkSchema(def, value, { layer: false });
      if (issues.length > 0) findings.push({ key: def.key, ...(repo ? { repo } : {}), kind: "merged", issues });
    }
  }
  for (const u of listUnregisteredSettings()) {
    findings.push({ key: u.key, scope: u.scope.replace(".repo", "") as SettingScope, file: u.file, kind: "unregistered", issues: [], ...(u.newer ? { newer: true as const } : {}) });
  }
  return { findings, failing: findings.filter((f) => FAILING.has(f.kind)).length };
}

function checkSection(s: StoreSection, out: CheckFinding[]): void {
  for (const def of allDefs()) {
    const read = readSection(def, s.section, { layer: true });
    if (!read.present) continue;
    const at = { key: def.key, scope: s.scope, file: s.file, ...(s.repo ? { repo: s.repo } : {}) };
    // Older-name findings are only meaningful where this key can legitimately be
    // written: the same allow-list planStoreMigrations applies before walking older names.
    const allowedHere = def.scopes.includes(s.scope) && (s.repo === undefined || def.repoScoped === true);
    if (allowedHere) {
      for (const o of read.older) {
        out.push({
          ...at,
          kind: o.label,
          issues: o.migrationError ? [{ path: [], message: o.migrationError }] : [],
          storeName: o.storeName,
          ...(def.secret === true ? {} : { olderValue: o.value, currentValue: read.value }),
        });
      }
    }
    const guarded = s.scope === "machine" ? { ...def, pathGuardFields: undefined } : def;
    const typed = validateValue(guarded, read.value);
    if (!typed.ok) {
      const issues = [...(read.migrationError ? [{ path: [], message: read.migrationError }] : []), { path: [], message: typed.reason }];
      out.push({ ...at, kind: "invalid", issues });
      continue;
    }
    const issues = [
      ...(read.migrationError ? [{ path: [], message: read.migrationError }] : []),
      ...(hasSchema(def) ? checkSchema(def, read.value, { layer: true }) : []),
    ];
    if (issues.length > 0) out.push({ ...at, kind: "nonconforming", issues });
  }
}
