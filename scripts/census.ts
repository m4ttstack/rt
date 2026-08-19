#!/usr/bin/env bun
// Token census for mr-board's src/style.css — the evidence base Task 3 turns
// into theme tokens (a + c) and spacing/fontSize scales (b). Reads mr-board
// read-only; never writes there. Plain string processing, no external deps.

import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const SOURCE = join(homedir(), "Documents/GitHub/mr-board/src/style.css");
const OUT = join(import.meta.dir, "..", "docs/token-census.md");

// Rule-family prefixes census (b) groups by. Listed in the brief as
// `.tui-seg/.tui-copy/.tui-selectbox/.tui-panel*/.tui-modal*/.tui-cd*/
// .tui-drawer*/.tui-menu*/.tui-toast*/.tui-md/.tui-review/.tui-flag/.tui-dot*`.
// Matching is prefix-based for all of them (not just the starred ones): every
// family in the file has hyphenated sub-classes (e.g. `.tui-copy-inline`,
// `.tui-review-open`) that belong to the same family even where the brief's
// shorthand omitted the `*`.
const FAMILIES = [
  "tui-seg",
  "tui-copy",
  "tui-selectbox",
  "tui-panel",
  "tui-modal",
  "tui-cd",
  "tui-drawer",
  "tui-menu",
  "tui-toast",
  "tui-md",
  "tui-review",
  "tui-flag",
  "tui-dot",
] as const;

// ---------------------------------------------------------------------------
// helpers

/** Strip CSS comments so comment prose (e.g. "88%-translucent") never leaks
 * into the census as if it were a live literal. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Extract the `{ ... }` block starting at `openBraceIdx` (which must point
 * at the opening brace), honoring nested braces. Returns the body (exclusive
 * of the outer braces) and the index just past the closing brace. */
function extractBraceBlock(source: string, openBraceIdx: number): { body: string; end: number } {
  let depth = 0;
  let j = openBraceIdx;
  for (; j < source.length; j++) {
    if (source[j] === "{") depth++;
    else if (source[j] === "}") {
      depth--;
      if (depth === 0) {
        j++;
        break;
      }
    }
  }
  return { body: source.slice(openBraceIdx + 1, j - 1), end: j };
}

/**
 * Paren-counting matcher for `fnName(...)` calls, per the ported gate's
 * `stripVarExpressionsPreservingLines` worked example (soribashi's
 * packages/ui/test/no-hardcoded-values.test.ts). A naive `fnName\([^)]*\)`
 * regex stops at the FIRST `)` — for `color-mix(in srgb, var(--panel) 55%,
 * transparent)` that first `)` is the close of the nested `var(--panel)`,
 * truncating the match before the percentage or the trailing arg. Walk
 * parens instead so nested `var()` calls don't close the match early.
 */
function matchBalanced(source: string, fnName: string): string[] {
  const matches: string[] = [];
  const needle = `${fnName}(`;
  let i = 0;
  for (;;) {
    const start = source.indexOf(needle, i);
    if (start === -1) break;
    let depth = 0;
    let j = start + fnName.length; // index of the opening '(' in `fnName(`
    for (; j < source.length; j++) {
      if (source[j] === "(") depth++;
      else if (source[j] === ")") {
        depth--;
        if (depth === 0) {
          j++;
          break;
        }
      }
    }
    matches.push(source.slice(start, j));
    i = j;
  }
  return matches;
}

/** Recursively split a stylesheet into flat `{ selector, body }` rules,
 * descending into `@media`/`@supports`/`@keyframes`/other at-rule blocks so
 * their nested rules are still visible to the family matcher (harmless for
 * `@keyframes`, whose `0%, 100% { ... }` selectors never match a `.tui-*`
 * family prefix). */
function extractRules(source: string): Array<{ selector: string; body: string }> {
  const rules: Array<{ selector: string; body: string }> = [];
  let i = 0;
  while (i < source.length) {
    const braceIdx = source.indexOf("{", i);
    if (braceIdx === -1) break;
    const selector = source.slice(i, braceIdx).trim();
    const { body, end } = extractBraceBlock(source, braceIdx);
    if (selector.startsWith("@")) {
      rules.push(...extractRules(body));
    } else if (selector.length > 0) {
      rules.push({ selector, body });
    }
    i = end;
  }
  return rules;
}

/** Class tokens (`.foo`) referenced anywhere in a (possibly comma- and
 * combinator-separated) selector list. */
function classTokens(selector: string): string[] {
  return [...selector.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)].map((m) => m[1]!);
}

function bump(map: Map<string, number>, key: string, by = 1): void {
  map.set(key, (map.get(key) ?? 0) + by);
}

function sortedEntries(map: Map<string, number>): Array<[string, number]> {
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function mdTable(headers: string[], rows: Array<Array<string | number>>): string {
  const head = `| ${headers.join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${r.join(" | ")} |`).join("\n");
  return [head, sep, body].filter(Boolean).join("\n");
}

// ---------------------------------------------------------------------------
// load + prep

const raw = readFileSync(SOURCE, "utf8");
const css = stripComments(raw);

// ---------------------------------------------------------------------------
// (a) every distinct color/token literal in :root / :root.dark, by variable name

function extractRootVars(source: string, anchor: string): Array<[string, string]> {
  const anchorIdx = source.indexOf(anchor);
  if (anchorIdx === -1) throw new Error(`census: couldn't find "${anchor}" block in style.css`);
  const braceIdx = source.indexOf("{", anchorIdx);
  const { body } = extractBraceBlock(source, braceIdx);
  const decls: Array<[string, string]> = [];
  for (const m of body.matchAll(/--([a-zA-Z0-9-]+)\s*:\s*([^;]+);/g)) {
    decls.push([`--${m[1]}`, m[2]!.trim()]);
  }
  return decls;
}

const lightVars = extractRootVars(css, ":root {");
const darkVars = extractRootVars(css, ":root.dark {");

// ---------------------------------------------------------------------------
// (b) length/percent literals in the Task 8-15 rule families, grouped by family

// PLUS a separate percent pattern: a trailing `\b` after `%` never matches
// (`%` is not a word character, so `\b` only fires there if the following
// character is a word character — "55%," and "55%)" both fail), which would
// silently drop every percentage. No trailing `\b` here.
const LENGTH_RE = /\b\d*\.?\d+(?:rem|em|px|vh|vw)\b/g;
const PERCENT_RE = /\d+(?:\.\d+)?%/g;

const allRules = extractRules(css);

const familyLiterals = new Map<string, Map<string, number>>(FAMILIES.map((f) => [f, new Map()]));
const familyRuleCounts = new Map<string, number>(FAMILIES.map((f) => [f, 0]));

for (const rule of allRules) {
  const tokens = classTokens(rule.selector);
  const matchedFamilies = new Set(FAMILIES.filter((f) => tokens.some((t) => t.startsWith(f))));
  if (matchedFamilies.size === 0) continue;
  const lengths = [...rule.body.matchAll(LENGTH_RE)].map((m) => m[0]);
  const percents = [...rule.body.matchAll(PERCENT_RE)].map((m) => m[0]);
  for (const family of matchedFamilies) {
    bump(familyRuleCounts, family);
    const literalMap = familyLiterals.get(family)!;
    for (const lit of [...lengths, ...percents]) bump(literalMap, lit);
  }
}

// ---------------------------------------------------------------------------
// (c) color-mix(...) wash expressions with their percentages, file-wide

const colorMixExprs = matchBalanced(css, "color-mix");
const colorMixCounts = new Map<string, number>();
for (const expr of colorMixExprs) bump(colorMixCounts, expr);

// ---------------------------------------------------------------------------
// (d) var(--*) short-name usage census across the whole file

const VAR_RE = /var\(--([a-zA-Z0-9-]+)/g;
const varUsage = new Map<string, number>();
for (const m of css.matchAll(VAR_RE)) bump(varUsage, m[1]!);

// ---------------------------------------------------------------------------
// render

const lines: string[] = [];
lines.push("# Token census — mr-board `src/style.css`");
lines.push("");
lines.push(
  `Generated by \`scripts/census.ts\` from \`~/Documents/GitHub/mr-board/src/style.css\` (read-only source, ${raw.split("\n").length} lines). Evidence base for Task 3: (a) + (c) become theme tokens, (b) becomes spacing/fontSize scales.`,
);
lines.push("");

lines.push("## (a) `:root` / `:root.dark` variable literals");
lines.push("");
lines.push(`### Light (\`:root\`) — ${lightVars.length} variables`);
lines.push("");
lines.push(mdTable(["Variable", "Value"], lightVars.map(([name, value]) => [`\`${name}\``, `\`${value}\``])));
lines.push("");
lines.push(`### Dark (\`:root.dark\`) — ${darkVars.length} variables`);
lines.push("");
lines.push(mdTable(["Variable", "Value"], darkVars.map(([name, value]) => [`\`${name}\``, `\`${value}\``])));
lines.push("");
if (darkVars.length !== lightVars.length) {
  const lightNames = new Set(lightVars.map(([n]) => n));
  const darkNames = new Set(darkVars.map(([n]) => n));
  const onlyLight = [...lightNames].filter((n) => !darkNames.has(n));
  lines.push(
    `> Note: light has ${lightVars.length} declarations, dark has ${darkVars.length}. Dark does not redeclare ${onlyLight.map((n) => `\`${n}\``).join(", ")} — same value in both themes.`,
  );
  lines.push("");
}

lines.push("## (b) Length/percent literals by rule family");
lines.push("");
lines.push(
  "Families: `.tui-seg`, `.tui-copy`, `.tui-selectbox`, `.tui-panel*`, `.tui-modal*`, `.tui-cd*`, `.tui-drawer*`, `.tui-menu*`, `.tui-toast*`, `.tui-md`, `.tui-review`, `.tui-flag`, `.tui-dot*`. A rule counts toward every family whose class prefix appears anywhere in its (possibly comma-separated) selector.",
);
lines.push("");
for (const family of FAMILIES) {
  const literalMap = familyLiterals.get(family)!;
  const ruleCount = familyRuleCounts.get(family) ?? 0;
  const ruleWord = ruleCount === 1 ? "rule" : "rules";
  lines.push(`### \`.${family}*\` (${ruleCount} matched ${ruleWord}, ${literalMap.size} distinct literals)`);
  lines.push("");
  if (literalMap.size === 0) {
    lines.push("_no length/percent literals found_");
  } else {
    lines.push(mdTable(["Literal", "Count"], sortedEntries(literalMap).map(([lit, n]) => [`\`${lit}\``, n])));
  }
  lines.push("");
}

lines.push("## (c) `color-mix(...)` wash expressions");
lines.push("");
lines.push(
  `${colorMixExprs.length} occurrences, ${colorMixCounts.size} distinct expressions (paren-counted — see \`matchBalanced\` above).`,
);
lines.push("");
lines.push(
  mdTable(
    ["Expression", "Count", "Percentages"],
    sortedEntries(colorMixCounts).map(([expr, n]) => [
      `\`${expr}\``,
      n,
      [...expr.matchAll(PERCENT_RE)].map((m) => m[0]).join(", ") || "_none_",
    ]),
  ),
);
lines.push("");

lines.push("## (d) `var(--*)` short-name usage census (whole file)");
lines.push("");
lines.push(`${varUsage.size} distinct variables referenced via \`var(--*)\`.`);
lines.push("");
lines.push(mdTable(["Variable", "Occurrences"], sortedEntries(varUsage).map(([name, n]) => [`\`--${name}\``, n])));
lines.push("");

writeFileSync(OUT, lines.join("\n"));
console.log(`wrote ${OUT}`);
console.log(`(a) light vars: ${lightVars.length}, dark vars: ${darkVars.length}`);
console.log(`(b) families with literals: ${[...familyLiterals.entries()].filter(([, m]) => m.size > 0).length}/${FAMILIES.length}`);
console.log(`(c) color-mix expressions: ${colorMixExprs.length} occurrences, ${colorMixCounts.size} distinct`);
console.log(`(d) var(--*) distinct names: ${varUsage.size}`);
