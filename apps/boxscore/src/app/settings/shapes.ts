/**
 * The shape layer boxscore's settings page needs for its composite (array/
 * object) rt keys. Composite rows take their editor from the kind
 * settings-kit recognizes in the def's schema; boxscore draws string lists
 * and string or number leaves, plus its own roster editor.
 */
import type { SettingDefWire } from '@mattstack/settings-kit/react';
import { matchesSchema, recognize } from '@mattstack/settings-kit/shapes';

export type ConfigDef = SettingDefWire;

export type LeafType = 'number';

export type CompositeShape =
  | { kind: 'stringList' }
  | { kind: 'leaves'; fields: Record<string, LeafType> }
  | { kind: 'roster' };

/** Keys whose editor boxscore owns regardless of their schema. */
const APP_EDITORS: Record<string, CompositeShape> = {
  'mattstack.roster': { kind: 'roster' },
};

export function shapeOf(
  def: Pick<ConfigDef, 'key' | 'schema'>
): CompositeShape | undefined {
  const own = APP_EDITORS[def.key];
  if (own) return own;
  const r = recognize(def.schema);
  if (r.kind === 'stringList') return { kind: 'stringList' };
  if (r.kind !== 'leaves' || Object.keys(r.fields).length === 0)
    return undefined;
  const fields: Record<string, LeafType> = {};
  for (const [path, type] of Object.entries(r.fields)) {
    // LeavesControl (SettingsPage.tsx) only ever draws a NumberInput; a
    // string leaf here would render in one and lose its type on save.
    if (type !== 'number') return undefined;
    fields[path] = type;
  }
  return { kind: 'leaves', fields };
}

/** boxscore.defaultRange is a plain string key; it renders as a select over
    the range presets rather than a free-text field. */
const SELECT_KEYS: Record<string, readonly string[]> = {
  'boxscore.defaultRange': ['7d', '30d', '90d'],
};

export type RowKind = 'scalar' | 'select' | CompositeShape['kind'] | 'readonly';

export function rowKind(def: ConfigDef): RowKind {
  const shape = shapeOf(def);
  if (shape?.kind === 'roster') return 'roster';
  if (def.secret || !def.writable) return 'readonly';
  if (SELECT_KEYS[def.key]) return 'select';
  if (def.type === 'object' || def.type === 'array')
    return shape?.kind ?? 'readonly';
  return 'scalar';
}

export function selectOptions(def: ConfigDef): readonly string[] {
  return SELECT_KEYS[def.key] ?? [];
}

export function isSet(def: ConfigDef): boolean {
  const scope = def.effective.scope;
  return scope != null && scope !== 'default';
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Whether a stored value still fits the schema the control writes. A
    mismatch (a hand-edited store file) renders read-only rather than a
    control that would mangle the value on save. The roster is checked by
    its own editor. */
export function matchesShape(def: ConfigDef, value: unknown): boolean {
  if (APP_EDITORS[def.key]?.kind === 'roster') return Array.isArray(value);
  return def.schema === undefined || matchesSchema(def, value);
}

export function getLeaf(obj: unknown, path: string): unknown {
  return isRecord(obj) ? obj[path] : undefined;
}

/** The next object after setting one leaf, as a shallow copy -- callers
    write this whole object back, never the single leaf. */
export function setLeaf(
  obj: unknown,
  path: string,
  value: unknown
): Record<string, unknown> {
  const base = isRecord(obj) ? { ...obj } : {};
  base[path] = value;
  return base;
}

export function formatValue(value: unknown): string {
  return value === undefined ? '' : JSON.stringify(value);
}

export interface RosterEntry {
  username: string;
  name?: string;
}

export function asRosterEntries(value: unknown): RosterEntry[] {
  if (!Array.isArray(value)) return [];
  const out: RosterEntry[] = [];
  for (const entry of value) {
    if (
      !isRecord(entry) ||
      typeof entry.username !== 'string' ||
      entry.username === ''
    )
      continue;
    out.push(
      typeof entry.name === 'string' && entry.name !== ''
        ? { username: entry.username, name: entry.name }
        : { username: entry.username }
    );
  }
  return out;
}
