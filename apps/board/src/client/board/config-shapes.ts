import type { SettingDefWire } from '@mattstack/settings-kit/react';
import {
  matchesShape as matchesKitShape,
  SHAPES,
  type CompositeShape as KitShape,
} from '@mattstack/settings-kit/shapes';

export {
  addToList,
  filterDefs,
  formatValue,
  getLeaf,
  isSet,
  parseScalar,
  setLeaf,
  type LeafType,
} from '@mattstack/settings-kit/shapes';

export type ConfigDef = SettingDefWire;

export type CompositeShape =
  | Exclude<KitShape, { kind: 'external' }>
  | { kind: 'roster' }
  | { kind: 'tabs' };

/** settings-kit marks these `external`; the board owns their editors. */
const BOARD_EDITORS: Record<string, CompositeShape> = {
  'board.tabs': { kind: 'tabs' },
  'board.members': { kind: 'roster' },
  'board.hiddenMembers': { kind: 'roster' },
};

/** The board's composite keys: settings-kit's declarations, with the three
    keys whose editors live here mapped back to their board kinds. rt
    validates only the top-level type, so these shapes are what keep a
    written value readable by `parseConfig`. */
export const COMPOSITE_SHAPES: Record<string, CompositeShape> =
  Object.fromEntries(
    Object.entries(SHAPES)
      .filter(([key]) => key.startsWith('board.'))
      .map(([key, shape]) => [
        key,
        BOARD_EDITORS[key] ?? (shape as CompositeShape),
      ])
  );

export type RowKind = 'scalar' | CompositeShape['kind'] | 'readonly';

export function rowKind(def: ConfigDef): RowKind {
  const shape = COMPOSITE_SHAPES[def.key];
  if (shape?.kind === 'roster') return 'roster';
  if (shape?.kind === 'tabs') return 'tabs';
  if (def.secret || !def.writable) return 'readonly';
  if (def.type === 'object' || def.type === 'array')
    return shape?.kind ?? 'readonly';
  return 'scalar';
}

export function scopeLabel(scope: string): string {
  return scope === 'machine' ? 'machine' : `${scope} · local until pushed`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function matchesShape(shape: CompositeShape, value: unknown): boolean {
  if (shape.kind === 'roster') return Array.isArray(value);
  if (shape.kind === 'tabs')
    return (
      Array.isArray(value) &&
      value.length > 0 &&
      value.every(isTabLike) &&
      new Set(value.map(t => (t as { id: string }).id)).size === value.length
    );
  return matchesKitShape(shape, value);
}

/** Mirrors the server's parseTabs closely enough that the editor never
    renders a value the next boot would refuse. */
function isTabLike(v: unknown): boolean {
  if (!isRecord(v)) return false;
  if (
    typeof v.id !== 'string' ||
    v.id === '' ||
    typeof v.label !== 'string' ||
    v.label === ''
  )
    return false;
  if (v.slackChannel !== undefined && typeof v.slackChannel !== 'string')
    return false;
  if (v.reviewSkill !== undefined && typeof v.reviewSkill !== 'string')
    return false;
  const src = v.source;
  if (!isRecord(src)) return false;
  if (src.kind === 'authors') return true;
  if (src.kind !== 'codeowners') return false;
  if (typeof src.section !== 'string' || src.section === '') return false;
  return (
    src.excludeMembers === undefined || typeof src.excludeMembers === 'boolean'
  );
}

/** A tab id from its label: lowercase, runs of anything but [a-z0-9] become
    one dash, suffixed until it clears `taken`. */
export function slugTabId(label: string, taken: Iterable<string>): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'tab';
  const used = new Set(taken);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

const SCOPE_ORDER = ['team', 'user', 'machine'] as const;

export function groupByScope(
  defs: ConfigDef[]
): Array<{ scope: string; defs: ConfigDef[] }> {
  return SCOPE_ORDER.map(scope => ({
    scope,
    defs: defs.filter(d => d.scopes[0] === scope),
  })).filter(g => g.defs.length > 0);
}

export function rosterSummary(members: unknown, hidden: unknown): string {
  const roster = Array.isArray(members) ? members.filter(isRecord) : [];
  if (roster.length === 0) return 'no members';
  // board.hiddenMembers replaces the roster's inline `hidden` flags rather
  // than adding to them (withBoardStoreFallback), and it may name people who
  // are not on this roster at all: it is boxscore's overlay too.
  const onRoster = new Set(
    roster
      .map(m => m.username)
      .filter((u): u is string => typeof u === 'string')
  );
  const overlay = Array.isArray(hidden)
    ? hidden.filter((h): h is string => typeof h === 'string')
    : null;
  const inline = roster
    .filter(m => m.hidden === true && typeof m.username === 'string')
    .map(m => m.username as string);
  const hiddenNames = new Set<string>(
    (overlay ?? inline).filter(u => onRoster.has(u))
  );
  const head = `${roster.length} member${roster.length === 1 ? '' : 's'}`;
  return hiddenNames.size > 0 ? `${head}, ${hiddenNames.size} hidden` : head;
}
