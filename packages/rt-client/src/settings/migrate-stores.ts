/**
 * Every section of every settings store, the unit `rt settings check` and
 * `rt settings migrate` walk. Read-only: writes go through setSetting and
 * pruneStoreName.
 */

import { machineSettingsPath, teamSettingsPath, userSettingsPath } from "./paths.ts";
import type { SettingScope } from "./registry-machinery.ts";
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
