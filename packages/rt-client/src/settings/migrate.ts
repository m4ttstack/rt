/**
 * Versioned store names and the migration chain. A key's value lives under
 * `key` at storeVersion 1 and `key@N` above it, so an older rt-client keeps
 * reading the name it knows and never meets a shape it cannot parse. Pure:
 * no file IO; callers hand in store sections.
 */

import { allDefs, getDef, isRetiredKey, type SettingDef } from "./registry-machinery.ts";

export const MIGRATED_PROP = "$migrated";

export function storeNameFor(key: string, version: number): string {
  return version <= 1 ? key : `${key}@${version}`;
}

export function currentStoreName(def: SettingDef): string {
  return storeNameFor(def.key, def.storeVersion ?? 1);
}

const VERSIONED = /^(.+)@([1-9]\d*)$/;

export function parseStoreName(name: string): { key: string; version: number } {
  const m = VERSIONED.exec(name);
  return m ? { key: m[1]!, version: Number(m[2]) } : { key: name, version: 1 };
}

/** The def whose renamedFrom lists `key`. Not cached: tests mutate live defs. */
export function renamedHeir(key: string): SettingDef | undefined {
  return allDefs().find((d) => d.renamedFrom?.includes(key));
}

export interface OlderStoreName {
  name: string;
  version: number;
}

/**
 * Every older name a reader of `def` can migrate from, highest version
 * first; at one version the key's own name precedes renamed keys' names. A
 * version with no step is unreadable and absent, except the current version
 * under a renamed key's name, which needs no step.
 */
export function olderStoreNames(def: SettingDef): OlderStoreName[] {
  const sv = def.storeVersion ?? 1;
  const renamed = def.renamedFrom ?? [];
  const stepVersions = (def.migrateFrom ?? []).map((s) => s.version).filter((v) => v < sv);
  const versions = [...new Set([sv, ...stepVersions])].sort((a, b) => b - a);
  const out: OlderStoreName[] = [];
  for (const v of versions) {
    for (const key of v === sv ? renamed : [def.key, ...renamed]) out.push({ name: storeNameFor(key, v), version: v });
  }
  return out;
}

export type StoreNameStatus = "metadata" | "current" | "older" | "newer" | "retired" | "unknown";

export function storeNameStatus(name: string): StoreNameStatus {
  if (name.startsWith("$")) return "metadata";
  const { key, version } = parseStoreName(name);
  if (storeNameFor(key, version) !== name) return "unknown";
  const def = getDef(key);
  if (def) {
    const sv = def.storeVersion ?? 1;
    return version === sv ? "current" : version > sv ? "newer" : "older";
  }
  const heir = renamedHeir(key);
  if (heir) return version > (heir.storeVersion ?? 1) ? "newer" : "older";
  return isRetiredKey(key) ? "retired" : "unknown";
}

/** Null when `def`'s steps form one unbroken chain ending at its storeVersion. */
export function chainProblem(def: SettingDef): string | null {
  const sv = def.storeVersion ?? 1;
  const versions = (def.migrateFrom ?? []).map((s) => s.version).sort((a, b) => a - b);
  if (versions.length === 0) return sv > 1 ? `${def.key}: storeVersion ${sv} with no migration to it` : null;
  for (let i = 1; i < versions.length; i++) {
    if (versions[i] === versions[i - 1]) return `${def.key}: two migrations from version ${versions[i]}`;
  }
  const top = versions.at(-1)!;
  if (top >= sv) return `${def.key}: a migration from version ${top} is not below storeVersion ${sv}`;
  if (top !== sv - 1) return `${def.key}: no migration from version ${sv - 1} to ${sv}`;
  for (let i = 1; i < versions.length; i++) {
    if (versions[i] !== versions[i - 1]! + 1) return `${def.key}: no migration from version ${versions[i - 1]! + 1}`;
  }
  if (versions[0]! < 1) return `${def.key}: a migration from version ${versions[0]}; versions start at 1`;
  return null;
}

export type ChainResult = { ok: true; value: unknown } | { ok: false; message: string };

/** Runs every step from `fromVersion` up to storeVersion on a copy of `value`. */
export function runChain(def: SettingDef, value: unknown, fromVersion: number): ChainResult {
  const sv = def.storeVersion ?? 1;
  let current = structuredClone(value);
  for (let v = fromVersion; v < sv; v++) {
    const step = def.migrateFrom?.find((s) => s.version === v);
    if (!step) return { ok: false, message: `no migration from version ${v}` };
    try {
      current = step.up(current);
    } catch (err) {
      return { ok: false, message: `migration ${v} -> ${v + 1} threw: ${(err as Error).message}` };
    }
  }
  return { ok: true, value: current };
}
