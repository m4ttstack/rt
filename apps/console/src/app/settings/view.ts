import type {
  ExplainRowWire,
  SettingDefWire,
} from '@mattstack/settings-kit/react';
import {
  ENUMS,
  filterDefs,
  getLeaf,
  isSet,
  rowKind,
  setLeaf,
} from '@mattstack/settings-kit/shapes';

import { groupOf, GROUPS, type Group } from './groups';

export type StoreScope = 'team' | 'user' | 'machine';
export type ScopeFilter = 'any' | StoreScope;

export interface ViewFilter {
  query: string;
  changedOnly: boolean;
  editableOnly: boolean;
  scope: ScopeFilter;
}

export const NO_FILTER: ViewFilter = {
  query: '',
  changedOnly: false,
  editableOnly: false,
  scope: 'any',
};

export const SUBHEAD_THRESHOLD = 12;
const SUB_ORDER: StoreScope[] = ['team', 'user', 'machine'];

export interface Subsection {
  scope: StoreScope | null;
  defs: SettingDefWire[];
}

export interface Section {
  group: Group;
  total: number;
  shown: number;
  subsections: Subsection[];
}

export function isStoreScope(s: string | null | undefined): s is StoreScope {
  return s === 'team' || s === 'user' || s === 'machine';
}

export function isEditable(def: SettingDefWire): boolean {
  const kind = rowKind(def);
  return kind !== 'readonly' && kind !== 'external';
}

export function applyFilter(
  defs: SettingDefWire[],
  f: ViewFilter
): SettingDefWire[] {
  return filterDefs(defs, f.query).filter(
    d =>
      (!f.changedOnly || isSet(d)) &&
      (!f.editableOnly || isEditable(d)) &&
      (f.scope === 'any' || d.effective.scope === f.scope)
  );
}

const SCALAR_RANK: Record<string, number> = {
  number: 1,
  string: 2,
  boolean: 3,
};

/** Rows lead with the quick scalar controls and end with the composites that
    expand; the sort is stable, so registry order holds within a rank. */
function rowRank(d: SettingDefWire): number {
  if (ENUMS[d.key]) return 0;
  return SCALAR_RANK[d.type] ?? 4;
}

/** Every group with at least one registered key, in GROUPS order, with
    unknown first segments after them. Empty-after-filter sections are kept
    so the index can show zeros. */
export function buildSections(all: SettingDefWire[], f: ViewFilter): Section[] {
  const shownKeys = new Set(applyFilter(all, f).map(d => d.key));
  const byGroup = new Map<string, { group: Group; defs: SettingDefWire[] }>();
  for (const d of all) {
    const group = groupOf(d.key);
    const entry = byGroup.get(group.id) ?? { group, defs: [] };
    entry.defs.push(d);
    byGroup.set(group.id, entry);
  }
  const known = GROUPS.map(g => g.id);
  const extra = [...byGroup.keys()].filter(id => !known.includes(id)).sort();
  return [...known, ...extra]
    .filter(id => byGroup.has(id))
    .map(id => {
      const { group, defs } = byGroup.get(id)!;
      const shown = defs
        .filter(d => shownKeys.has(d.key))
        .sort((a, b) => rowRank(a) - rowRank(b));
      const subsections =
        defs.length > SUBHEAD_THRESHOLD
          ? SUB_ORDER.map(scope => ({
              scope,
              defs: shown.filter(d => d.scopes[0] === scope),
            })).filter(s => s.defs.length > 0)
          : [{ scope: null, defs: shown }];
      return { group, total: defs.length, shown: shown.length, subsections };
    });
}

export function badgeScope(
  def: SettingDefWire,
  subhead: StoreScope | null
): StoreScope | null {
  const scope = def.effective.scope;
  return isStoreScope(scope) && scope !== subhead ? scope : null;
}

export function sourceText(def: SettingDefWire): 'default' | 'unset' | null {
  if (def.effective.scope === 'default') return 'default';
  if (def.effective.scope === null) return 'unset';
  return null;
}

export function firstSentence(text: string): string {
  const trimmed = text.trim();
  const m = /^(.*?(?<!\be\.g|\bi\.e)[.!?])(?=\s|$)/s.exec(trimmed);
  return m ? m[1]! : trimmed;
}

export function splitKey(key: string): [ns: string, name: string] {
  const i = key.lastIndexOf('.');
  return i < 0 ? ['', key] : [key.slice(0, i + 1), key.slice(i + 1)];
}

/** Rows arrive weakest-first, so the last one that sets the field wins. */
export function fieldSource(
  rows: ExplainRowWire[],
  path: string
): StoreScope | 'default' | null {
  for (const r of [...rows].reverse()) {
    if (!r.present || r.shadowed || r.invalid) continue;
    if (getLeaf(r.value, path) === undefined) continue;
    if (r.scope === 'default' || isStoreScope(r.scope)) return r.scope;
  }
  return null;
}

/** The object to write to `target` after changing one field: the target
    layer's own authored value with that field set, so defaults and other
    layers are never copied into it. */
export function leafWrite(
  rows: ExplainRowWire[],
  target: string,
  path: string,
  value: unknown
): Record<string, unknown> {
  const own = rows.find(r => r.scope === target && r.present)?.value;
  return setLeaf(own, path, value);
}
