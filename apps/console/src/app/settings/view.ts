import type {
  ExplainRowWire,
  SettingDefWire,
} from '@mattstack/settings-kit/react';
import {
  ENUMS,
  filterDefs,
  getLeaf,
  isSet,
  setLeaf,
  targetScope,
  type RowKind,
} from '@mattstack/settings-kit/shapes';

import { editorKind } from './formShape';
import { groupOf, GROUPS, type Group } from './groups';

export type StoreScope = 'team' | 'user' | 'machine';
export type ScopeFilter = 'any' | StoreScope;

export interface ViewFilter {
  query: string;
  changedOnly: boolean;
  editableOnly: boolean;
  needsFixing: boolean;
  scope: ScopeFilter;
}

export const NO_FILTER: ViewFilter = {
  query: '',
  changedOnly: false,
  editableOnly: false,
  needsFixing: false,
  scope: 'any',
};

export function needsFixing(def: SettingDefWire): boolean {
  return (def.issues?.length ?? 0) > 0 || (def.mergedIssues?.length ?? 0) > 0;
}

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

export type RungScope = 'team.repo' | 'user.repo' | 'machine.repo';
/** A store layer, or a store's section for the picked repo. */
export type LayerScope = StoreScope | RungScope;

export function isRung(s: string | null | undefined): s is RungScope {
  return s === 'team.repo' || s === 'user.repo' || s === 'machine.repo';
}

/** The store a layer lives in: `team.repo` is the team store's repo
    section. */
export function rungBase(s: string | null | undefined): StoreScope | null {
  if (isStoreScope(s)) return s;
  return isRung(s) ? (s.slice(0, -'.repo'.length) as StoreScope) : null;
}

export function rungOf(scope: StoreScope, repo: string | null): LayerScope {
  return repo ? (`${scope}.repo` as RungScope) : scope;
}

/** How a layer reads in UI copy: a rung as its store name plus `· repo`, a
    global layer as its own name. The one source every layer-naming string
    reads from, so a rung and its global layer never share an accessible
    name. */
export function layerLabel(scope: LayerScope): string {
  return isRung(scope) ? `${rungBase(scope)} · repo` : scope;
}

/** A repo identity's display label: everything after the host, the same
    rule settings-kit's /repos uses. */
export function repoLabel(identity: string): string {
  const at = identity.indexOf('/');
  return at < 0 ? identity : identity.slice(at + 1);
}

export interface WriteTarget {
  scope: StoreScope;
  repo?: string;
}

/** Where an edit of `def` lands. With a repo picked, a repo-scoped key
    writes that repo's section of the layer its value comes from, so a value
    inherited from a global layer gets a repo override rather than a global
    write; with no allowed winning layer, the key's first scope. */
export function writeTarget(
  def: SettingDefWire,
  repo: string | null
): WriteTarget {
  if (def.repoScoped && repo) {
    const base = rungBase(def.effective.scope);
    const scope =
      base && (def.scopes as readonly string[]).includes(base)
        ? base
        : (def.scopes[0] as StoreScope);
    return { scope, repo };
  }
  return { scope: targetScope(def) as StoreScope };
}

export function targetLabel(t: WriteTarget): string {
  return t.repo ? `${t.scope} · ${repoLabel(t.repo)}` : t.scope;
}

/** A layer line's scope as a write target; a repo rung needs the picked
    repo. */
export function targetAt(at: string, repo: string | null): WriteTarget | null {
  const scope = rungBase(at);
  if (!scope) return null;
  if (!isRung(at)) return { scope };
  return repo ? { scope, repo } : null;
}

/** Row kinds console draws an editor for. */
export const EDITOR_KINDS: ReadonlySet<RowKind> = new Set<RowKind>([
  'scalar',
  'enum',
  'stringList',
  'stringMap',
  'leaves',
  'objectList',
  'objectMap',
  'json',
]);

/** A hash rt writes when the user approves the team's worktree `ready`
    commands; console never edits it, only revokes it. */
export const APPROVAL_KEY = 'rt.worktreeReadyApproval';

export function isEditable(def: SettingDefWire): boolean {
  if (def.key === APPROVAL_KEY) return false;
  return EDITOR_KINDS.has(editorKind(def));
}

export function applyFilter(
  defs: SettingDefWire[],
  f: ViewFilter
): SettingDefWire[] {
  return filterDefs(defs, f.query).filter(
    d =>
      (!f.changedOnly || isSet(d)) &&
      (!f.editableOnly || isEditable(d)) &&
      (!f.needsFixing || needsFixing(d)) &&
      (f.scope === 'any' || rungBase(d.effective.scope) === f.scope)
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
): LayerScope | null {
  const scope = def.effective.scope;
  if (isRung(scope)) return scope;
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
): LayerScope | 'default' | null {
  for (const r of [...rows].reverse()) {
    if (!r.present || r.shadowed || r.invalid) continue;
    if (getLeaf(r.value, path) === undefined) continue;
    if (r.scope === 'default' || isStoreScope(r.scope) || isRung(r.scope))
      return r.scope;
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
