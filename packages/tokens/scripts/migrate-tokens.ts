import { readFileSync, writeFileSync } from 'node:fs';
import {
  generate,
  parse,
  walk,
  type CssNode,
  type Declaration,
  type FunctionNode,
  type StyleSheet,
} from 'css-tree';

export type Band = 'body' | 'meta' | 'small';
export interface Rename {
  property: string;
  from: string;
  to: string;
  band: Band | null;
  unresolved: boolean;
  line: number;
}
export interface Unresolved {
  line: number;
  text: string;
}

const HUE_OF: Record<string, string> = {
  accent: 'accent',
  green: 'ok',
  red: 'bad',
  amber: 'warn',
  purple: 'purple',
  cyan: 'cyan',
};
const TEXT_ALIAS: Record<string, string> = {
  '--accent-text': 'accent',
  '--red-text': 'bad',
  '--tk-accent-text': 'accent',
  '--tk-red-text': 'bad',
  '--tk-green-text': 'ok',
  '--tk-amber-text': 'warn',
};
const NEUTRAL_TEXT = new Set([
  '--muted-text',
  '--text-muted-on-card',
  '--muted',
  '--tk-muted-text',
  '--tk-muted-on-card',
  '--tk-muted',
]);
const DOT: Record<string, string> = {
  '--dot-ok': '--fill-ok',
  '--dot-warn': '--fill-warn',
  '--dot-bad': '--fill-bad',
  '--tk-dot-ok': '--tk-fill-ok',
  '--tk-dot-warn': '--tk-fill-warn',
  '--tk-dot-bad': '--tk-fill-bad',
};
// The spec forbids `--fill-*` in `color`; a dot in color routes to its hue's
// text token by band instead, same as any other hue name.
const DOT_HUE: Record<string, string> = {
  '--dot-ok': 'ok',
  '--dot-warn': 'warn',
  '--dot-bad': 'bad',
  '--tk-dot-ok': 'ok',
  '--tk-dot-warn': 'warn',
  '--tk-dot-bad': 'bad',
};
// --surface-inset and --surface-overlay are deliberately absent: nothing
// emits --inset or --overlay (only --surface-inset, --surface-overlay,
// --page and --raised are emitted), so a rename onto them would target a
// name that does not exist (R14).
const SURFACE: Record<string, string> = {
  '--bg': '--page',
};
const TYPE_STEP_BAND: Record<string, Band> = {
  display: 'body',
  title: 'body',
  body: 'body',
  meta: 'meta',
  small: 'small',
  micro: 'small',
  lead: 'body',
  '2xs': 'small',
  small_tk: 'small',
  '3xs': 'small',
  '4xs': 'small',
  '5xs': 'small',
};
const BAND_TEXT: Record<Band, string> = {
  body: '--text-2',
  meta: '--text-3',
  small: '--text-4',
};

// The character right after a prefix match must end the selector or open a new
// compound/combinator/pseudo; otherwise ".row" would wrongly feed ".rowdy".
const PREFIX_BOUNDARY = /^[-_.: >,[]/;

const isColor = (p: string) => p === 'color' || p === '-webkit-text-fill-color';
const isFillish = (p: string) => p.startsWith('background') || p === 'fill';
const isBorderish = (p: string) =>
  p.startsWith('border') || p.startsWith('outline') || p === 'scrollbar-color';

function isPrefixOf(sel: string, prefix: string): boolean {
  if (!sel.startsWith(prefix)) return false;
  const rest = sel.slice(prefix.length);
  return rest === '' || PREFIX_BOUNDARY.test(rest);
}

function bandFromSize(value: string, rootPx: number): Band | null {
  const step =
    /var\(--type-([a-z]+)\)/.exec(value)?.[1] ??
    /var\(--tk-fs-([a-z0-9]+)\)/.exec(value)?.[1];
  if (step)
    return (
      TYPE_STEP_BAND[
        step === 'small' && value.includes('--tk-fs') ? 'small_tk' : step
      ] ?? null
    );
  const px = /^([\d.]+)px$/.exec(value)?.[1];
  const rem = /^([\d.]+)r?em$/.exec(value)?.[1];
  const size = px ? Number(px) : rem ? Number(rem) * rootPx : NaN;
  if (Number.isNaN(size)) return null;
  return size >= 14 ? 'body' : size >= 12.5 ? 'meta' : 'small';
}

function hueOf(name: string): { hue: string; tk: boolean } | null {
  const tk = name.startsWith('--tk-');
  const bare = tk ? name.slice(5) : name.slice(2);
  const hue = HUE_OF[bare];
  return hue ? { hue, tk } : null;
}

function target(
  name: string,
  property: string,
  band: Band | null,
  hover: boolean
): { to: string; unresolved: boolean } | null {
  const tk = name.startsWith('--tk-');
  const pre = tk ? '--tk-' : '--';
  if (isColor(property)) {
    if (name === '--fg' || name === '--tk-fg')
      return { to: `${pre}text-1`, unresolved: false };
    if (name === '--ui-text-dimmed')
      return { to: '--ui-text-4', unresolved: false };
    if (name === '--ui-text-muted') return null;
    if (NEUTRAL_TEXT.has(name))
      return {
        to: `${pre}${BAND_TEXT[band ?? 'meta'].slice(2)}`,
        unresolved: band === null,
      };
    const dotHue = DOT_HUE[name];
    const alias = TEXT_ALIAS[name];
    const hue = dotHue ?? alias ?? hueOf(name)?.hue;
    if (hue) {
      const small = band === 'small' || band === 'meta' || band === null;
      return {
        to: `${pre}text-${hue}${small ? '-small' : ''}`,
        unresolved: band === null,
      };
    }
    return null;
  }
  if (DOT[name]) return { to: DOT[name]!, unresolved: false };
  if (isFillish(property) || isBorderish(property)) {
    const h = hueOf(name);
    if (h)
      return {
        to: `${pre}fill-${h.hue}${hover && isFillish(property) ? '-hover' : ''}`,
        unresolved: false,
      };
    if (SURFACE[name] && isFillish(property))
      return { to: SURFACE[name]!, unresolved: false };
  }
  return null;
}

// A CSS-nested rule's own prelude is written relative to its parent
// ("&:hover", or a bare ".label" meaning "<parent> .label"). Band inheritance
// and hover detection need the fully expanded selector, not the literal text.
function expandSelector(own: string, parentSel: string): string {
  return own
    .split(',')
    .map(part => {
      const trimmed = part.trim();
      return trimmed.includes('&')
        ? trimmed.replaceAll('&', parentSel)
        : `${parentSel} ${trimmed}`;
    })
    .join(', ');
}

interface ResolvedRule {
  sel: string;
  hover: boolean;
  declarations: Declaration[];
  // Added to a loc.line captured within this rule's own subtree to get the
  // absolute file line; nonzero only for a rule recovered from a Raw block
  // (see tryParseRawAsRule), whose re-parse numbers lines from 1 again.
  lineOffset: number;
}

// css-tree only recognizes a nested rule when its selector starts with `&`;
// a bare nested selector (".label { ... }" inside another rule, no `&`)
// parses as an opaque Raw block instead, and css-tree lumps EVERY sibling
// non-& nested rule from the first one to the end of the parent block into
// that one Raw node. Re-parsing with the `rule` context assumes a single
// rule and throws on a second sibling; `stylesheet` parses however many
// sibling rules the block holds.
function tryParseRawAsRule(text: string): StyleSheet | null {
  try {
    const reparsed = parse(text, { context: 'stylesheet', positions: true });
    return reparsed.type === 'StyleSheet' ? reparsed : null;
  } catch {
    return null;
  }
}

// A declaration that trails a sibling nested rule lands in the SAME Raw as
// that rule (css-tree sweeps everything after the first non-& selector to
// the end of the parent block); once the Raw text has no `{` left, parsing
// it as a declaration list recovers it directly.
function parseDeclarationList(text: string): Declaration[] {
  try {
    const reparsed = parse(text, {
      context: 'declarationList',
      positions: true,
    });
    return reparsed.type === 'DeclarationList'
      ? [...reparsed.children].filter(
          (c): c is Declaration => c.type === 'Declaration'
        )
      : [];
  } catch {
    return [];
  }
}

function collectRules(
  children: Iterable<CssNode>,
  parentSel: string | undefined,
  lineOffset: number,
  out: ResolvedRule[]
): void {
  for (const child of children) {
    if (child.type === 'Rule') {
      const own = generate(child.prelude);
      const sel =
        parentSel === undefined ? own : expandSelector(own, parentSel);
      const declarations: Declaration[] = [];
      const nested: CssNode[] = [];
      for (const c of child.block.children) {
        if (c.type === 'Declaration') declarations.push(c);
        else nested.push(c);
      }
      out.push({ sel, hover: /:hover/.test(sel), declarations, lineOffset });
      collectRules(nested, sel, lineOffset, out);
    } else if (child.type === 'Atrule' && child.block) {
      collectRules(child.block.children, parentSel, lineOffset, out);
    } else if (child.type === 'Raw') {
      const rawLine = child.loc?.start.line ?? 1;
      const absLine = rawLine + lineOffset - 1;
      if (!child.value.includes('{')) {
        // No rule left to recover, only trailing declarations of the block
        // this Raw sits in; reparsing this as 'stylesheet' would just hand
        // the identical text back as another Raw, forever.
        if (parentSel !== undefined)
          out.push({
            sel: parentSel,
            hover: /:hover/.test(parentSel),
            declarations: parseDeclarationList(child.value),
            lineOffset: absLine,
          });
        continue;
      }
      const reparsed = tryParseRawAsRule(child.value);
      if (!reparsed) continue;
      // A reparse that recovers no Rule made no progress on this text
      // (malformed CSS); recursing on it would repeat the same reparse
      // forever until the call stack overflows, so give up on it instead.
      const madeProgress = [...reparsed.children].some(c => c.type === 'Rule');
      if (!madeProgress) continue;
      collectRules(reparsed.children, parentSel, absLine, out);
    }
  }
}

export function planRenames(css: string, rootPx: number): Rename[] {
  const ast = parse(css, { positions: true }) as StyleSheet;
  const rules: ResolvedRule[] = [];
  collectRules(ast.children, undefined, 0, rules);

  const sizes = new Map<string, string>();
  for (const rule of rules) {
    for (const d of rule.declarations) {
      if (d.property === 'font-size') sizes.set(rule.sel, generate(d.value));
    }
  }
  const sizeFor = (sel: string): string | undefined => {
    if (sizes.has(sel)) return sizes.get(sel);
    const base = sel.replace(/:[a-z-]+(\(.*\))?$/, '');
    let bestKey: string | undefined;
    for (const key of sizes.keys()) {
      if (
        isPrefixOf(base, key) &&
        (bestKey === undefined || key.length > bestKey.length)
      )
        bestKey = key;
    }
    return bestKey === undefined ? undefined : sizes.get(bestKey);
  };

  const out: Rename[] = [];
  for (const rule of rules) {
    const size = sizeFor(rule.sel);
    const band = size === undefined ? null : bandFromSize(size, rootPx);
    for (const d of rule.declarations) {
      walk(d.value as CssNode, {
        visit: 'Function',
        enter(fn: FunctionNode) {
          if (fn.name !== 'var') return;
          const first = fn.children.first;
          if (!first || first.type !== 'Identifier') return;
          const t = target(first.name, d.property, band, rule.hover);
          if (!t) return;
          out.push({
            property: d.property,
            from: first.name,
            to: t.to,
            band: isColor(d.property) ? band : null,
            unresolved: t.unresolved,
            line:
              (fn.loc?.start.line ?? d.loc?.start.line ?? 0) + rule.lineOffset,
          });
        },
      });
    }
  }
  return out;
}

// Two renames on the same line can share a `from` name (one exact, one with
// a fallback), so matching by substring alone can grab the wrong one out of
// source order. `cursor` pins each search to start after the previous
// rename's replacement, and the boundary check after the name (`)` or `,`)
// rejects a longer var name that merely starts with this one.
function applyRenamesToLine(line: string, renames: Rename[]): string {
  let result = line;
  let cursor = 0;
  for (const r of renames) {
    const pattern = `var(${r.from}`;
    let idx = result.indexOf(pattern, cursor);
    while (idx !== -1) {
      const boundary = result[idx + pattern.length];
      if (boundary === ')' || boundary === ',') break;
      idx = result.indexOf(pattern, idx + 1);
    }
    if (idx === -1) continue;
    const replacement = `var(${r.to}`;
    result =
      result.slice(0, idx) + replacement + result.slice(idx + pattern.length);
    cursor = idx + replacement.length;
  }
  return result;
}

// Every old name the mapping tables know how to rename, minus --muted and
// --tk-muted: those two are the neutral fill outside `color` and legitimately
// stay, so flagging them as leftovers would drown the signal on every
// `border: 1px solid var(--muted)`.
const LEFTOVER_NAMES: Set<string> = new Set([
  ...[...NEUTRAL_TEXT].filter(n => n !== '--muted' && n !== '--tk-muted'),
  ...Object.keys(TEXT_ALIAS),
  ...Object.keys(DOT),
  ...Object.keys(SURFACE),
  '--fg',
  '--tk-fg',
  '--ui-text-dimmed',
  ...Object.keys(HUE_OF).flatMap(hue => [`--${hue}`, `--tk-${hue}`]),
]);

// Additive safety net for the misses `planRenames` and the tsx regex don't
// reach (a const assignment, a ternary, a JSX attribute string, a
// declaration nested inside an at-rule): scans the REWRITTEN output for any
// old name the tables know, using the same "next char is `)` or `,`"
// boundary as applyRenamesToLine so a longer name sharing a prefix doesn't
// false-match.
function findLeftovers(out: string): Unresolved[] {
  const leftover: Unresolved[] = [];
  const lines = out.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    for (const name of LEFTOVER_NAMES) {
      const pattern = `var(${name}`;
      let idx = line.indexOf(pattern);
      while (idx !== -1) {
        const boundary = line[idx + pattern.length];
        if (boundary === ')' || boundary === ',')
          leftover.push({ line: i + 1, text: line.trim() });
        idx = line.indexOf(pattern, idx + 1);
      }
    }
  }
  return leftover;
}

export function rewriteCss(
  css: string,
  rootPx: number
): {
  out: string;
  renames: Rename[];
  unresolved: Unresolved[];
  leftover: Unresolved[];
} {
  const renames = planRenames(css, rootPx);
  const lines = css.split('\n');
  const byLine = new Map<number, Rename[]>();
  for (const r of renames) {
    const list = byLine.get(r.line);
    if (list) list.push(r);
    else byLine.set(r.line, [r]);
  }
  for (const [lineNo, lineRenames] of byLine) {
    lines[lineNo - 1] = applyRenamesToLine(lines[lineNo - 1]!, lineRenames);
  }
  const unresolved: Unresolved[] = [];
  for (const r of renames) {
    if (r.unresolved)
      unresolved.push({ line: r.line, text: lines[r.line - 1]!.trim() });
  }
  const out = lines.join('\n');
  return { out, renames, unresolved, leftover: findLeftovers(out) };
}

// Style objects and template strings in TSX: `color: 'var(--tk-muted-text)'`.
// The band comes from a `fontSize` key in the same object literal when there
// is one; otherwise the rename is listed as unresolved with the meta/small
// default, exactly like CSS.
export function renameInTsx(source: string): {
  out: string;
  renames: Rename[];
  unresolved: Unresolved[];
  leftover: Unresolved[];
} {
  const unresolved: Unresolved[] = [];
  const renames: Rename[] = [];
  const lines = source.split('\n');
  const objectBand = (i: number): Band | null => {
    for (
      let j = Math.max(0, i - 6);
      j <= Math.min(lines.length - 1, i + 6);
      j++
    ) {
      const m = /fontSize:\s*['"`]([^'"`]+)['"`]/.exec(lines[j]!);
      if (m) return bandFromSize(m[1]!, 16);
    }
    return null;
  };
  for (let i = 0; i < lines.length; i++) {
    lines[i] = lines[i]!.replace(
      /(\b[a-zA-Z-]+)\s*:\s*(['"`])([^'"`]*var\(--[a-z0-9-]+\)[^'"`]*)\2/g,
      (whole, key: string, q: string, value: string) => {
        const property = key.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
        const hover = false;
        const band = isColor(property) ? objectBand(i) : null;
        const next = value.replace(
          /var\((--[a-z0-9-]+)\)/g,
          (v, name: string) => {
            const t = target(name, property, band, hover);
            if (!t) return v;
            renames.push({
              property,
              from: name,
              to: t.to,
              band: isColor(property) ? band : null,
              unresolved: t.unresolved,
              line: i + 1,
            });
            if (t.unresolved)
              unresolved.push({ line: i + 1, text: whole.trim() });
            return `var(${t.to})`;
          }
        );
        return `${key}: ${q}${next}${q}`;
      }
    );
  }
  const out = lines.join('\n');
  return { out, renames, unresolved, leftover: findLeftovers(out) };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const rootPx = Number(/--root=(\d+)/.exec(args.join(' '))?.[1] ?? 16);
  for (const file of args.filter(a => !a.startsWith('--'))) {
    const src = readFileSync(file, 'utf8');
    const res = file.endsWith('.css')
      ? rewriteCss(src, rootPx)
      : renameInTsx(src);
    for (const r of res.renames) {
      console.log(
        `${file}:${r.line}  ${r.property}: ${r.from} -> ${r.to}  [band: ${r.band ?? 'unknown'}]`
      );
    }
    for (const u of res.unresolved)
      console.log(`  UNRESOLVED ${file}:${u.line}  ${u.text}`);
    for (const l of res.leftover)
      console.log(`  LEFTOVER ${file}:${l.line}  ${l.text}`);
    if (write && res.out !== src) writeFileSync(file, res.out);
  }
}
