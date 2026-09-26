import type {
  ExplainRowWire,
  SettingDefWire,
} from '@mattstack/settings-kit/react';
import {
  getLeaf,
  matchesShape as matchesKitShape,
  recognize,
  setLeaf,
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
  targetScope,
  type LeafType,
} from '@mattstack/settings-kit/shapes';

export type ConfigDef = SettingDefWire;

/** The target layer's own authored value, from the key's explain rows. */
export function ownValue(rows: ExplainRowWire[], target: string): unknown {
  return rows.find(r => r.scope === target && r.present)?.value;
}

/** The object to write to `target` after changing one field. A deep-merged
    key's effective value is the merge of the default and every layer, so the
    edit starts from the target layer's own value instead, or it would bake
    the default and other layers into that store. A removed leaf takes any
    parent it leaves empty with it, so emptying a layer's last field reads as
    an empty object and the caller can clear the layer. */
export function leafWrite(
  rows: ExplainRowWire[],
  target: string,
  path: string,
  value: unknown
): Record<string, unknown> {
  let next = setLeaf(ownValue(rows, target), path, value);
  if (value !== undefined) return next;
  const parts = path.split('.');
  for (let i = parts.length - 1; i > 0; i--) {
    const parent = parts.slice(0, i).join('.');
    const obj = getLeaf(next, parent);
    if (!isRecord(obj) || Object.keys(obj).length > 0) break;
    next = setLeaf(next, parent, undefined);
  }
  return next;
}

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

/** A board composite row's editor: board's own for the keys settings-kit
    marks `external`, else the widget matching the kind settings-kit
    recognizes from the def's schema. Board has widgets for string lists and
    leaves only; any other kind has no editor here. */
export function shapeOf(
  def: Pick<ConfigDef, 'key' | 'schema'>
): CompositeShape | undefined {
  const own = BOARD_EDITORS[def.key];
  if (own) return own;
  const r = recognize(def.schema);
  if (r.kind === 'stringList') return { kind: 'stringList' };
  // A bare `{ type: 'object' }` recognizes as leaves with no fields: there is
  // nothing to draw.
  if (r.kind === 'leaves' && Object.keys(r.fields).length > 0)
    return { kind: 'leaves', fields: r.fields, fallbacks: r.placeholders };
  return undefined;
}

export type RowKind = 'scalar' | CompositeShape['kind'] | 'readonly';

export function rowKind(def: ConfigDef): RowKind {
  const shape = shapeOf(def);
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
