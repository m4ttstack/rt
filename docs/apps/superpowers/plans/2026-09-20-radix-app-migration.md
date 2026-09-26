# Radix App Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every app and kit stylesheet off the transitional aliases (`--fg`, `--muted-text`, `--accent`, `--tk-muted-text`, `--gate-*`, ...) onto the ramp names the tokens package now emits, chosen per role and per size band, so that the namespace lint runs at `error` everywhere and no text reads a fill token.

**Architecture:** Part A of the ramps plan (branch `radix-palette`, Tasks 0 to 3) emits every new name and keeps every old name as an alias with the new value, so the apps already render the Radix palette; this plan is the rename that lets the aliases retire. One codemod in `packages/tokens/scripts/migrate-tokens.ts` does the property-aware renames and lists the declarations whose size band it cannot infer; each group then resolves that list by hand, flips its lint tier, and screenshots its key screens in both schemes. Groups are independent and run in parallel, one branch and one worktree each, stacked on `radix-palette`.

**Tech Stack:** bun, TypeScript, `css-tree` (codemod parser, tokens devDependency), the `local/token-namespaces` and `local/token-namespaces-css` ESLint rules from the ramps plan (Tasks 10 and 11) where they have landed, Fast Browser for screenshots.

**Spec:** `docs/superpowers/specs/2026-09-20-text-and-surface-ramps-design.md` (§4 semantic surfaces, §5 text roles, §6 size bands, §7 hue tokens, §7.2 lines and the card-scope rule, §8.1 namespaces, §9 aliases and migration).

## Base and branching

Every group branches from `radix-palette` at or after the commit that lands Task 3 of the ramps plan (the tokyo emission). Check before provisioning: `git show origin/radix-palette:packages/tokyo/src/tokyo-theme.css | grep -c -- '--tk-text-4:'` must print `2`. Provision with `rt worktree provision --repo 'remote:github.com%2Fm4ttstack%2Fapp-kit' --name radix-migrate-<group> --branch radix-migrate-<group>` and rebase the branch onto `origin/radix-palette` before starting. Open the PR against `radix-palette`; when `radix-palette` merges to main, retarget the PR to main (the stacked-PR routine).

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

## Group B: chat

### Task B1: Codemod chat

**Files:**
- Modify: every `apps/chat/src/**/*.css` and `*.tsx` the codemod touches (census: 170 `--tk-*` uses across about twenty files; the largest are `inbox.module.css`, `transcript-prose.module.css`, `fleet-tree.module.css`, `Transcript.tsx`, `Inbox.tsx`, `RoomRail.tsx`)

- [ ] **Step 1: Dry run**

Run: `bun run tokens:migrate apps/chat/src/**/*.css apps/chat/src/**/*.tsx --root=16 | tee .superpowers/migrate-chat.txt`
Expected: every `--tk-muted-text` at `--tk-fs-3xs`, `-4xs`, `-5xs`, `-2xs` or `-small` renames to `--tk-text-4` (those sizes are 8.5 to 12.2px at chat's 16px root, all in the small band); `--tk-fg` to `--tk-text-1`; `--tk-accent`/`--tk-purple`/`--tk-cyan` in `color` to the hue text tokens and in backgrounds to fills; `--tk-dot-*` to `--tk-fill-*`. Read the `UNRESOLVED` list before writing.

- [ ] **Step 2: Write and resolve**

Run with `--write`, then for each `UNRESOLVED` line find the rendered size (the nearest `font-size` up the component tree, or the Mantine `size` prop on the element the style lands on) and set the band token by hand. Chat's speaker hues (`speaker-hue.ts`) paint names in `--tk-purple`/`--tk-cyan`/`--tk-accent` at `--tk-fs-3xs`: those become `--tk-text-<hue>-small`.

- [ ] **Step 3: Verify**

Run: `bun run chat:typecheck && bun run chat:lint && bun run chat:test && bun run chat:build`
Expected: PASS. Then serve chat locally (`deck` or `bun run dev` in `apps/chat`) and take Fast Browser screenshots of the inbox and a transcript in light and dark; compare against the same screens on `radix-palette` before this branch. Small secondary text (timestamps, presence bits, agent names) should now be full-contrast; nothing else should move.

- [ ] **Step 4: Commit and PR**

```bash
git add apps/chat
git commit -m "chat: read the ramp names by size band; small text on text-4"
```

Open `radix-migrate-chat` against `radix-palette` with the codemod report and both screenshots.

---

## Group C: console and boxscore

### Task C1: Codemod and lint fixes

- [ ] Run the codemod dry over `apps/console/src` and `apps/boxscore/src` (census: 3 and 2 uses; both apps are almost entirely Mantine props). Write, resolve, then `bun run console:lint && bun run boxscore:lint` with Group A's `no-dimmed-xs` rule: fix every report (`size="xs" c="dimmed"` becomes `size="sm" c="dimmed"` for secondary lines, or drops `c="dimmed"` where `xs` must stay).
- [ ] Run: `bun run console:typecheck && bun run console:test && bun run console:build && bun run boxscore:typecheck && bun run boxscore:test && bun run boxscore:build`. Screenshot one key screen per app in both schemes.
- [ ] Commit `console, boxscore: dimmed text off size xs; ramp names` and open `radix-migrate-console-boxscore` against `radix-palette`.

---

## Group D: board

### Task D1: Codemod the board

**Files:**
- Modify: `apps/board/src/style.css` (census: 66 `--fg`, 79 `--muted-text`, 25 `--accent-text`, 47 `--accent`, 39 `--border`, 26 `--card`, and the rest of the table), `apps/board/src/client/**/*.tsx` (style objects), `apps/board/src/client/board/icons.tsx` (fills)

- [ ] **Step 1: Dry run**

Run: `bun run tokens:migrate apps/board/src/style.css apps/board/src/client/**/*.tsx --root=17 | tee .superpowers/migrate-board.txt`. The board's root is 17px (`html { font-size: 17px }`), so the `--root=17` flag matters: `--type-meta` (0.78rem, 13.26px) lands in the meta band, `--type-small` (0.7rem, 11.9px) in small.

- [ ] **Step 2: Write and resolve**

Write, then resolve the `UNRESOLVED` list by hand. The review sheet rules (`.tui-review-*`) declare `font-size` per rule, so most resolve; the MR row rules inherit from `.tui-mr-row` and resolve by prefix. Board CSS lines 3631, 3683, 3994 and 4046 use `--muted` as `color:` (the bug the spec opened with); they take the band token like any other.

### Task D2: Retire the `--gate-*` block

- [ ] In `apps/board/src/style.css` lines 1870 to 1902, the `--gate-*` re-alias block on the review sheet's root: delete the six colour aliases (`--gate-edge`, `--gate-control-edge`, `--gate-muted`, `--gate-key-bg`, `--gate-soft-edge`, `--gate-modal-ground`) and replace them with the card-scope rule from the spec:

```css
.tui-review-sheet {
  --border: var(--border-on-card);
  --border-soft: var(--border-soft-on-card);
  --border-control: var(--border-control-on-card);
}
```

  then rename every `var(--gate-edge)` to `var(--border)`, `var(--gate-control-edge)` to `var(--border-control)`, `var(--gate-soft-edge)` to `var(--border-soft)`, `var(--gate-muted)` to the band token of its rule (`--text-3` on meta rules, `--text-4` on small ones), `var(--gate-key-bg)` to `var(--inset)`, `var(--gate-modal-ground)` to `var(--overlay)`. The font, gap, pad and radius `--gate-*` aliases stay; they are not colours.

### Task D3: Verify, lint tier, screenshots, PR

- [ ] Run: `bun run tui-kit:build && bun run board:typecheck && bun run board:test && bun run board:build`. If the ramps plan's Task 11 has landed on `radix-palette`, change the board's CSS block in `eslint.config.js` from `'warn'` to `'error'` and run `bun run lint`; expected zero board warnings (the two known lines at 3644 and 3667 are `--border` in a non-border property and get a role that fits: a divider painted as `background` becomes `var(--line-3)` only inside the tokens file, so here it becomes `border-top: 1px solid var(--border-soft)` on the element instead). If Task 11 has not landed, leave the tier and say so in the PR.
- [ ] Serve the board (deck serves `apps/board`; rebuild first) and screenshot the MR list and an open review sheet in both schemes; attach.
- [ ] Commit `board: ramp names by size band; gate block replaced by the card-scope rule` and open `radix-migrate-board` against `radix-palette`.

---

## Group E: tui-kit recipe CSS

### Task E1: Codemod the recipes

- [ ] Run the codemod dry over `packages/tui-kit/src/recipes/**/*.module.css` (`--root=16`; census: 24 `--fg`, 18 `--muted` of which 16 are `color:`, 28 `--accent`, 27 `--border`). Write and resolve. The sixteen `color: var(--muted)` lines (ListGroup, CopyButton, Drawer, Panel, Markdown, Segmented, ContextMenu, Field, SelectBox, Table, Modal) are the fill-as-text bug inside the kit; each takes the band token of its rule.
- [ ] The three lint warnings the ramps plan named: `Panel.module.css` `color: var(--surface-wash-accent-fg-70)` becomes `color: var(--text-accent)`; `ContextMenu.module.css` `background: var(--border-soft)` (a divider) becomes `border-top: 1px solid var(--border-soft)` on the item; `Table.module.css` `background: var(--border)` likewise on the row.
- [ ] `scrollbar-color: var(--border)` and `var(--border-on-card)` stay (allowed property).
- [ ] Run: `cd packages/tui-kit && bun run codegen && bunx vitest run --project node && bun run build && bunx vitest run --project browser --exclude '**/*.visual.test.tsx' --exclude '**/*.parity.test.tsx'`; then refresh the visual baselines (`bunx vitest run --project browser visual -u`) and look at the light and dark grids. `test/no-hardcoded-values.test.ts` and `test/token-existence.test.ts` must stay green: a renamed token must exist in the generated theme (they all do; the aliases are additive).
- [ ] If Task 11 has landed, flip `packages/tui-kit/src/**/*.css` to `'error'` in `eslint.config.js` and run `bun run lint`: zero warnings. Add a paragraph to `packages/tui-kit/docs/token-census.md` saying the colour tables are historical and the ramps are the contract now.
- [ ] Commit `tui-kit: recipes read the ramp names; muted is never a text colour` and open `radix-migrate-tui-kit` against `radix-palette`.

---

## Group F: deck

- [ ] Run the codemod dry over `apps/deck/core/board/board.css` and `apps/deck/core/gateway-pages.tsx` (`--root=16`; census: 5 `--fg`, 5 `--muted`, 16 `--accent`, a handful of borders). Write, resolve, run `bun run deck:test` (macOS) and `bun run deck:test-dom`.
- [ ] After Group D merges into `radix-palette`, rebase, run `cd apps/deck && bun run build:board`, commit the regenerated `apps/deck/core/generated/*`.
- [ ] Commit `deck: ramp names in the gateway pages and board shell` and open `radix-migrate-deck` against `radix-palette`.

---

## After all groups merge

- The aliases (`--fg`, `--muted-text`, `--accent-text`, `--red-text`, `--dot-*`, `--bg`, `--text-muted-on-card`, the `*OnCard` line names, `--tk-muted-text`, `--tk-*-text`, `--tk-dot-*`) can retire from `soribashi.config.ts`, `generate.ts` and `tokyo-theme.css` in one commit, with `token-existence.test.ts` and the consumption gate as the proof nothing reads them. That commit is its own PR on `radix-palette`, after every group is in.
- The lint tiers are all `error`; delete the `warn` block from `eslint.config.js`.

## Self-review

Spec coverage: §4 roles (`--page`, `--inset`, `--overlay`, card-scope rule) in D2 and the table; §5 and §6 bands in the codemod and every group's resolve step; §7 hue tokens and fills in the table; §7.2 lines and the card scope in D2 and E; §8.1 namespaces enforced by the lint flips in D3 and E; §9 alias retirement after all groups. Not covered on purpose: the 22 type primitives and the `--type-*`/`--text-*` pairing lint, both out of scope in the spec.

Placeholder scan: none. Type consistency: `planRenames`, `rewriteCss`, `renameInTsx` are the codemod's exports and the only interfaces Groups B to F use.
