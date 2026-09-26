/**
 * Versioned store names and the migration chain. A key's value lives under
 * `key` at storeVersion 1 and `key@N` above it, so an older rt-client keeps
 * reading the name it knows and never meets a shape it cannot parse. Pure:
 * no file IO; callers hand in store sections.
 */

import { createHash } from "crypto";
import { allDefs, getDef, isRetiredKey, type SettingDef } from "./registry-machinery.ts";
import { checkSchema, firstIssueText } from "./schema.ts";

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

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(obj).sort().map((k) => [k, sortKeys(obj[k])]));
  }
  return value;
}

export function valueHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex").slice(0, 16)}`;
}

export type OlderLabel = "leftover" | "stale" | "diverged";

export interface OlderNameRead {
  storeName: string;
  storedVersion: number;
  label: OlderLabel;
  /** Migrated to the current shape; the authored value when migration failed. */
  value: unknown;
  authored: unknown;
  migrationError?: string;
}

export interface SectionRead {
  present: boolean;
  storeName?: string;
  storedVersion?: number;
  /** In the current shape, unless migration failed: then the value as stored. */
  value?: unknown;
  authored?: unknown;
  migrationError?: string;
  /** Older names beside a present current name, each labeled; empty otherwise. */
  older: OlderNameRead[];
}

export function baselinesOf(section: Record<string, unknown> | undefined): Record<string, unknown> {
  const m = section?.[MIGRATED_PROP];
  return m !== null && typeof m === "object" && !Array.isArray(m) ? (m as Record<string, unknown>) : {};
}

function migrate(def: SettingDef, authored: unknown, fromVersion: number, layer: boolean): ChainResult {
  const sv = def.storeVersion ?? 1;
  if (fromVersion >= sv) return { ok: true, value: authored };
  const out = runChain(def, authored, fromVersion);
  if (!out.ok) return out;
  const issues = checkSchema(def, out.value, { layer });
  return issues.length === 0
    ? out
    : { ok: false, message: `migration ${fromVersion} -> ${sv} gives a value that fails the schema: ${firstIssueText(issues)}` };
}

function labelOlder(def: SettingDef, older: OlderStoreName, authored: unknown, current: unknown, baseline: unknown, layer: boolean): OlderNameRead {
  const migrated = migrate(def, authored, older.version, layer);
  const value = migrated.ok ? migrated.value : authored;
  const label: OlderLabel =
    migrated.ok && canonicalJson(value) === canonicalJson(current) ? "leftover" : baseline === valueHash(authored) ? "stale" : "diverged";
  const read: OlderNameRead = { storeName: older.name, storedVersion: older.version, label, value, authored };
  if (!migrated.ok) read.migrationError = migrated.message;
  return read;
}

/**
 * The key's value in one store section. `layer` picks the schema a
 * migrated value must pass: a deep-merge store value is one partial layer.
 */
export function readSection(def: SettingDef, section: Record<string, unknown> | undefined, opts: { layer: boolean }): SectionRead {
  if (!section) return { present: false, older: [] };
  const found = olderStoreNames(def).filter((o) => section[o.name] !== undefined);
  const current = currentStoreName(def);
  if (section[current] !== undefined) {
    const value = section[current];
    const baselines = baselinesOf(section);
    const older = found.map((o) => labelOlder(def, o, section[o.name], value, baselines[o.name], opts.layer));
    return { present: true, storeName: current, storedVersion: def.storeVersion ?? 1, value, authored: value, older };
  }
  const top = found[0];
  if (!top) return { present: false, older: [] };
  const authored = section[top.name];
  const migrated = migrate(def, authored, top.version, opts.layer);
  const read: SectionRead = { present: true, storeName: top.name, storedVersion: top.version, value: migrated.ok ? migrated.value : authored, authored, older: [] };
  if (!migrated.ok) read.migrationError = migrated.message;
  return read;
}

const RANK: Record<OlderLabel, number> = { leftover: 0, stale: 1, diverged: 2 };

export function worstLabel(older: OlderNameRead[]): OlderLabel | undefined {
  let worst: OlderLabel | undefined;
  for (const o of older) if (worst === undefined || RANK[o.label] > RANK[worst]) worst = o.label;
  return worst;
}

/**
 * The baselines a write of the current name records: only when the current
 * name is absent from the section, and only for present older names that
 * have none, so a name already diverged from an earlier bump stays so.
 */
export function baselinesToRecord(def: SettingDef, section: Record<string, unknown> | undefined): Record<string, string> {
  if (!section || section[currentStoreName(def)] !== undefined) return {};
  const existing = baselinesOf(section);
  const out: Record<string, string> = {};
  for (const o of olderStoreNames(def)) {
    if (section[o.name] === undefined || existing[o.name] !== undefined) continue;
    out[o.name] = valueHash(section[o.name]);
  }
  return out;
}
