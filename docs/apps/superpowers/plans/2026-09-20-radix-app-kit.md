# Radix App Migration: Group A (app-kit and the codemod)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** For app-kit and the codemod only, move its stylesheets off the transitional aliases (`--fg`, `--muted-text`, `--accent`, `--tk-muted-text`, `--gate-*`, ...) onto the ramp names the tokens package now emits, chosen per role and per size band, so that the namespace lint runs at `error` everywhere and no text reads a fill token.

**Architecture:** Part A of the ramps plan (branch `radix-palette`, Tasks 0 to 3) emits every new name and keeps every old name as an alias with the new value, so the apps already render the Radix palette; this plan is the rename that lets the aliases retire. One codemod in `packages/tokens/scripts/migrate-tokens.ts` does the property-aware renames and lists the declarations whose size band it cannot infer; each group then resolves that list by hand, flips its lint tier, and screenshots its key screens in both schemes. This file is Group A only. The other five groups run in their own worktrees from their own plan files; never touch their paths.

**Tech Stack:** bun, TypeScript, `css-tree` (codemod parser, tokens devDependency), the `local/token-namespaces` and `local/token-namespaces-css` ESLint rules from the ramps plan (Tasks 10 and 11) where they have landed, Fast Browser for screenshots.

**Spec:** `docs/superpowers/specs/2026-09-20-text-and-surface-ramps-design.md` (§4 semantic surfaces, §5 text roles, §6 size bands, §7 hue tokens, §7.2 lines and the card-scope rule, §8.1 namespaces, §9 aliases and migration).

## Base and branching

This group branches from `radix-palette` at or after the commit that lands Task 3 of the ramps plan (the tokyo emission). Check before provisioning: `git show origin/radix-palette:packages/tokyo/src/tokyo-theme.css | grep -c -- '--tk-text-4:'` must print `2`. Provision with `rt worktree provision --repo 'remote:github.com%2Fm4ttstack%2Fapp-kit' --name radix-migrate-<group> --branch radix-migrate-<group>` and rebase the branch onto `origin/radix-palette` before starting. Open the PR against `radix-palette`; when `radix-palette` merges to main, retarget the PR to main (the stacked-PR routine).

Group A (app-kit and the codemod) is the only ordering constraint: Groups B to F run the codemod it adds, so they start after Group A's first task is committed on its branch and cherry-pick that one commit, or wait for Group A to merge into `radix-palette`.

## Global Constraints

- Every colour is a Radix step from `packages/tokens`; no task types a hex. A rename is always onto a `--text-*`, `--fill-*`, `--surface-*` role, `--line-*` role, `--page`, `--raised`, `--border*` or `--tk-*` mirror name.
- Size bands (spec §6): `display` 17px, `title` 15.3, `body` 14.45 take `--text-2` (neutral) or `--text-<hue>`; `meta` 13.26 takes `--text-3`; `small` 11.9 and `micro` 10.54 take `--text-4` or `--text-<hue>-small`. A declaration whose rendered size is unknown takes `--text-3` (neutral) or `--text-<hue>-small` (hue) and is listed in the group's report. In app-kit apps the tokyo mirrors apply: `--tk-text-2/3/4`, `--tk-text-<hue>`, `--tk-text-<hue>-small`.
- Property classes (spec §8.1): `color` takes text tokens only; `background*` and `fill` take `--fill-*`, surface roles or washes; `border*`, `outline*`, `scrollbar-color` take `--border*` or `--line-*` roles; `--fill-*` never appears in `color`.
- The old names stay emitted as aliases until every group has merged; no group removes an alias.
- The repo is public; every screenshot, fixture and story string is invented data.
- No em dashes or en dashes anywhere; comments state constraints the code cannot show.
- Run `bun run format` before every commit. Commit after every task with the message given.
- A group's PR is green on CI, CodeRabbit-reviewed, and its two screenshots (light, dark) of the group's key screen are attached to the PR description before it asks for merge.

## Mapping table (the codemod's data; every group reads it)

| old (tui-kit alias) | property class | new |
| --- | --- | --- |
| `--fg` | color | `--text-1` |
| `--muted-text`, `--text-muted-on-card` | color | by band: `--text-2` / `--text-3` / `--text-4` |
| `--muted` | color | by band, same as `--muted-text` (this was the bug) |
| `--muted` | background, border, fill | unchanged (`--muted` is the neutral fill, slate 9) |
| `--accent-text`, `--red-text` | color | `--text-accent`, `--text-bad`; small band adds `-small` |
| `--accent`, `--green`, `--red`, `--amber`, `--purple`, `--cyan` | color | `--text-<hue>`, small band adds `-small` (`green`→`ok`, `red`→`bad`, `amber`→`warn`) |
| same six | background, fill, border | `--fill-<hue>`; a `:hover` rule's background takes `--fill-<hue>-hover` |
| `--dot-ok`, `--dot-warn`, `--dot-bad` | any | `--fill-ok`, `--fill-warn`, `--fill-bad` |
| `--bg` | background | `--page` |
| `--surface-inset`, `--surface-overlay` | background | unchanged; `--inset` and `--overlay` are NOT emitted (the spec section 4 block showing them is labelled illustrative). Renaming to them paints the element transparent. |
| `--border-on-card`, `--border-soft-on-card`, `--border-control-on-card` | border | keep the alias in card scopes (see the board's Task D2); elsewhere `--border`, `--border-soft`, `--border-control` |
| `--tk-fg`, `--tk-muted-text`, `--tk-muted-on-card` | color | `--tk-text-1`; by band `--tk-text-2/3/4` |
| `--tk-muted` | color | by band `--tk-text-2/3/4`; other properties unchanged |
| `--tk-accent-text`, `--tk-red-text`, `--tk-green-text`, `--tk-amber-text` | color | `--tk-text-accent/bad/ok/warn` (+`-small` in the small band) |
| `--tk-accent`, `--tk-green`, `--tk-red`, `--tk-amber`, `--tk-purple`, `--tk-cyan` | color | `--tk-text-<hue>` (+`-small`) |
| same six | background, fill, border | `--tk-fill-<hue>` (hover: `--tk-fill-<hue>-hover`) |
| `--tk-dot-*` | any | `--tk-fill-*` |
| `--tk-bg` | background | `--tk-page` is not emitted; `--tk-bg` stays (it is the page) |
| `--ui-text-muted` | color | unchanged (it becomes `--ui-text-3`, Task A2) |
| `--ui-text-dimmed` | color | `--ui-text-4` (Task A2 re-points the alias too) |

Band inference: the codemod reads `font-size` from the same rule; if absent, from another rule in the same file whose selector is a prefix of this one (`.tui-review-mr-meta` inherits from `.tui-review-mr`); if still absent, unresolved. Sizes map to bands by nearest step in px at the file's root (17px for the board, 16px for app-kit apps and tui-kit): `>= 14` body, `12.5 to 14` meta, `< 12.5` small. `rem`/`em` values convert at the root; `var(--type-<step>)` and `var(--tk-fs-<n>)` map by name (`--tk-fs-lead` body, `--tk-fs-2xs` and `--tk-fs-small` and smaller are small).

## File structure

- Group A (app-kit + codemod): create `packages/tokens/scripts/migrate-tokens.ts` and `packages/tokens/test/migrate-tokens.test.ts`; modify `packages/tokyo/src/tokyo-theme.css` (`--ui-text-1..4`, `--ui-text-dimmed`), `packages/ui/presets/eslint-local/no-dimmed-xs.js` (+ `.d.ts`, test), `packages/ui/presets/eslint.js`, `AGENTS.md`; run the codemod over `packages/ui/src`.
- Group B (chat): `apps/chat/src/**/*.{css,tsx}` via the codemod, the unresolved list by hand.
- Group C (console + boxscore): the same, plus `no-dimmed-xs` fixes.
- Group D (board): `apps/board/src/style.css` and `src/client/**/*.tsx` via the codemod; the `--gate-*` block; `eslint.config.js` board tier to `error`.
- Group E (tui-kit recipes): `packages/tui-kit/src/recipes/**/*.module.css` via the codemod; the three known warnings; `eslint.config.js` tui-kit tier to `error`; `packages/tui-kit/docs/token-census.md` note.
- Group F (deck): `apps/deck/core/board/board.css`, `apps/deck/core/gateway-pages.tsx`; regenerate `apps/deck/core/generated/*` after Group D merges.

---

---

## Group A: app-kit and the codemod

### Task A1: The codemod

**Files:**
- Create: `packages/tokens/scripts/migrate-tokens.ts`, `packages/tokens/test/migrate-tokens.test.ts`
- Modify: `packages/tokens/package.json` (devDependency `css-tree`, `@types/css-tree` via the catalog), root `package.json` (catalog, script `tokens:migrate`)

**Interfaces:**
- Produces: `bun run tokens:migrate <path...> [--write]`. Without `--write` it prints a report: per file, each rename it would make (`file:line  prop: old -> new  [band: body|meta|small|unknown]`) and an `UNRESOLVED` section for declarations whose band it cannot infer. With `--write` it rewrites the resolved renames in place and still prints the unresolved list. Exports `planRenames(css: string, rootPx: number): Rename[]` and `renameInTsx(source: string): { out: string; unresolved: Unresolved[] }` for the test.

- [ ] **Step 1: Failing test**

Create `packages/tokens/test/migrate-tokens.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { planRenames, renameInTsx } from '../scripts/migrate-tokens.ts';

describe('planRenames', () => {
  it('renames by property class and infers the band from the rule', () => {
    const css = `.a { font-size: 13.26px; color: var(--muted-text); background: var(--accent); }`;
    const r = planRenames(css, 17);
    expect(r.map(x => [x.property, x.from, x.to, x.band])).toEqual([
      ['color', '--muted-text', '--text-3', 'meta'],
      ['background', '--accent', '--fill-accent', null],
    ]);
  });

  it('inherits font-size from a prefix selector in the same file and maps type steps by name', () => {
    const css = `.row { font-size: var(--type-small); } .row-meta { color: var(--fg); } .x { color: var(--accent); font-size: var(--type-body); }`;
    const r = planRenames(css, 17);
    expect(r.find(x => x.from === '--fg')).toMatchObject({ to: '--text-1', band: 'small' });
    expect(r.find(x => x.from === '--accent')).toMatchObject({ to: '--text-accent', band: 'body' });
  });

  it('marks a colour rename with no size as unresolved and defaults it to the meta or small token', () => {
    const css = `.a { color: var(--muted); } .b { color: var(--green); }`;
    const r = planRenames(css, 17);
    expect(r[0]).toMatchObject({ to: '--text-3', band: null, unresolved: true });
    expect(r[1]).toMatchObject({ to: '--text-ok-small', band: null, unresolved: true });
  });

  it('leaves --muted alone outside color and turns dots into fills', () => {
    const css = `.a { border: 1px solid var(--muted); background: var(--dot-ok); }`;
    const r = planRenames(css, 17);
    expect(r).toEqual([expect.objectContaining({ property: 'background', from: '--dot-ok', to: '--fill-ok' })]);
  });

  it('uses the hover fill inside :hover rules', () => {
    const css = `.a:hover { background: var(--accent); }`;
    expect(planRenames(css, 17)[0]).toMatchObject({ to: '--fill-accent-hover' });
  });

  it('renames tokyo mirrors and style-object strings in tsx', () => {
    const src = `const s = { color: 'var(--tk-muted-text)', background: 'var(--tk-accent)', fontSize: 'var(--tk-fs-3xs)' };`;
    const { out, unresolved } = renameInTsx(src);
    expect(out).toContain(`color: 'var(--tk-text-4)'`);
    expect(out).toContain(`background: 'var(--tk-fill-accent)'`);
    expect(unresolved).toEqual([]);
  });
});
```

Run: `cd packages/tokens && bunx vitest run test/migrate-tokens.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 2: Dependencies**

Root `package.json` `workspaces.catalog`: add `"css-tree": "^3.1.0",` and `"@types/css-tree": "^2.3.10",` in alphabetical position. `packages/tokens/package.json` `devDependencies`: add both as `"catalog:"`. Root scripts: `"tokens:migrate": "bun run packages/tokens/scripts/migrate-tokens.ts",`. Run `bun install` at the root.

- [ ] **Step 3: The codemod**

Create `packages/tokens/scripts/migrate-tokens.ts`:

```ts
import { readFileSync, writeFileSync } from 'node:fs';

import { generate, parse, walk, type CssNode, type Declaration, type Rule } from 'css-tree';

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
const NEUTRAL_TEXT = new Set(['--muted-text', '--text-muted-on-card', '--muted', '--tk-muted-text', '--tk-muted-on-card', '--tk-muted']);
const DOT: Record<string, string> = { '--dot-ok': '--fill-ok', '--dot-warn': '--fill-warn', '--dot-bad': '--fill-bad', '--tk-dot-ok': '--tk-fill-ok', '--tk-dot-warn': '--tk-fill-warn', '--tk-dot-bad': '--tk-fill-bad' };
const SURFACE: Record<string, string> = { '--bg': '--page', '--surface-inset': '--inset', '--surface-overlay': '--overlay' };
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
const BAND_TEXT: Record<Band, string> = { body: '--text-2', meta: '--text-3', small: '--text-4' };

const isColor = (p: string) => p === 'color' || p === '-webkit-text-fill-color';
const isFillish = (p: string) => p.startsWith('background') || p === 'fill';
const isBorderish = (p: string) => p.startsWith('border') || p.startsWith('outline') || p === 'scrollbar-color';

function bandFromSize(value: string, rootPx: number): Band | null {
  const step = /var\(--type-([a-z]+)\)/.exec(value)?.[1] ?? /var\(--tk-fs-([a-z0-9]+)\)/.exec(value)?.[1];
  if (step) return TYPE_STEP_BAND[step === 'small' && value.includes('--tk-fs') ? 'small_tk' : step] ?? null;
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

function target(name: string, property: string, band: Band | null, hover: boolean): { to: string; unresolved: boolean } | null {
  const tk = name.startsWith('--tk-');
  const pre = tk ? '--tk-' : '--';
  if (DOT[name]) return { to: DOT[name]!, unresolved: false };
  if (isColor(property)) {
    if (name === '--fg' || name === '--tk-fg') return { to: `${pre}text-1`, unresolved: false };
    if (NEUTRAL_TEXT.has(name)) return { to: `${pre}${BAND_TEXT[band ?? 'meta'].slice(2)}`, unresolved: band === null };
    const alias = TEXT_ALIAS[name];
    const hue = alias ?? hueOf(name)?.hue;
    if (hue) {
      const small = band === 'small' || band === 'meta' || band === null;
      return { to: `${pre}text-${hue}${small ? '-small' : ''}`, unresolved: band === null };
    }
    return null;
  }
  if (isFillish(property) || isBorderish(property)) {
    const h = hueOf(name);
    if (h) return { to: `${pre}fill-${h.hue}${hover && isFillish(property) ? '-hover' : ''}`, unresolved: false };
    if (SURFACE[name] && isFillish(property)) return { to: SURFACE[name]!, unresolved: false };
  }
  return null;
}

function selectorText(rule: Rule): string {
  return generate(rule.prelude);
}

export function planRenames(css: string, rootPx: number): Rename[] {
  const ast = parse(css, { positions: true });
  const sizes = new Map<string, string>();
  walk(ast, {
    visit: 'Rule',
    enter(rule: Rule) {
      const sel = selectorText(rule);
      walk(rule.block, {
        visit: 'Declaration',
        enter(d: Declaration) {
          if (d.property === 'font-size') sizes.set(sel, generate(d.value));
        },
      });
    },
  });
  const sizeFor = (sel: string): string | undefined => {
    if (sizes.has(sel)) return sizes.get(sel);
    const base = sel.replace(/:[a-z-]+(\(.*\))?$/, '');
    let best: string | undefined;
    for (const [s, v] of sizes) if (base.startsWith(s) && (best === undefined || s.length > best.length)) best = v;
    return best === undefined ? undefined : sizes.get(best);
  };
  const out: Rename[] = [];
  walk(ast, {
    visit: 'Rule',
    enter(rule: Rule) {
      const sel = selectorText(rule);
      const hover = /:hover/.test(sel);
      const size = sizeFor(sel);
      const band = size === undefined ? null : bandFromSize(size, rootPx);
      walk(rule.block, {
        visit: 'Declaration',
        enter(d: Declaration) {
          walk(d.value as CssNode, {
            visit: 'Function',
            enter(fn) {
              if (fn.name !== 'var') return;
              const first = fn.children.first;
              if (!first || first.type !== 'Identifier') return;
              const t = target(first.name, d.property, band, hover);
              if (!t) return;
              out.push({ property: d.property, from: first.name, to: t.to, band, unresolved: t.unresolved, line: d.loc?.start.line ?? 0 });
            },
          });
        },
      });
    },
  });
  return out;
}

export function rewriteCss(css: string, rootPx: number): { out: string; unresolved: Unresolved[] } {
  const renames = planRenames(css, rootPx);
  const lines = css.split('\n');
  const unresolved: Unresolved[] = [];
  for (const r of renames) {
    const i = r.line - 1;
    lines[i] = lines[i]!.replace(`var(${r.from})`, `var(${r.to})`);
    if (r.unresolved) unresolved.push({ line: r.line, text: lines[i]!.trim() });
  }
  return { out: lines.join('\n'), unresolved };
}

// Style objects and template strings in TSX: `color: 'var(--tk-muted-text)'`.
// The band comes from a `fontSize` key in the same object literal when there
// is one; otherwise the rename is listed as unresolved with the meta/small
// default, exactly like CSS.
export function renameInTsx(source: string): { out: string; unresolved: Unresolved[] } {
  const unresolved: Unresolved[] = [];
  const lines = source.split('\n');
  const objectBand = (i: number): Band | null => {
    for (let j = Math.max(0, i - 6); j <= Math.min(lines.length - 1, i + 6); j++) {
      const m = /fontSize:\s*['"`]([^'"`]+)['"`]/.exec(lines[j]!);
      if (m) return bandFromSize(m[1]!, 16);
    }
    return null;
  };
  for (let i = 0; i < lines.length; i++) {
    lines[i] = lines[i]!.replace(/(\b[a-zA-Z-]+)\s*:\s*(['"`])([^'"`]*var\(--[a-z0-9-]+\)[^'"`]*)\2/g, (whole, key: string, q: string, value: string) => {
      const property = key.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
      const hover = false;
      const band = isColor(property) ? objectBand(i) : null;
      const next = value.replace(/var\((--[a-z0-9-]+)\)/g, (v, name: string) => {
        const t = target(name, property, band, hover);
        if (!t) return v;
        if (t.unresolved) unresolved.push({ line: i + 1, text: whole.trim() });
        return `var(${t.to})`;
      });
      return `${key}: ${q}${next}${q}`;
    });
  }
  return { out: lines.join('\n'), unresolved };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const rootPx = Number(/--root=(\d+)/.exec(args.join(' '))?.[1] ?? 16);
  for (const file of args.filter(a => !a.startsWith('--'))) {
    const src = readFileSync(file, 'utf8');
    const res = file.endsWith('.css') ? rewriteCss(src, rootPx) : renameInTsx(src);
    const changed = res.out !== src;
    if (changed) console.log(`${file}: ${write ? 'rewritten' : 'would rewrite'}`);
    for (const u of res.unresolved) console.log(`  UNRESOLVED ${file}:${u.line}  ${u.text}`);
    if (write && changed) writeFileSync(file, res.out);
  }
}
```

The `smallness` of an unresolved hue text defaults to `-small` because the small token is safe at every band (7:1); the report line is what tells the implementer to downgrade it to the body token where the size turns out to be body.

Run: `cd packages/tokens && bunx vitest run test/migrate-tokens.test.ts && bun run typecheck`
Expected: PASS; typecheck clean. If `css-tree`'s `walk` typings reject the `visit` narrowings, cast the callbacks to `any` at the call site with a one-line comment naming the typings version.

- [ ] **Step 4: Dry run over app-kit and commit**

Run: `bun run tokens:migrate packages/ui/src/**/*.css packages/ui/src/**/*.tsx --root=16 | tee .superpowers/migrate-app-kit.txt | tail -20`
Expected: a short list (app-kit reads `--ui-*` almost everywhere; the census found 13 `--tk-*` uses and no `--muted`).

```bash
git add package.json bun.lock packages/tokens
git commit -m "tokens: migrate-tokens codemod for the ramp names, band-aware"
```

### Task A2: app-kit text slots and the no-dimmed-xs rule

**Files:**
- Modify: `packages/tokyo/src/tokyo-theme.css:150-159` (the `--ui-*` remap), `packages/tokens/scripts/generate.ts` only if the remap block is generated (it is hand-written today; leave the generator alone)
- Create: `packages/ui/presets/eslint-local/no-dimmed-xs.js`, `no-dimmed-xs.d.ts`, `packages/ui/presets/eslint-local/no-dimmed-xs.test.ts`
- Modify: `packages/ui/presets/eslint.js`, `AGENTS.md`, `packages/tokens/test/consumption.test.ts` (waivers for `--ui-text-1..4` if its scan covers `--ui-*`; it covers `--tk-*` only today, so likely nothing)

**Interfaces:**
- Produces: `--ui-text-1: var(--tk-text-1)` through `--ui-text-4`; `--ui-text-muted: var(--ui-text-3)`; `--ui-text-dimmed: var(--ui-text-4)`; `--ui-text-gray: var(--ui-text-1)`; ESLint rule `local/no-dimmed-xs` (error) for `<Text size="xs" c="dimmed">` and the same on `Title`/`Anchor`/`Badge` when both attributes are literal.

- [ ] **Step 1: Failing rule test**

Create `packages/ui/presets/eslint-local/no-dimmed-xs.test.ts`:

```ts
import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe } from 'vitest';

import noDimmedXs from './no-dimmed-xs.js';

const tester = new RuleTester({
  languageOptions: { parser: tseslint.parser, ecmaVersion: 2023, sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } } },
});

describe('local/no-dimmed-xs', () => {
  tester.run('no-dimmed-xs', noDimmedXs, {
    valid: [
      { code: '<Text size="sm" c="dimmed">a</Text>' },
      { code: '<Text size="xs">a</Text>' },
      { code: '<Text size={size} c="dimmed">a</Text>' },
    ],
    invalid: [
      { code: '<Text size="xs" c="dimmed">a</Text>', errors: [{ messageId: 'dimmedXs' }] },
      { code: '<Badge size="xs" c="dimmed">a</Badge>', errors: [{ messageId: 'dimmedXs' }] },
    ],
  });
});
```

Run: `cd packages/ui && bunx vitest run presets/eslint-local/no-dimmed-xs.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 2: The rule**

Create `packages/ui/presets/eslint-local/no-dimmed-xs.js`:

```js
// The spec's size bands: text at the small step (Mantine `xs`) takes the
// high-contrast token, so `dimmed` at `xs` is the size trap by construction.
const SMALL = new Set(['xs']);

function literal(attr) {
  const v = attr.value;
  if (!v) return null;
  if (v.type === 'Literal') return v.value;
  if (v.type === 'JSXExpressionContainer' && v.expression.type === 'Literal') return v.expression.value;
  return null;
}

export default {
  meta: {
    type: 'problem',
    messages: {
      dimmedXs: 'Dimmed text at size "xs" reads under the small-text bar; use size "sm" or drop c="dimmed" (the default text is the high-contrast token).',
    },
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        let size = null;
        let dimmed = false;
        for (const attr of node.attributes) {
          if (attr.type !== 'JSXAttribute' || !attr.name) continue;
          if (attr.name.name === 'size') size = literal(attr);
          if (attr.name.name === 'c' && literal(attr) === 'dimmed') dimmed = true;
        }
        if (dimmed && size !== null && SMALL.has(size)) context.report({ node, messageId: 'dimmedXs' });
      },
    };
  },
};
```

and `no-dimmed-xs.d.ts` with the two-line `Rule.RuleModule` shape used by the other local rules. In `packages/ui/presets/eslint.js` add the rule to the `local` plugin and `'local/no-dimmed-xs': 'error'` to the app rules.

Run: `cd packages/ui && bunx vitest run presets/eslint-local/no-dimmed-xs.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 3: The `--ui-text-*` slots**

In `packages/tokyo/src/tokyo-theme.css`, replace the three `--ui-text-*` lines in the `:root` remap block with:

```css
  --ui-text-1: var(--tk-text-1);
  --ui-text-2: var(--tk-text-2);
  --ui-text-3: var(--tk-text-3);
  --ui-text-4: var(--tk-text-4);
  --ui-text-muted: var(--ui-text-3);
  --ui-text-dimmed: var(--ui-text-4);
  --ui-text-gray: var(--ui-text-1);
```

and update the comment above the block so it names the four text slots and says `dimmed` is the small-text slot. Run `cd packages/tokens && bunx vitest run test/consumption.test.ts` (the tokyo scan counts `--tk-*` references; the new lines reference `--tk-text-1..4`, which removes them from the waiver list, so delete those four waivers: the no-stale-waivers check names them).

- [ ] **Step 4: Apply the codemod and the rule to app-kit, document, commit**

Run: `bun run tokens:migrate packages/ui/src/**/*.css packages/ui/src/**/*.tsx --root=16 --write`, then resolve each `UNRESOLVED` line by reading its rendered size (the component's `size` prop or the CSS module's `font-size`) and choosing the band token; then `bun run lint` at the root and fix every `local/no-dimmed-xs` report by changing `size="xs"` to `"sm"` where the text is secondary, or dropping `c="dimmed"` where the size must stay `xs`.

Add to `AGENTS.md` under the consumer requirements:

```md
### Text slots and sizes

`--ui-text-1` is primary text at every size; `--ui-text-2` is secondary text at body sizes and above; `--ui-text-3` at meta (about 13px); `--ui-text-4` at small and micro (under 12.5px) and is the same colour as `--ui-text-1`, because small text needs the high-contrast step. `--ui-text-muted` is `--ui-text-3` and `--ui-text-dimmed` is `--ui-text-4`. In JSX, `c="dimmed"` at `size="xs"` is a lint error (`local/no-dimmed-xs`); use `sm` for dimmed text or the default colour at `xs`.
```

Run: `bun run typecheck && cd packages/ui && bunx vitest run && cd ../.. && bun run lint && bun run chat:test && bun run console:test && bun run boxscore:test`
Expected: PASS; zero `no-dimmed-xs` errors.

```bash
git add packages/tokyo/src/tokyo-theme.css packages/ui packages/tokens/test/consumption.test.ts AGENTS.md
git commit -m "app-kit: four text slots, dimmed is the small-text slot, no-dimmed-xs lint"
```

### Task A3: Screenshots and PR

- [ ] Build the storybook (`bun run tui-kit:build && bun run build-storybook`) and open `Specimens/app-kit` in both schemes; attach both screenshots. Open the PR `radix-migrate-app-kit` against `radix-palette` with the codemod's report (`.superpowers/migrate-app-kit.txt`, unresolved lines and how each was resolved) in the description.

---

## After all groups merge

- The aliases (`--fg`, `--muted-text`, `--accent-text`, `--red-text`, `--dot-*`, `--bg`, `--text-muted-on-card`, the `*OnCard` line names, `--tk-muted-text`, `--tk-*-text`, `--tk-dot-*`) can retire from `soribashi.config.ts`, `generate.ts` and `tokyo-theme.css` in one commit, with `token-existence.test.ts` and the consumption gate as the proof nothing reads them. That commit is its own PR on `radix-palette`, after every group is in.
- The lint tiers are all `error`; delete the `warn` block from `eslint.config.js`.

## Self-review

Spec coverage: §4 roles (`--page`, `--inset`, `--overlay`, card-scope rule) in D2 and the table; §5 and §6 bands in the codemod and every group's resolve step; §7 hue tokens and fills in the table; §7.2 lines and the card scope in D2 and E; §8.1 namespaces enforced by the lint flips in D3 and E; §9 alias retirement after all groups. Not covered on purpose: the 22 type primitives and the `--type-*`/`--text-*` pairing lint, both out of scope in the spec.

Placeholder scan: none. Type consistency: `planRenames`, `rewriteCss`, `renameInTsx` are the codemod's exports and the only interfaces Groups B to F use.
