import type { SettingDefWire } from '@mattstack/settings-kit/react';
import type { SchemaIssue } from '@mattstack/settings-kit/shapes';

import { repoLabel, rungBase } from './view';

export type WireIssue = NonNullable<SettingDefWire['issues']>[number];

export interface DivergedIssue extends WireIssue {
  kind: 'diverged';
  storeName: string;
  olderValue: unknown;
  currentValue: unknown;
}

export function isDiverged(issue: WireIssue): issue is DivergedIssue {
  return issue.kind === 'diverged' && typeof issue.storeName === 'string';
}

/** The layer an issue lives in, with its repo when it is a repo section's. */
export function issueWhere(issue: WireIssue): string {
  const base = rungBase(issue.scope) ?? issue.scope;
  return issue.repo ? `${base} · ${repoLabel(issue.repo)}` : base;
}

export function issueLine(issue: WireIssue): string {
  return `${issueWhere(issue)} · ${issueText(issue)}`;
}

export function issuePath(path: (string | number)[]): string {
  if (path.length === 0) return '(root)';
  return path
    .map((p, i) => (typeof p === 'number' ? `[${p}]` : i === 0 ? p : `.${p}`))
    .join('');
}

export function issueText(issue: SchemaIssue): string {
  return `${issuePath(issue.path)}: ${issue.message}`;
}

/** The issues inside one entry, with their paths made relative to it. */
export function issuesUnder(
  issues: SchemaIssue[],
  head: string | number
): SchemaIssue[] {
  return issues
    .filter(i => i.path[0] === head)
    .map(i => ({ ...i, path: i.path.slice(1) }));
}

function valueAt(value: unknown, path: (string | number)[]): unknown {
  let at = value;
  for (const p of path) {
    if (at === null || typeof at !== 'object') return undefined;
    at = (at as Record<string | number, unknown>)[p];
  }
  return at;
}

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

/** Entries carry no identity, so an index in `path` still names the entry
    it was reported on only while its list keeps its length and every other
    entry in it is unchanged: a move, a removal or an add renumbers it. */
function indexesHold(
  stored: unknown,
  draft: unknown,
  path: (string | number)[]
): boolean {
  return path.every((seg, k) => {
    if (typeof seg !== 'number') return true;
    const before = valueAt(stored, path.slice(0, k));
    const after = valueAt(draft, path.slice(0, k));
    return (
      Array.isArray(before) &&
      Array.isArray(after) &&
      before.length === after.length &&
      before.every((entry, j) => j === seg || same(entry, after[j]))
    );
  });
}

/** Issues the store reported on a layer that the draft has not touched:
    one stays while the value at its path is still the stored one, so a
    field the server refused shows its error even where the local check
    passes it, and drops once the user edits that value or renumbers the
    entry it sits in. */
export function standingIssues(
  reported: SchemaIssue[],
  stored: unknown,
  draft: unknown,
  checked: SchemaIssue[]
): SchemaIssue[] {
  const seen = new Set(checked.map(issueText));
  const out: SchemaIssue[] = [];
  for (const issue of reported) {
    const key = issueText(issue);
    if (seen.has(key)) continue;
    if (!same(valueAt(stored, issue.path), valueAt(draft, issue.path)))
      continue;
    if (!indexesHold(stored, draft, issue.path)) continue;
    seen.add(key);
    out.push(issue);
  }
  return out;
}

const REQUIRED_RE = /^required property/;

/** A short word where one exists ("required" for a missing required
    property), the checker's own message otherwise. */
export function shortIssue(issue: SchemaIssue): string {
  return REQUIRED_RE.test(issue.message) ? 'required' : issue.message;
}

export interface FooterSummary {
  touchedText: string | null;
  noteText: string | null;
  fallbackText: string | null;
}

/** A footer issue's leading card reference: item cards number by position
    (`#N`), named sections by the entry's own name -- both are `path[0]`. */
export type CardKey = string | number;

function isCardKey(v: unknown): v is CardKey {
  return typeof v === 'number' || typeof v === 'string';
}

function cardLabel(card: CardKey): string {
  return typeof card === 'number' ? `#${card + 1}` : card;
}

/** `<card> field: message` when the issue carries a card key, `issueText`'s
    plain `path: message` otherwise (a list- or map-level issue, path []). */
function fallbackIssueText(issue: SchemaIssue): string {
  const card = issue.path[0];
  if (!isCardKey(card)) return issueText(issue);
  const field = issue.path[1];
  const short = shortIssue(issue);
  return typeof field === 'string'
    ? `${cardLabel(card)} ${field}: ${short}`
    : `${cardLabel(card)}: ${short}`;
}

/** Field names with an issue, grouped by their card key -- the seed for a
    form opened on a nonconforming stored value: it starts touched on its
    own bad fields, so the field shows its error immediately rather than
    waiting for the user to touch it first. */
export function issuesByCard(
  issues: SchemaIssue[]
): Map<CardKey, ReadonlySet<string>> {
  const out = new Map<CardKey, Set<string>>();
  for (const issue of issues) {
    const card = issue.path[0];
    const field = issue.path[1];
    if (!isCardKey(card) || typeof field !== 'string') continue;
    const set = out.get(card) ?? new Set<string>();
    set.add(field);
    out.set(card, set);
  }
  return out;
}

/** The item/section cards footer's three lines: the first issue on a
    touched field (numbered to match its card header, or named to match its
    section), a count of empty required fields for every card whose issues
    are all untouched, and a fallback for the first remaining issue those two
    lines never speak for -- a card-level or list-level issue (no field in
    its path), or an issue on an untouched, non-required field. Without the
    fallback, an issue in one of those shapes leaves Save disabled with
    nothing on screen explaining why. `issues` carries the card key as
    `path[0]`, so a shape other than a list or map of objects never matches
    the touched or note line, only the fallback. */
export function footerSummary(
  issues: SchemaIssue[],
  touched: ReadonlyMap<CardKey, ReadonlySet<string>>
): FooterSummary {
  const byCard = new Map<CardKey, SchemaIssue[]>();
  for (const issue of issues) {
    const card = issue.path[0];
    if (!isCardKey(card)) continue;
    const list = byCard.get(card);
    if (list) list.push(issue);
    else byCard.set(card, [issue]);
  }

  const isTouched = (issue: SchemaIssue): boolean => {
    const card = issue.path[0];
    const field = issue.path[1];
    return (
      isCardKey(card) &&
      typeof field === 'string' &&
      (touched.get(card)?.has(field) ?? false)
    );
  };

  let touchedText: string | null = null;
  for (const issue of issues) {
    if (!isTouched(issue)) continue;
    const card = issue.path[0] as CardKey;
    const field = issue.path[1] as string;
    touchedText = `${cardLabel(card)} ${field}: ${shortIssue(issue)}`;
    break;
  }

  const cardOrder = [...byCard.keys()];
  if (cardOrder.every(c => typeof c === 'number'))
    cardOrder.sort((a, b) => (a as number) - (b as number));
  const untouchedCards: CardKey[] = [];
  for (const card of cardOrder) {
    const list = byCard.get(card)!;
    if (list.some(isTouched)) continue;
    if (list.some(i => REQUIRED_RE.test(i.message))) untouchedCards.push(card);
  }
  let noteText: string | null = null;
  if (untouchedCards.length > 0) {
    const count = untouchedCards.reduce(
      (sum: number, card) =>
        sum + byCard.get(card)!.filter(i => REQUIRED_RE.test(i.message)).length,
      0
    );
    const names = untouchedCards.map(cardLabel).join(', ');
    const verb = untouchedCards.length === 1 ? 'has' : 'have';
    noteText = `${names} ${verb} ${count} empty required field${count === 1 ? '' : 's'}`;
  }

  const isNoted = (issue: SchemaIssue): boolean => {
    const card = issue.path[0];
    return (
      isCardKey(card) &&
      untouchedCards.includes(card) &&
      REQUIRED_RE.test(issue.message)
    );
  };
  let fallbackText: string | null = null;
  for (const issue of issues) {
    if (isTouched(issue) || isNoted(issue)) continue;
    fallbackText = fallbackIssueText(issue);
    break;
  }

  return { touchedText, noteText, fallbackText };
}
