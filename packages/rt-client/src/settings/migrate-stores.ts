/**
 * Every section of every settings store, the unit `rt settings check` and
 * `rt settings migrate` walk. Read-only: writes go through setSetting and
 * pruneStoreName.
 */

import { machineSettingsPath, teamSettingsPath, userSettingsPath } from "./paths.ts";
import { allDefs, type SettingScope } from "./registry-machinery.ts";
import { currentStoreName, readSection, type OlderLabel } from "./migrate.ts";
import { listTeams, readStore } from "./stores.ts";

export interface StoreSection {
  scope: SettingScope;
  /** The team's name, for a team store. */
  team?: string;
  file: string;
  repo?: string;
  section: Record<string, unknown>;
}

export function storeSections(): StoreSection[] {
  const stores: { scope: SettingScope; team?: string; file: string }[] = [
    ...[...listTeams()].sort().map((team) => ({ scope: "team" as const, team, file: teamSettingsPath(team) })),
    { scope: "user", file: userSettingsPath() },
    { scope: "machine", file: machineSettingsPath() },
  ];
  const out: StoreSection[] = [];
  for (const s of stores) {
    const store = readStore(s.file);
    if (!store.exists) continue;
    out.push({ ...s, section: store.global });
    for (const [repo, section] of Object.entries(store.repos)) out.push({ ...s, repo, section });
  }
  return out;
}

export interface MigrationWrite {
  key: string;
  scope: SettingScope;
  team?: string;
  file: string;
  repo?: string;
  fromName: string;
  fromVersion: number;
  storeName: string;
  value: unknown;
}

export interface MigrationFailure {
  key: string;
  scope: SettingScope;
  team?: string;
  file: string;
  repo?: string;
  fromName: string;
  message: string;
}

export interface OlderName {
  key: string;
  scope: SettingScope;
  team?: string;
  file: string;
  repo?: string;
  storeName: string;
  storedVersion: number;
  /** The key's current storeVersion: every reader of this store must know it before the older name goes. */
  storeVersion: number;
  label: OlderLabel;
  olderValue: unknown;
  currentValue: unknown;
}

export interface MigrationPlan {
  writes: MigrationWrite[];
  failures: MigrationFailure[];
  older: OlderName[];
}

export function planStoreMigrations(): MigrationPlan {
  const plan: MigrationPlan = { writes: [], failures: [], older: [] };
  for (const s of storeSections()) {
    const where = { scope: s.scope, ...(s.team ? { team: s.team } : {}), file: s.file, ...(s.repo ? { repo: s.repo } : {}) };
    for (const def of allDefs()) {
      if (!def.scopes.includes(s.scope)) continue;
      if (s.repo !== undefined && def.repoScoped !== true) continue;
      const read = readSection(def, s.section, { layer: true });
      if (!read.present) continue;
      const current = currentStoreName(def);
      if (read.storeName !== current) {
        if (read.migrationError) plan.failures.push({ key: def.key, ...where, fromName: read.storeName!, message: read.migrationError });
        else plan.writes.push({ key: def.key, ...where, fromName: read.storeName!, fromVersion: read.storedVersion!, storeName: current, value: read.value });
        continue;
      }
      for (const o of read.older) {
        plan.older.push({ key: def.key, ...where, storeName: o.storeName, storedVersion: o.storedVersion, storeVersion: def.storeVersion ?? 1, label: o.label, olderValue: o.value, currentValue: read.value });
      }
    }
  }
  return plan;
}
