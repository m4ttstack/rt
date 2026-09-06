import { getSetting } from '@mattstack/rt-client';
import type { RangePreset } from '../../shared/types.js';

/** Politeness cap on concurrent GitLab requests; a code constant since the fold. */
export const CONCURRENCY = 6;

/** Configuration missing or unusable; routes surface it as a 400, not a 500. */
export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

export interface RosterEntry {
  username: string;
  name?: string;
}

/** The fetchers' connection envelope; assembled per run from settings + secrets. */
export interface Env {
  baseUrl: string;
  token: string;
  linearApiKey?: string;
}

export interface BoxscoreSettings {
  projects: string[];
  roster: RosterEntry[];
  hiddenMembers: string[];
  /** Roster usernames minus hiddenMembers: the leaderboard's comparison set. */
  users: string[];
  /** "" = Linear unconfigured. */
  linearTeam: string;
  doneStates: string[];
  sizeBand: { tooSmall: number; tooLarge: number };
  excludeFilePatterns: string[];
  ignoredMrs: string[];
  botPatterns: string[];
  defaultRange: RangePreset;
  /** "" = GitLab unconfigured. */
  baseUrl: string;
}

export type SettingReader = <T>(key: string) => T | undefined;

const storeReader: SettingReader = <T>(key: string): T | undefined =>
  getSetting<T | undefined>(key).value;

let reader: SettingReader | null = null;

/** Test seam. Vitest must inject; the store-backed reader would read the developer's real stores. */
export function __setSettingReader(r: SettingReader | null): void {
  reader = r;
}

function read<T>(key: string): T | undefined {
  if (reader) return reader<T>(key);
  if (process.env.VITEST)
    throw new Error('tests must inject a setting reader (__setSettingReader)');
  return storeReader<T>(key);
}

interface Integrations {
  forge?: { host?: string };
  linear?: { teamKey?: string };
}

function baseUrlFrom(host: string | undefined): string {
  if (!host) return '';
  const url = /^https?:\/\//.test(host) ? host : `https://${host}`;
  return url.replace(/\/+$/, '');
}

/** Every read resolves the stores fresh; nothing here caches across calls (spec 5.3). */
export function readSettings(): BoxscoreSettings {
  const roster = read<RosterEntry[]>('mattstack.roster') ?? [];
  const hiddenMembers = read<string[]>('boxscore.hiddenMembers') ?? [];
  const hidden = new Set(hiddenMembers);
  const integrations = read<Integrations>('mattstack.integrations') ?? {};
  return {
    projects: read<string[]>('boxscore.projects') ?? [],
    roster,
    hiddenMembers,
    users: roster.filter(m => !hidden.has(m.username)).map(m => m.username),
    linearTeam: integrations.linear?.teamKey ?? '',
    doneStates: read<string[]>('boxscore.linearDoneStates') ?? [],
    sizeBand: read<{ tooSmall: number; tooLarge: number }>(
      'boxscore.sizeBand'
    ) ?? { tooSmall: 10, tooLarge: 400 },
    excludeFilePatterns: read<string[]>('boxscore.excludeFilePatterns') ?? [],
    ignoredMrs: read<string[]>('boxscore.ignoredMrs') ?? [],
    botPatterns: read<string[]>('boxscore.botPatterns') ?? [],
    defaultRange: read<RangePreset>('boxscore.defaultRange') ?? '30d',
    baseUrl: baseUrlFrom(integrations.forge?.host),
  };
}
