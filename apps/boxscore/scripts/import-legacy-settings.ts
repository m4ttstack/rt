// One-time move of boxscore's legacy config.ts/settings.json/.env into the
// rt settings stores. Run once, from the last checkout that still holds the
// legacy files, before the settings-fold branch merges and deletes them.
//
// Do NOT run this from an automated context: it writes real user/team
// stores and prints a git-commit reminder aimed at a human.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  getSetting,
  rtCommand,
  setSetting,
  type SettingScope,
} from '@mattstack/rt-client';
import type { RosterEntry } from '../src/server/config/index.js';
import type { RangePreset } from '../src/shared/types.js';

export type Integrations = Record<string, unknown> & {
  forge?: { host?: string };
  linear?: { teamKey?: string };
};

interface LegacyConfig {
  projectPaths?: string[];
  defaultRange: RangePreset;
}

interface LegacySettings {
  linearTeam: string;
  doneStates: string[];
  users: string[];
  currentUser: string;
  sizeBand: { tooSmall: number; tooLarge: number };
  bots: { extraPatterns: string[] };
  excludeFilePatterns: string[];
  ignoredMrs: string[];
}

interface PlannedWrite {
  key: string;
  value: unknown;
  scope: SettingScope;
}

const LEGACY_FILES = [
  'config.ts',
  'settings.json',
  '.env',
  '.env.example',
  'server/settings.ts',
  'server/env.ts',
];

/** Board entries win on name; legacy usernames missing from the board are appended, nameless. */
export function mergeRoster(
  board: RosterEntry[],
  legacyUsernames: string[]
): RosterEntry[] {
  const seen = new Set(board.map(m => m.username));
  const merged = [...board];
  for (const username of legacyUsernames) {
    if (seen.has(username)) continue;
    seen.add(username);
    merged.push({ username });
  }
  return merged;
}

/** Fills only the fields `current` is missing; never overwrites an already-present forge.host / linear.teamKey. */
export function mergeIntegrations(
  current: Integrations,
  incoming: { host?: string; teamKey?: string }
): { merged: Integrations; changed: boolean } {
  const merged: Integrations = { ...current };
  let changed = false;

  if (incoming.host !== undefined && merged.forge?.host === undefined) {
    merged.forge = { ...merged.forge, host: incoming.host };
    changed = true;
  }
  if (incoming.teamKey !== undefined && merged.linear?.teamKey === undefined) {
    merged.linear = { ...merged.linear, teamKey: incoming.teamKey };
    changed = true;
  }

  return { merged, changed };
}

function fatal(message: string): never {
  console.error(`[import-legacy-settings] ${message}`);
  process.exit(1);
}

function apiTokenPath(): string {
  return join(process.env.HOME ?? homedir(), '.mattstack', 'rt', 'api-token');
}

async function loadLegacyConfig(): Promise<LegacyConfig> {
  const specifier = join(process.cwd(), 'config.ts');
  if (!existsSync(specifier))
    fatal(`config.ts not found in ${process.cwd()} ... already imported?`);
  const mod = (await import(specifier)) as { config: LegacyConfig };
  return mod.config;
}

function loadLegacySettings(): LegacySettings {
  const path = join(process.cwd(), 'settings.json');
  if (!existsSync(path))
    fatal(`settings.json not found in ${process.cwd()} ... already imported?`);
  return JSON.parse(readFileSync(path, 'utf8')) as LegacySettings;
}

async function checkSecretsPresent(): Promise<void> {
  let token: string;
  try {
    token = readFileSync(apiTokenPath(), 'utf8').trim();
  } catch (err) {
    fatal(
      `cannot read the rt api token at ${apiTokenPath()}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  const res = await rtCommand<{ gitlabToken?: string; linearApiKey?: string }>(
    'secrets:read',
    { token, scope: 'extension' },
    { timeoutMs: 15_000 }
  );
  if (!res.ok) fatal(`secrets:read failed: ${res.error ?? 'unknown'}`);
  const missing: string[] = [];
  if (!('gitlabToken' in (res.data ?? {}))) missing.push('gitlabToken');
  if (!('linearApiKey' in (res.data ?? {}))) missing.push('linearApiKey');
  if (missing.length > 0) {
    fatal(
      `missing key(s) in the extension secrets store: ${missing.join(', ')}. ` +
        'Add them to the sops-encrypted secrets store before re-running this import.'
    );
  }
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');

  const legacy = await loadLegacyConfig();
  const settingsJson = loadLegacySettings();
  const gitlabBaseUrl = process.env.GITLAB_BASE_URL;

  await checkSecretsPresent();

  const board =
    getSetting<RosterEntry[] | undefined>('board.members').value ?? [];

  const writes: PlannedWrite[] = [
    {
      key: 'mattstack.roster',
      value: mergeRoster(board, settingsJson.users),
      scope: 'team',
    },
    {
      key: 'boxscore.projects',
      value: legacy.projectPaths ?? [],
      scope: 'team',
    },
    {
      key: 'boxscore.linearDoneStates',
      value: settingsJson.doneStates,
      scope: 'team',
    },
    { key: 'boxscore.sizeBand', value: settingsJson.sizeBand, scope: 'team' },
    {
      key: 'boxscore.excludeFilePatterns',
      value: settingsJson.excludeFilePatterns,
      scope: 'team',
    },
    {
      key: 'boxscore.ignoredMrs',
      value: settingsJson.ignoredMrs,
      scope: 'team',
    },
    {
      key: 'boxscore.botPatterns',
      value: settingsJson.bots.extraPatterns,
      scope: 'team',
    },
    { key: 'boxscore.defaultRange', value: legacy.defaultRange, scope: 'user' },
  ];

  const currentIntegrations =
    getSetting<Integrations | undefined>('mattstack.integrations').value ?? {};
  const { merged: mergedIntegrations, changed: integrationsChanged } =
    mergeIntegrations(currentIntegrations, {
      host: gitlabBaseUrl,
      teamKey: settingsJson.linearTeam,
    });
  if (integrationsChanged) {
    writes.push({
      key: 'mattstack.integrations',
      value: mergedIntegrations,
      scope: 'team',
    });
  }

  if (dryRun) {
    console.log('[import-legacy-settings] --dry-run: planned writes');
    for (const w of writes)
      console.log(`  ${w.scope} ${w.key} = ${JSON.stringify(w.value)}`);
    return;
  }

  for (const w of writes) setSetting(w.key, w.value, w.scope);

  for (const w of writes) {
    const readBack = getSetting(w.key).value;
    if (JSON.stringify(readBack) !== JSON.stringify(w.value)) {
      fatal(
        `verification failed for ${w.key}: wrote ${JSON.stringify(w.value)}, read back ${JSON.stringify(readBack)}`
      );
    }
  }

  console.log(
    '[import-legacy-settings] team-scope writes landed in the local acme-web team repo working copy. ' +
      'Commit and push there for the rest of the team to pick them up.'
  );
  console.log(
    '[import-legacy-settings] the settings-fold branch removes these legacy files:'
  );
  for (const f of LEGACY_FILES) console.log(`  ${f}`);
}

if (import.meta.main) {
  main().catch(err => {
    fatal(err instanceof Error ? err.message : String(err));
  });
}
