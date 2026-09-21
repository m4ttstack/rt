# Text and Surface Ramps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the Radix-sourced surface, text, line and hue ramps in `packages/tokens`, derive the Mantine tuples and their pins from the same vendored scales, retune tui-kit's button resolver to the hue text tokens, give tui-kit a bound provider, build the tokens storybook, extend the contrast gate, and ship the namespace lint rule.

**Architecture:** `packages/tokens/src/radix.ts` is a generated, byte-checked copy of seven `@radix-ui/colors` scales; `values.ts` names every role as a step into those scales, so "every role is a Radix step chosen by a stated rule" is true by construction and asserted by test. The existing generator (`scripts/generate.ts`) emits the ramps into tui-kit's `tokens.ts` and tokyo's `tokyo-theme.css`; a new generator (`scripts/generate-ramps.ts`) writes tokyo's Mantine tuples and per-colour pins by a fixed 12-to-10 pick. tui-kit's soribashi codegen then emits the public names (`--surface-1`, `--text-3`, `--fill-ok`, `--text-ok-small`). Everything downstream (provider, storybook, gate, lint) consumes those names.

**Tech Stack:** bun workspaces, TypeScript, vitest (node + browser projects), soribashi codegen (`soribashi build`), `@radix-ui/colors` 3.0.0 (codegen devDependency only), Mantine 9.5 (`cssVariablesResolver`, `primaryShade`), Storybook 10 (`@storybook/react-vite`, `@storybook/addon-a11y`), ESLint 10 flat config with `@eslint/css`.

**Spec:** `docs/superpowers/specs/2026-09-20-text-and-surface-ramps-design.md`

## Global Constraints

- The repo is public; every fixture, story string and test value must be invented data. `scripts/repo-purity.sh` gates the whole tree.
- `packages/tokens` takes no React, Mantine or soribashi runtime dependency. `@radix-ui/colors` is a devDependency of its codegen only; consumers never import it.
- Root `bun.lock` is the only lockfile. Run `bun install` from the repo root; never inside a package.
- Shared dependency versions live in the root `package.json` `workspaces.catalog`; members declare `"catalog:"`.
- `bun run tui-kit:build` must run before any board, deck or storybook typecheck/test/build.
- Generated artifacts are committed: after any `values.ts` or `radix.ts` change run `bun run tokens:codegen`, `bun run tokens:ramps`, `cd packages/tui-kit && bun run codegen`, and `cd apps/deck && bun run build:board`, and commit `packages/tokens/src/radix.ts`, `packages/tui-kit/src/generated/*`, `packages/tokyo/src/tokyo-theme.css`, `packages/tokyo/src/ramps.ts`, `apps/deck/core/generated/*`. CI fails on drift (`.github/workflows/ci.yml` line 24, extended in Task 4).
- Every colour is a Radix step. No task types a hex that is not in `radix.ts` (pure white `#ffffff` for light `surface-1` is the one literal, stated in the spec).
- `known-contrast-debt.ts` ratchet: entries are only removed or improved, never worsened. Task 5 rewrites it once to the spec's eight filled cells; after that the ratchet holds.
- Contrast bars: text 4.5 (display/title/body), 5.2 (meta), 7.0 (small/micro); fills 3.0 (non-text). Assert `>= bar` at full float precision with the tokens package's `contrastRatio`.
- No em dashes or en dashes in any text this plan produces (code, comments, commit messages, stories).
- Comments state constraints the code cannot show. No comments that narrate the next line, cite this plan or the spec's section numbers, or record decision history.
- Run `bun run format` before every commit; CI runs `bun run format:check` (`packages/tui-kit`, `docs` and `apps/deck/core/generated` are prettier-ignored, and Task 4 adds `packages/tokyo/src/ramps.ts` and Task 0 adds `packages/tokens/src/radix.ts` to that list because their generators own their layout).
- Commit after every task with the message given in that task.

## Values reference (copy verbatim; every task reads from here)

Radix scales vendored (light then dark, steps 1 to 12):

```
slate   light #fcfcfd #f9f9fb #f0f0f3 #e8e8ec #e0e1e6 #d9d9e0 #cdced6 #b9bbc6 #8b8d98 #80838d #60646c #1c2024
slate   dark  #111113 #18191b #212225 #272a2d #2e3135 #363a3f #43484e #5a6169 #696e77 #777b84 #b0b4ba #edeef0
indigo  light #fdfdfe #f7f9ff #edf2fe #e1e9ff #d2deff #c1d0ff #abbdf9 #8da4ef #3e63dd #3358d4 #3a5bc7 #1f2d5c
indigo  dark  #11131f #141726 #182449 #1d2e62 #253974 #304384 #3a4f97 #435db1 #3e63dd #5472e4 #9eb1ff #d6e1ff
teal    light #fafefd #f3fbf9 #e0f8f3 #ccf3ea #b8eae0 #a1ded2 #83cdc1 #53b9ab #12a594 #0d9b8a #008573 #0d3d38
teal    dark  #0d1514 #111c1b #0d2d2a #023b37 #084843 #145750 #1c6961 #207e73 #12a594 #0eb39e #0bd8b6 #adf0dd
crimson light #fffcfd #fef7f9 #ffe9f0 #fedce7 #facedd #f3bed1 #eaacc3 #e093b2 #e93d82 #df3478 #cb1d63 #621639
crimson dark  #191114 #201318 #381525 #4d122f #5c1839 #6d2545 #873356 #b0436e #e93d82 #ee518a #ff92ad #fdd3e8
orange  light #fefcfb #fff7ed #ffefd6 #ffdfb5 #ffd19a #ffc182 #f5ae73 #ec9455 #f76b15 #ef5f00 #cc4e00 #582d1d
orange  dark  #17120e #1e160f #331e0b #462100 #562800 #66350c #7e451d #a35829 #f76b15 #ff801f #ffa057 #ffe0c2
purple  light #fefcfe #fbf7fe #f7edfe #f2e2fc #ead5f9 #e0c4f4 #d1afec #be93e4 #8e4ec6 #8347b9 #8145b5 #402060
purple  dark  #18111b #1e1523 #301c3b #3d224e #48295c #54346b #664282 #8457aa #8e4ec6 #9a5cd0 #d19dff #ecd9fa
cyan    light #fafdfe #f2fafb #def7f9 #caf1f6 #b5e9f0 #9ddde7 #7dcedc #3db9cf #00a2c7 #0797b9 #107d98 #0d3c48
cyan    dark  #0b161a #101b20 #082c36 #003848 #004558 #045468 #12677e #11809c #00a2c7 #23afd0 #4ccce6 #b6ecf7
```

Hue to scale: `accent indigo, ok teal, bad crimson, warn orange, purple purple, cyan cyan`.

Surface ramps as steps: light `['#ffffff', slate 1, slate 2, slate 3]`; dark `[slate 1, slate 2, slate 3, slate 4]`.

Surface roles as ramp indices: light `card 1, panel 2, page 3, chrome 4, inset 3, overlay 2, raised 4`; dark `card 3, panel 2, page 1, chrome 2, inset 1, overlay 1, raised 4`.

Text ramps as slate steps: both schemes `[12, 11, 11, 12]`. Text roles as ramp indices: `fg 1, mutedText 3, mutedOnCard 3` both schemes. Bars: text-2 4.5, text-3 5.2, text-4 7.0.

Line ramps as slate steps: light `[8, 7, 6]`, dark `[9, 7, 6]`. Line roles as ramp indices: light `border 2, soft 3, control 1, edgeOnCard 2, softOnCard 3`; dark `border 2, soft 3, control 1, edgeOnCard 1, softOnCard 2`.

Hue steps (`fill`, `text`; small is always 12; hover is step 10 when the fill is 9, and `color-mix(in srgb, <fill> 88%, <text-1>)` when the fill is 10):

| hue | light fill | light text | dark fill | dark text |
| --- | --- | --- | --- | --- |
| accent | 9 | 11 | 9 | 11 |
| ok | 10 | 12 | 9 | 11 |
| bad | 9 | 11 | 9 | 11 |
| warn | 10 | 12 | 9 | 11 |
| purple | 9 | 11 | 9 | 11 |
| cyan | 10 | 12 | 9 | 11 |

Neutral fill (`muted`): slate 9 both schemes. `wash`: `10%` light, `15%` dark. `line.grid`: `rgba(52, 59, 88, 0.05)` light, `rgba(122, 162, 247, 0.06)` dark, unchanged.

Mantine picks (tuple index 0..9 ← Radix step): Day `[1,3,4,5,6,7,9,10,11,12]`; Night `[12,11,10,9,8,7,6,5,4,3]`; `gray` (light, from slate) `[2,3,4,6,7,8,11,11,12,12]`; `dark` (dark, from slate) `[12,11,11,9,8,4,3,2,1,1]` (indices 5 and 6 are Mantine's component grounds, so they sit on surface steps). `primaryShade: { light: 6, dark: 3 }`.

Fill ledger (spec §7): light `warn` 2.93 on `surface-4`; dark `accent` 2.77 and `purple` 2.79 on `surface-4`. Filled-label ledger (Button, white label): light `ok` 3.46, `warn` 3.33, `cyan` 3.42, `bad` 3.85; dark `ok` 3.07, `warn` 2.97, `cyan` 3.00, `bad` 3.85. The neutral fill's label is `light-dark(var(--text-1), #ffffff)` and is not ledgered (4.96 light, 5.13 dark).

Public CSS names emitted by tui-kit after Part A: `--surface-1..4`, `--text-1..4`, `--line-1..3`, `--page`, `--raised`, `--fill-<hue>`, `--fill-<hue>-hover`, `--text-<hue>` (display, title, body), `--text-<hue>-small` (meta, small, micro), `--border-control`, where `<hue>` is one of `accent ok bad warn purple cyan`. Tokyo emits the same set prefixed `--tk-`.

## File structure

Part A (spec step 0):
- Create `packages/tokens/scripts/generate-radix.ts`, `packages/tokens/src/radix.ts` (generated), `packages/tokens/test/radix-fresh.test.ts`.
- Modify `packages/tokens/src/values.ts`: ramp types, per-scheme spec objects in steps, a `buildScheme()` that resolves steps to hex; `hueStep`, `hueHover`, `hueText`, `hueTextSmall`, `line.control`, `surface.raised` fields; `dot` removed.
- Modify `packages/tokens/test/invariants.test.ts`: the rules as tests.
- Modify `packages/tokens/scripts/generate.ts`: emit `ground`/`ink`/`rule` families, hue shades, `raised`, `control`, hover into tui-kit tokens; emit `--tk-*` ramp names into tokyo.
- Modify `packages/tui-kit/src/theme.ts` (semantic `surface.raised`, `border.control`), `packages/tui-kit/soribashi.config.ts` (public aliases), `packages/tui-kit/test/theme.test.ts` (palette ruling), `packages/tokens/test/consumption.test.ts` (waivers).
- Regenerate `packages/tui-kit/src/generated/{tokens.ts,theme.css}`, `packages/tokyo/src/tokyo-theme.css`, `apps/deck/core/generated/*`.

- Modify `packages/tui-kit/src/intent-resolver.ts`, `packages/tui-kit/src/recipes/Button/Button.tsx`, `packages/tui-kit/src/a11y/known-contrast-debt.ts` (Task 2, same PR); refresh visual baselines.

Part B (spec step 1):
- Create `packages/tokens/scripts/generate-ramps.ts`, `packages/tokens/src/mantine-pins.ts`; regenerate `packages/tokyo/src/ramps.ts` (tuples) and the pin blocks in `packages/tokyo/src/tokyo-theme.css`; modify `packages/tokyo/src/theme.ts` (`primaryShade`, `gray`/`dark` tuples), `packages/tokens/scripts/generate.ts` (pin splice), `packages/tokens/test/ramp-anchors.test.ts`; root script `tokens:ramps`; CI freshness line.

Part D (spec step 3):
- Rename `packages/tui-kit/src/provider.ts` to `provider.tsx`; add `TuiKitProvider`; test `packages/tui-kit/test/provider.test.tsx`.

Part E (spec step 4):
- Create `stories/ramps/*.stories.tsx` (reference catalogue) and `stories/specimens/*.stories.tsx` (both kits); modify `.storybook/main.ts`, `.storybook/preview.tsx`, root `package.json` lint pattern.

Part F (spec step 5):
- Modify `packages/tui-kit/src/a11y/known-contrast-debt.ts` (fill entry shape); create `packages/tui-kit/test/ramps.matrix.test.tsx`.

Part G (spec step 6):
- Create `packages/ui/presets/eslint-local/token-namespaces.js` (classifier), `token-namespaces-tsx.js`, `token-namespaces-css.js`, one `.d.ts` beside each (the `presets/vite.d.ts` convention; `packages/ui/tsconfig.json` compiles `presets`), and `token-namespaces.test.ts`; wire into `packages/ui/presets/eslint.js` and root `eslint.config.js`.

---

## Part A: tokens (spec §9 step 0)

Tasks 0 to 4 land as one PR (`radix-palette`): Task 1 alone leaves the generated files stale, Task 2 alone leaves tokyo and deck stale, and Task 2 carries the tui-kit button retune and ledger rewrite because the Button matrix runs in CI against every hue.

### Task 0: Vendor the Radix scales

**Files:**
- Create: `packages/tokens/scripts/generate-radix.ts`, `packages/tokens/src/radix.ts` (generated), `packages/tokens/test/radix-fresh.test.ts`
- Modify: root `package.json` (catalog, `tokens:radix` script), `packages/tokens/package.json` (devDependencies), `.prettierignore`

**Interfaces:**
- Produces: `RADIX_VERSION: string`; `RADIX_SCALES` (`['slate','indigo','teal','crimson','orange','purple','cyan'] as const`); `type RadixScaleName`; `type Scale12 = readonly [string, ...string[]]` of length 12; `RADIX: Record<RadixScaleName, { light: Scale12; dark: Scale12 }>`. Root script `bun run tokens:radix`.

- [ ] **Step 1: Add the dependency**

Root `package.json` `workspaces.catalog`: add `"@radix-ui/colors": "^3.0.0",` in alphabetical position. `packages/tokens/package.json`: add

```json
  "devDependencies": {
    "@radix-ui/colors": "catalog:"
  }
```

Run: `bun install` (repo root). Expected: root `bun.lock` updated; no `packages/tokens/bun.lock`. Confirm the installed version is 3.0.0: `grep '"version"' packages/tokens/node_modules/@radix-ui/colors/package.json` (bun links a member-only devDependency under the member, not the root).

- [ ] **Step 2: Write the failing freshness test**

Create `packages/tokens/test/radix-fresh.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { RADIX, RADIX_SCALES, RADIX_VERSION } from '../src/radix.ts';

const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve('@radix-ui/colors/package.json'));
const installedVersion = (JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) as { version: string }).version;

function stepsFromCss(file: string, name: string): string[] {
  const css = readFileSync(join(pkgDir, file), 'utf8');
  const out: string[] = [];
  for (let i = 1; i <= 12; i++) {
    const m = new RegExp(`--${name}-${i}: (#[0-9a-f]{6});`).exec(css);
    if (!m) throw new Error(`${file}: no --${name}-${i}`);
    out.push(m[1]!);
  }
  return out;
}

describe('vendored Radix scales', () => {
  it('records the installed package version', () => {
    expect(RADIX_VERSION).toBe(installedVersion);
  });

  it.each(RADIX_SCALES)('%s matches the installed package in both schemes', name => {
    expect([...RADIX[name].light]).toEqual(stepsFromCss(`${name}.css`, name));
    expect([...RADIX[name].dark]).toEqual(stepsFromCss(`${name}-dark.css`, name));
  });
});
```

Run: `cd packages/tokens && bunx vitest run test/radix-fresh.test.ts`
Expected: FAIL, `../src/radix.ts` not found.

- [ ] **Step 3: The generator**

Create `packages/tokens/scripts/generate-radix.ts`:

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const PKG_DIR = dirname(require.resolve('@radix-ui/colors/package.json'));
const OUT = join(import.meta.dirname, '..', 'src', 'radix.ts');

const SCALES = ['slate', 'indigo', 'teal', 'crimson', 'orange', 'purple', 'cyan'] as const;

function steps(file: string, name: string): string[] {
  const css = readFileSync(join(PKG_DIR, file), 'utf8');
  const out: string[] = [];
  for (let i = 1; i <= 12; i++) {
    const m = new RegExp(`--${name}-${i}: (#[0-9a-f]{6});`).exec(css);
    if (!m) throw new Error(`${file}: no --${name}-${i}`);
    out.push(m[1]!);
  }
  return out;
}

function tuple(values: string[]): string {
  return '[' + values.map(v => `'${v}'`).join(', ') + ']';
}

function render(): string {
  const version = (JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8')) as { version: string }).version;
  const lines = [
    '/* GENERATED by packages/tokens/scripts/generate-radix.ts from @radix-ui/colors; do not edit. */',
    '',
    `export const RADIX_VERSION = '${version}';`,
    '',
    `export const RADIX_SCALES = [${SCALES.map(s => `'${s}'`).join(', ')}] as const;`,
    'export type RadixScaleName = (typeof RADIX_SCALES)[number];',
    '',
    'export type Scale12 = readonly [',
    '  string, string, string, string, string, string,',
    '  string, string, string, string, string, string,',
    '];',
    '',
    'export const RADIX: Record<RadixScaleName, { light: Scale12; dark: Scale12 }> = {',
  ];
  for (const name of SCALES) {
    lines.push(`  ${name}: {`);
    lines.push(`    light: ${tuple(steps(`${name}.css`, name))},`);
    lines.push(`    dark: ${tuple(steps(`${name}-dark.css`, name))},`);
    lines.push('  },');
  }
  lines.push('};', '');
  return lines.join('\n');
}

if (import.meta.main) {
  writeFileSync(OUT, render());
}
```

Root `package.json` scripts, after `"tokens:codegen"`: `"tokens:radix": "bun run packages/tokens/scripts/generate-radix.ts",`. Add `packages/tokens/src/radix.ts` to `.prettierignore` under the `apps/deck/core/generated` entry with the comment `# generated from @radix-ui/colors by packages/tokens/scripts/generate-radix.ts; radix-fresh.test.ts byte-compares it`.

Run: `bun run tokens:radix && cd packages/tokens && bunx vitest run test/radix-fresh.test.ts && bun run typecheck`
Expected: `src/radix.ts` written; test PASS; typecheck clean. Open `radix.ts` and confirm the slate light row starts `#fcfcfd` and indigo light step 9 is `#3e63dd` (the values reference above).

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lock .prettierignore packages/tokens
git commit -m "tokens: vendor the seven Radix Colors scales with a freshness test"
```

### Task 1: Ramps in `values.ts` as Radix steps, with the rules as invariants

**Files:**
- Modify: `packages/tokens/src/values.ts`
- Test: `packages/tokens/test/invariants.test.ts`

**Interfaces:**
- Consumes: `RADIX`, `Scale12`, `RadixScaleName` from Task 0.
- Produces: `HUES`, `HueName`, `HueSet`, `HUE_SCALE: Record<HueName, RadixScaleName>`, `Ramp4`, `Ramp3`, `RampIndex4`, `RampIndex3`, `Step` (1..12), `SurfaceRole` (now includes `raised`), `TextRole`, `LineRole`, `HueStep = { fill: Step; text: Step }`. `ColorScheme` gains `surfaceRamp`, `textRamp`, `lineRamp`, `surfaceRole`, `textRole`, `lineRole`, `hueStep`, `hueHover`, `hueText`, `hueTextSmall`, `surface.raised`, `line.control`; loses `dot`. `TOKENS.light` / `TOKENS.dark` resolve every value from `RADIX`.

- [ ] **Step 1: Write the failing invariants**

Replace `packages/tokens/test/invariants.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';

import { contrastRatio, srgbLuminance } from '../src/color-math.ts';
import { RADIX } from '../src/radix.ts';
import { CSS_TEXT, HUE_SCALE, HUES, TOKENS, type Step } from '../src/values.ts';

const SCHEMES = ['light', 'dark'] as const;
const WHITE = '#ffffff';
const TEXT_BAR = [0, 4.5, 5.2, 7.0] as const;

function worst(hex: string, surfaces: readonly string[]): number {
  return Math.min(...surfaces.map(s => contrastRatio(hex, s)));
}

describe('surface ramp', () => {
  it.each(SCHEMES)('%s: surface-1 has the most contrast against text-1, strictly descending', scheme => {
    const t = TOKENS[scheme];
    const ratios = t.surfaceRamp.map(s => contrastRatio(t.textRamp[0], s));
    for (let i = 1; i < ratios.length; i++) {
      expect(ratios[i], `${scheme} surface-${i + 1} vs surface-${i}`).toBeLessThan(ratios[i - 1]!);
    }
  });

  it.each(SCHEMES)('%s: every surface role is the ramp step its index names', scheme => {
    const t = TOKENS[scheme];
    expect(t.surface.card).toBe(t.surfaceRamp[t.surfaceRole.card - 1]);
    expect(t.surface.panel).toBe(t.surfaceRamp[t.surfaceRole.panel - 1]);
    expect(t.surface.bg).toBe(t.surfaceRamp[t.surfaceRole.page - 1]);
    expect(t.surface.chrome).toBe(t.surfaceRamp[t.surfaceRole.chrome - 1]);
    expect(t.surface.inset).toBe(t.surfaceRamp[t.surfaceRole.inset - 1]);
    expect(t.surface.overlay).toBe(t.surfaceRamp[t.surfaceRole.overlay - 1]);
    expect(t.surface.raised).toBe(t.surfaceRamp[t.surfaceRole.raised - 1]);
  });

  it.each(SCHEMES)('%s: bg < panel < card by luminance direction', scheme => {
    const s = TOKENS[scheme].surface;
    const [bg, panel, card] = [s.bg, s.panel, s.card].map(srgbLuminance);
    if (scheme === 'light') {
      expect(bg).toBeLessThan(panel!);
      expect(panel).toBeLessThan(card!);
    } else {
      expect(bg).toBeLessThan(panel!);
      expect(panel).toBeLessThan(card!);
    }
  });

  it.each(SCHEMES)('%s: inset sits below card and overlay never above panel', scheme => {
    const s = TOKENS[scheme].surface;
    expect(srgbLuminance(s.inset)).toBeLessThan(srgbLuminance(s.card));
    expect(srgbLuminance(s.overlay)).toBeLessThanOrEqual(srgbLuminance(s.panel));
  });

  it('light surfaces are white then slate 1..3; dark surfaces are slate 1..4', () => {
    expect([...TOKENS.light.surfaceRamp]).toEqual([WHITE, ...RADIX.slate.light.slice(0, 3)]);
    expect([...TOKENS.dark.surfaceRamp]).toEqual([...RADIX.slate.dark.slice(0, 4)]);
  });
});

describe('text ramp', () => {
  it.each(SCHEMES)('%s: text-2..4 clear their bars on every surface', scheme => {
    const t = TOKENS[scheme];
    for (let i = 1; i < 4; i++) {
      expect(worst(t.textRamp[i]!, t.surfaceRamp), `${scheme} text-${i + 1}`).toBeGreaterThanOrEqual(TEXT_BAR[i]!);
    }
  });

  it.each(SCHEMES)('%s: text-1 clears 7.0 on every surface', scheme => {
    const t = TOKENS[scheme];
    expect(worst(t.textRamp[0], t.surfaceRamp)).toBeGreaterThanOrEqual(7.0);
  });

  it.each(SCHEMES)('%s: text roles are ramp steps and the ramp is slate 12, 11, 11, 12', scheme => {
    const t = TOKENS[scheme];
    const s = RADIX.slate[scheme];
    expect([...t.textRamp]).toEqual([s[11], s[10], s[10], s[11]]);
    expect(t.text.fg).toBe(t.textRamp[t.textRole.fg - 1]);
    expect(t.text.mutedText).toBe(t.textRamp[t.textRole.mutedText - 1]);
    expect(t.text.mutedOnCard).toBe(t.textRamp[t.textRole.mutedOnCard - 1]);
  });
});

describe('line ramp', () => {
  it.each(SCHEMES)('%s: slate 8, 7, 6 in light and 9, 7, 6 in dark, strongest first against its ground', scheme => {
    const t = TOKENS[scheme];
    const s = RADIX.slate[scheme];
    expect([...t.lineRamp]).toEqual(scheme === 'light' ? [s[7], s[6], s[5]] : [s[8], s[6], s[5]]);
    const ground = scheme === 'light' ? WHITE : t.surface.card;
    const ratios = t.lineRamp.map(l => contrastRatio(l, ground));
    for (let i = 1; i < ratios.length; i++) expect(ratios[i]).toBeLessThanOrEqual(ratios[i - 1]!);
  });

  it('dark line-1 holds the non-text bar against the card', () => {
    expect(contrastRatio(TOKENS.dark.line.control, TOKENS.dark.surface.card)).toBeGreaterThanOrEqual(3.0);
  });

  it.each(SCHEMES)('%s: line roles are ramp steps', scheme => {
    const t = TOKENS[scheme];
    expect(t.line.border).toBe(t.lineRamp[t.lineRole.border - 1]);
    expect(t.line.soft).toBe(t.lineRamp[t.lineRole.soft - 1]);
    expect(t.line.control).toBe(t.lineRamp[t.lineRole.control - 1]);
    expect(t.line.edgeOnCard).toBe(t.lineRamp[t.lineRole.edgeOnCard - 1]);
    expect(t.line.softOnCard).toBe(t.lineRamp[t.lineRole.softOnCard - 1]);
    expect(t.line.controlEdgeOnCard).toBe(t.line.control);
  });
});

function ruleFill(scale: readonly string[], surfaces: readonly string[], scheme: 'light' | 'dark'): Step {
  if (worst(scale[8]!, surfaces) >= 3.0) return 9;
  if (scheme === 'dark' && contrastRatio(scale[9]!, WHITE) < 4.5) return 9;
  return 10;
}

function ruleText(scale: readonly string[], surfaces: readonly string[]): Step {
  return worst(scale[10]!, surfaces) >= 4.5 ? 11 : 12;
}

describe('palette', () => {
  it.each(SCHEMES)('%s: every hue value is the Radix step its rule picks', scheme => {
    const t = TOKENS[scheme];
    for (const hue of HUES) {
      const scale = RADIX[HUE_SCALE[hue]][scheme];
      const fill = ruleFill(scale, t.surfaceRamp, scheme);
      const text = ruleText(scale, t.surfaceRamp);
      expect(t.hueStep[hue], `${scheme} ${hue} steps`).toEqual({ fill, text });
      expect(t.hue[hue]).toBe(scale[fill - 1]);
      expect(t.hueHover[hue]).toBe(
        fill === 9 ? scale[9] : `color-mix(in srgb, ${scale[fill - 1]} 88%, ${t.textRamp[0]})`
      );
      expect(t.hueText[hue]).toBe(scale[text - 1]);
      expect(t.hueTextSmall[hue]).toBe(scale[11]);
    }
  });

  it.each(SCHEMES)('%s: hue text clears 4.5 at body and 7.0 at small on every surface', scheme => {
    const t = TOKENS[scheme];
    for (const hue of HUES) {
      expect(worst(t.hueText[hue], t.surfaceRamp), `${scheme} text-${hue}`).toBeGreaterThanOrEqual(4.5);
      expect(worst(t.hueTextSmall[hue], t.surfaceRamp), `${scheme} text-${hue}-small`).toBeGreaterThanOrEqual(7.0);
    }
  });

  it('step 9 is the same hex in both schemes for every hue', () => {
    for (const hue of HUES) {
      expect(RADIX[HUE_SCALE[hue]].light[8], hue).toBe(RADIX[HUE_SCALE[hue]].dark[8]);
    }
  });

  it('the fills that miss 3.0 are exactly the ledgered three', () => {
    const misses: string[] = [];
    for (const scheme of SCHEMES) {
      const t = TOKENS[scheme];
      for (const hue of HUES) {
        if (worst(t.hue[hue], t.surfaceRamp) < 3.0) misses.push(`${scheme}/${hue}`);
      }
    }
    expect(misses.sort()).toEqual(['dark/accent', 'dark/purple', 'light/warn']);
  });

  it.each(SCHEMES)('%s: legacy text leaves read the hue text', scheme => {
    const t = TOKENS[scheme];
    expect(t.text.accentText).toBe(t.hueText.accent);
    expect(t.text.okText).toBe(t.hueText.ok);
    expect(t.text.warnText).toBe(t.hueText.warn);
    expect(t.text.redText).toBe(t.hueText.bad);
    expect(t.text.badgeText).toBe(t.textRamp[2]);
    expect(t.text.muted).toBe(RADIX.slate[scheme][8]);
  });
});

describe('CSS_TEXT overrides', () => {
  it('every key resolves to an existing TOKENS path with the same color', () => {
    for (const [path, cssText] of Object.entries(CSS_TEXT)) {
      const resolved: unknown = path
        .split('.')
        .reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], TOKENS);
      expect(typeof resolved, `${path} resolves to a TOKENS string`).toBe('string');
      expect(srgbLuminance(cssText)).toBe(srgbLuminance(resolved as string));
    }
  });
});
```

Run: `cd packages/tokens && bunx vitest run test/invariants.test.ts`
Expected: FAIL: `HUES`, `HUE_SCALE`, `surfaceRamp` do not exist.

- [ ] **Step 2: Rewrite `values.ts`**

Replace the whole of `packages/tokens/src/values.ts` with:

```ts
import { RADIX, type RadixScaleName, type Scale12 } from './radix.ts';

export const HUES = ['accent', 'ok', 'bad', 'warn', 'purple', 'cyan'] as const;
export type HueName = (typeof HUES)[number];
export type HueSet = Record<HueName, string>;

export const HUE_SCALE: Record<HueName, RadixScaleName> = {
  accent: 'indigo',
  ok: 'teal',
  bad: 'crimson',
  warn: 'orange',
  purple: 'purple',
  cyan: 'cyan',
};

export type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
export type Ramp4 = readonly [string, string, string, string];
export type Ramp3 = readonly [string, string, string];
export type RampIndex4 = 1 | 2 | 3 | 4;
export type RampIndex3 = 1 | 2 | 3;

export type SurfaceRole = 'card' | 'panel' | 'page' | 'chrome' | 'inset' | 'overlay' | 'raised';
export type TextRole = 'fg' | 'mutedText' | 'mutedOnCard';
export type LineRole = 'border' | 'soft' | 'control' | 'edgeOnCard' | 'softOnCard';
export interface HueStep {
  fill: Step;
  text: Step;
}

export interface ColorScheme {
  hue: HueSet;
  hueHover: HueSet;
  hueText: HueSet;
  hueTextSmall: HueSet;
  hueStep: Record<HueName, HueStep>;
  surfaceRamp: Ramp4;
  textRamp: Ramp4;
  lineRamp: Ramp3;
  surfaceRole: Record<SurfaceRole, RampIndex4>;
  textRole: Record<TextRole, RampIndex4>;
  lineRole: Record<LineRole, RampIndex3>;
  text: {
    fg: string;
    muted: string;
    mutedText: string;
    accentText: string;
    okText: string;
    warnText: string;
    badgeText: string;
    redText: string;
    mutedOnCard: string;
  };
  surface: {
    chrome: string;
    bg: string;
    panel: string;
    card: string;
    inset: string;
    overlay: string;
    raised: string;
  };
  line: {
    border: string;
    soft: string;
    grid: string;
    control: string;
    edgeOnCard: string;
    controlEdgeOnCard: string;
    softOnCard: string;
  };
  wash: string;
}

export interface Tokens {
  light: ColorScheme;
  dark: ColorScheme;
  font: {
    mono: string;
    sans: string;
    baseSize: string;
    lineHeight: string;
  };
}

type Scheme = 'light' | 'dark';

interface SchemeSpec {
  scheme: Scheme;
  surfaceSteps: readonly [string | Step, Step, Step, Step];
  textSteps: readonly [Step, Step, Step, Step];
  lineSteps: readonly [Step, Step, Step];
  surfaceRole: Record<SurfaceRole, RampIndex4>;
  textRole: Record<TextRole, RampIndex4>;
  lineRole: Record<LineRole, RampIndex3>;
  hueStep: Record<HueName, HueStep>;
  grid: string;
  wash: string;
}

const at = (scale: Scale12, step: Step) => scale[step - 1]!;

// Every value is a step into a vendored Radix scale; a literal hex appears
// only for light surface-1 (pure white). invariants.test.ts checks that the
// steps are the ones the spec's rules pick, not just that the hex match.
function buildScheme(spec: SchemeSpec): ColorScheme {
  const slate = RADIX.slate[spec.scheme];
  const surfaceRamp = spec.surfaceSteps.map(s => (typeof s === 'string' ? s : at(slate, s))) as unknown as Ramp4;
  const textRamp = spec.textSteps.map(s => at(slate, s)) as unknown as Ramp4;
  const lineRamp = spec.lineSteps.map(s => at(slate, s)) as unknown as Ramp3;
  // Non-null on purpose: tui-kit compiles this file too, under
  // noUncheckedIndexedAccess, and the indices are typed 1..4 / 1..3.
  const s = (i: RampIndex4) => surfaceRamp[i - 1]!;
  const t = (i: RampIndex4) => textRamp[i - 1]!;
  const l = (i: RampIndex3) => lineRamp[i - 1]!;
  const hueValue = (pick: (scale: Scale12, step: HueStep) => string): HueSet =>
    Object.fromEntries(HUES.map(h => [h, pick(RADIX[HUE_SCALE[h]][spec.scheme], spec.hueStep[h])])) as HueSet;
  const hue = hueValue((scale, step) => at(scale, step.fill));
  // Step 10 is the last non-text step, so a fill already on it hovers as the
  // mix tui-kit shipped for filled hover rather than stepping onto text.
  const hueHover = hueValue((scale, step) =>
    step.fill === 9 ? at(scale, 10) : `color-mix(in srgb, ${at(scale, step.fill)} 88%, ${textRamp[0]})`
  );
  const hueText = hueValue((scale, step) => at(scale, step.text));
  const hueTextSmall = hueValue(scale => at(scale, 12));
  return {
    hue,
    hueHover,
    hueText,
    hueTextSmall,
    hueStep: spec.hueStep,
    surfaceRamp,
    textRamp,
    lineRamp,
    surfaceRole: spec.surfaceRole,
    textRole: spec.textRole,
    lineRole: spec.lineRole,
    text: {
      fg: t(spec.textRole.fg),
      muted: at(slate, 9),
      mutedText: t(spec.textRole.mutedText),
      accentText: hueText.accent,
      okText: hueText.ok,
      warnText: hueText.warn,
      badgeText: t(3),
      redText: hueText.bad,
      mutedOnCard: t(spec.textRole.mutedOnCard),
    },
    surface: {
      chrome: s(spec.surfaceRole.chrome),
      bg: s(spec.surfaceRole.page),
      panel: s(spec.surfaceRole.panel),
      card: s(spec.surfaceRole.card),
      inset: s(spec.surfaceRole.inset),
      overlay: s(spec.surfaceRole.overlay),
      raised: s(spec.surfaceRole.raised),
    },
    line: {
      border: l(spec.lineRole.border),
      soft: l(spec.lineRole.soft),
      grid: spec.grid,
      control: l(spec.lineRole.control),
      edgeOnCard: l(spec.lineRole.edgeOnCard),
      controlEdgeOnCard: l(spec.lineRole.control),
      softOnCard: l(spec.lineRole.softOnCard),
    },
    wash: spec.wash,
  };
}

const LIGHT_HUE_STEPS: Record<HueName, HueStep> = {
  accent: { fill: 9, text: 11 },
  ok: { fill: 10, text: 12 },
  bad: { fill: 9, text: 11 },
  warn: { fill: 10, text: 12 },
  purple: { fill: 9, text: 11 },
  cyan: { fill: 10, text: 12 },
};

const DARK_HUE_STEPS: Record<HueName, HueStep> = {
  accent: { fill: 9, text: 11 },
  ok: { fill: 9, text: 11 },
  bad: { fill: 9, text: 11 },
  warn: { fill: 9, text: 11 },
  purple: { fill: 9, text: 11 },
  cyan: { fill: 9, text: 11 },
};

export const TOKENS: Tokens = {
  light: buildScheme({
    scheme: 'light',
    surfaceSteps: ['#ffffff', 1, 2, 3],
    textSteps: [12, 11, 11, 12],
    lineSteps: [8, 7, 6],
    surfaceRole: { card: 1, panel: 2, page: 3, chrome: 4, inset: 3, overlay: 2, raised: 4 },
    textRole: { fg: 1, mutedText: 3, mutedOnCard: 3 },
    lineRole: { border: 2, soft: 3, control: 1, edgeOnCard: 2, softOnCard: 3 },
    hueStep: LIGHT_HUE_STEPS,
    grid: 'rgba(52, 59, 88, 0.05)',
    wash: '10%',
  }),
  dark: buildScheme({
    scheme: 'dark',
    surfaceSteps: [1, 2, 3, 4],
    textSteps: [12, 11, 11, 12],
    lineSteps: [9, 7, 6],
    surfaceRole: { card: 3, panel: 2, page: 1, chrome: 2, inset: 1, overlay: 1, raised: 4 },
    textRole: { fg: 1, mutedText: 3, mutedOnCard: 3 },
    lineRole: { border: 2, soft: 3, control: 1, edgeOnCard: 1, softOnCard: 2 },
    hueStep: DARK_HUE_STEPS,
    grid: 'rgba(122, 162, 247, 0.06)',
    wash: '15%',
  }),
  font: {
    mono: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    baseSize: '13.5px',
    lineHeight: '1.55',
  },
};

// Dot-path (e.g. 'light.text.fg') into TOKENS, keyed to the exact CSS text an
// emitter must print in place of the six-digit canonical value at that path.
// Empty now that text-1 is slate 12 rather than the historical `#222`; the
// mechanism stays for the next spelling that has to survive a migration.
export const CSS_TEXT: Record<string, string> = {};
```

- [ ] **Step 3: Run the tokens tests**

Run: `cd packages/tokens && bunx vitest run test/invariants.test.ts test/radix-fresh.test.ts && bun run typecheck`
Expected: tests PASS. Typecheck reports exactly six TS2339 errors, all in `scripts/generate.ts`, all on `t.dot.ok` / `t.dot.warn` / `t.dot.bad` (three in `buildTuiKitColors`, three in `buildTokyoDeclarations`): `dot` left `ColorScheme` in this task and Tasks 2 and 3 rewrite those reads. Any other typecheck error is a defect in this task. `consumption.test.ts`, `fragment-sync.test.ts`, `ramp-anchors.test.ts` are stale until Tasks 2 to 4 and are not run here.

The `dark` and `light` `bg < panel < card` branches are identical on purpose: both schemes order page below panel below card in luminance (light: `#f9f9fb` < `#fcfcfd` < `#ffffff`; dark: `#111113` < `#18191b` < `#212225`), so the old test's assumption survives the ramp change; the branch is written out so a future scheme that inverts it fails here rather than downstream.

- [ ] **Step 4: Commit**

```bash
git add packages/tokens/src/values.ts packages/tokens/test/invariants.test.ts
git commit -m "tokens: every colour a Radix step chosen by rule; ramps and roles derived by index"
```

### Task 2: Emit the ramps through tui-kit, retune the buttons, rewrite the ledger

**Files:**
- Modify: `packages/tokens/scripts/generate.ts:39-90`
- Modify: `packages/tui-kit/src/theme.ts:185-242`
- Modify: `packages/tui-kit/soribashi.config.ts:42-95`
- Modify: `packages/tui-kit/test/theme.test.ts`
- Modify: `packages/tokens/test/consumption.test.ts`
- Modify: `packages/tui-kit/src/intent-resolver.ts:38-111`, `packages/tui-kit/src/recipes/Button/Button.tsx:89`, `packages/tui-kit/src/a11y/known-contrast-debt.ts`
- Test: `packages/tui-kit/test/intent-resolver.test.ts` (new, node tier), `packages/tui-kit/src/recipes/Button/Button.matrix.test.tsx` (existing, must go green)
- Regenerate: `packages/tui-kit/src/generated/tokens.ts`, `packages/tui-kit/src/generated/theme.css`; refresh every `packages/tui-kit/src/recipes/*/__screenshots__/*`

**Interfaces:**
- Consumes: `TOKENS[scheme]` from Task 1.
- Produces: tui-kit colour families `ground["1".."4"]`, `ink["1".."4"]`, `rule["1".."3"]`, `<family>.{500,hover,text,textSmall}`, `surface.raised`, `line.control`, `dot.{ok,warn,bad}` (now the fills); emitted CSS names `--color-ground-N`, `--color-ink-N`, `--color-rule-N`, `--color-<family>-hover/text/textSmall`, `--surface-raised`, `--border-control`; public aliases `--surface-1..4`, `--text-1..4`, `--line-1..3`, `--page`, `--raised`, `--fill-<hue>`, `--fill-<hue>-hover`, `--text-<hue>`, `--text-<hue>-small`. `retunedTextColor(tone, variant, intent)` returns the hue text token for `outline`/`subtle`, the small token for `light`, and the raw tone otherwise; `toneWeightFor` and the two weight tables are deleted; `KNOWN_CONTRAST_DEBT` holds exactly the eight filled cells from the values reference.

- [ ] **Step 1: Write the failing theme tests**

In `packages/tui-kit/test/theme.test.ts`:

Replace the three ruling constants (`SURFACE_RAMP_RULING`, `TEXT_CONFORMANCE_RULING`, `DARK_SURFACE_RETUNE`) and the `LIGHT_COLORS` / `DARK_COLORS` filters with one ruling: every colour slot leaves both census sweeps, fonts stay.

```ts
// The palette moved wholesale to Radix Colors (packages/tokens/src/radix.ts),
// so no colour still carries its mr-board census literal; both colour sweeps
// are empty and the "ramps" block further down covers every colour against
// the tokens package instead. Fonts keep their own block below.
const LIGHT_COLORS: [string, string][] = [];
const DARK_COLORS: [string, string][] = [];
```

An empty `test.each([])` is a pass in vitest 4; leave the two sweep tests in place.

Four more existing tests pin the old palette by literal and are rewritten to read the tokens package (never a new literal): "the light surface ramp carries the split-chrome ruling's values" (`#f7f8fa`/`#fbfbfc`) and "chrome carries the ruling's value in both schemes" (`#f3f4f7`/`#1a1c28`) become one test asserting `resolve("--bg"|"--panel"|"--chrome", scheme)` equals `TOKENS[scheme].surface.bg|panel|chrome`; "generated css exposes the alias contract" loses its `#4658ff`, `#7aa2f7`, `#1a1c28` literals in favour of `TOKENS.light.hue.accent`, `TOKENS.dark.hue.accent`, `TOKENS.dark.surface.chrome`; "intent resolver maps intent words onto the single-shade families" expects `outline|ok`'s `.color` to be `var(--text-ok)` and `subtle|muted`'s to be `var(--text-2)` (the retune in Step 7 is what makes those true, so this test goes green at Step 9).

Rewrite these existing tests to the new values (each keeps its name shape, values from the tokens package rather than typed): "the dark surface ramp carries the retune's values" becomes

```ts
test("the surface ramps carry the Radix steps, ordered page < panel < card", () => {
  expect(tuiTheme.dark!.colors!.surface!.bg).toBe(TOKENS.dark.surface.bg);
  expect(resolve("--bg", "dark")).toBe("#111113");
  expect(resolve("--panel", "dark")).toBe("#18191b");
  expect(resolve("--card", "dark")).toBe("#212225");
  expect(resolve("--bg", "light")).toBe("#f9f9fb");
  expect(resolve("--panel", "light")).toBe("#fcfcfd");
  expect(resolve("--card", "light")).toBe("#ffffff");
});
```

with `import { TOKENS } from "@mattstack/tokens";` added (tui-kit already depends on the workspace package; if not, add `"@mattstack/tokens": "workspace:*"` to its devDependencies and `bun install` at the root). "fg carries the value-conformance ruling's #222" becomes expectations of `#1c2024` / `#edeef0`; the `muted FILL` test expects `#8b8d98` / `#696e77` for `--muted` and `#60646c` / `#b0b4ba` for `--muted-text`; "accentText and badText" expects `#3a5bc7` / `#9eb1ff` for `--accent-text` and `#cb1d63` / `#ff92ad` for `--red-text`.

Add at the end of the file:

```ts
// ── ramps ────────────────────────────────────────────────────────────────

test("the public ramp names resolve to the tokens package's ramp values", () => {
  for (const scheme of ["light", "dark"] as const) {
    const t = TOKENS[scheme];
    t.surfaceRamp.forEach((v, i) => expect(resolve(`--surface-${i + 1}`, scheme)).toBe(v));
    t.textRamp.forEach((v, i) => expect(resolve(`--text-${i + 1}`, scheme)).toBe(v));
    t.lineRamp.forEach((v, i) => expect(resolve(`--line-${i + 1}`, scheme)).toBe(v));
    expect(resolve("--page", scheme)).toBe(t.surface.bg);
    expect(resolve("--raised", scheme)).toBe(t.surface.raised);
    for (const hue of ["accent", "ok", "bad", "warn", "purple", "cyan"] as const) {
      expect(resolve(`--fill-${hue}`, scheme)).toBe(t.hue[hue]);
      expect(resolve(`--fill-${hue}-hover`, scheme)).toBe(t.hueHover[hue]);
      expect(resolve(`--text-${hue}`, scheme)).toBe(t.hueText[hue]);
      expect(resolve(`--text-${hue}-small`, scheme)).toBe(t.hueTextSmall[hue]);
    }
  }
});

test("every surface role is a ramp step in both schemes", () => {
  for (const scheme of ["light", "dark"] as const) {
    const ramp = [1, 2, 3, 4].map((i) => resolve(`--surface-${i}`, scheme));
    for (const role of ["--card", "--panel", "--page", "--chrome", "--surface-inset", "--surface-overlay", "--raised"]) {
      expect(ramp, `${scheme} ${role}`).toContain(resolve(role, scheme));
    }
  }
});

test("card-scope line aliases carry the per-scheme mapping", () => {
  expect(resolve("--border-on-card", "light")).toBe(resolve("--line-2", "light"));
  expect(resolve("--border-on-card", "dark")).toBe(resolve("--line-1", "dark"));
  expect(resolve("--border-soft-on-card", "light")).toBe(resolve("--line-3", "light"));
  expect(resolve("--border-soft-on-card", "dark")).toBe(resolve("--line-2", "dark"));
  expect(resolve("--border-control", "dark")).toBe("#696e77");
});

test("dots are fills", () => {
  for (const scheme of ["light", "dark"] as const) {
    expect(resolve("--dot-ok", scheme)).toBe(resolve("--fill-ok", scheme));
    expect(resolve("--dot-warn", scheme)).toBe(resolve("--fill-warn", scheme));
    expect(resolve("--dot-bad", scheme)).toBe(resolve("--fill-bad", scheme));
  }
});
```

Run: `cd packages/tui-kit && bunx vitest run --project node test/theme.test.ts`
Expected: FAIL on the new tests (names not emitted) and on every rewritten value.

- [ ] **Step 2: Emit the new families from `generate.ts`**

In `packages/tokens/scripts/generate.ts`, replace `buildTuiKitColors` with:

```ts
function buildTuiKitColors(scheme: 'light' | 'dark') {
  const t: ColorScheme = TOKENS[scheme];
  const at = (leaf: string, value: string) => pick(`${scheme}.${leaf}`, value);
  const family = (hue: HueName) => ({
    '500': at(`hue.${hue}`, t.hue[hue]),
    hover: at(`hueHover.${hue}`, t.hueHover[hue]),
    text: at(`hueText.${hue}`, t.hueText[hue]),
    textSmall: at(`hueTextSmall.${hue}`, t.hueTextSmall[hue]),
  });
  const ramp = (leaf: string, values: readonly string[]) =>
    Object.fromEntries(values.map((v, i) => [String(i + 1), at(`${leaf}.${i}`, v)]));
  return {
    blue: family('accent'),
    green: family('ok'),
    red: family('bad'),
    amber: family('warn'),
    purple: family('purple'),
    cyan: family('cyan'),
    ground: ramp('surfaceRamp', t.surfaceRamp),
    ink: ramp('textRamp', t.textRamp),
    rule: ramp('lineRamp', t.lineRamp),
    gray: {
      fg: at('text.fg', t.text.fg),
      muted: at('text.muted', t.text.muted),
      mutedText: at('text.mutedText', t.text.mutedText),
      accentText: at('text.accentText', t.text.accentText),
      okText: at('text.okText', t.text.okText),
      warnText: at('text.warnText', t.text.warnText),
      badgeText: at('text.badgeText', t.text.badgeText),
      redText: at('text.redText', t.text.redText),
      mutedOnCard: at('text.mutedOnCard', t.text.mutedOnCard),
    },
    surface: {
      bg: at('surface.bg', t.surface.bg),
      panel: at('surface.panel', t.surface.panel),
      card: at('surface.card', t.surface.card),
      chrome: at('surface.chrome', t.surface.chrome),
      inset: at('surface.inset', t.surface.inset),
      overlay: at('surface.overlay', t.surface.overlay),
      raised: at('surface.raised', t.surface.raised),
    },
    line: {
      border: at('line.border', t.line.border),
      soft: at('line.soft', t.line.soft),
      grid: at('line.grid', t.line.grid),
      control: at('line.control', t.line.control),
      edgeOnCard: at('line.edgeOnCard', t.line.edgeOnCard),
      controlEdgeOnCard: at('line.controlEdgeOnCard', t.line.controlEdgeOnCard),
      softOnCard: at('line.softOnCard', t.line.softOnCard),
    },
    dot: {
      ok: at('hue.ok', t.hue.ok),
      warn: at('hue.warn', t.hue.warn),
      bad: at('hue.bad', t.hue.bad),
    },
  };
}
```

Change the import line to `import { CSS_TEXT, TOKENS, type ColorScheme, type HueName } from '../src/values.ts';`.

- [ ] **Step 3: Declare the semantic roles and the public aliases in tui-kit**

In `packages/tui-kit/src/theme.ts`: add `raised: "colors.surface.raised",` inside `semanticTokens.surface` after `overlay`, and `control: "colors.line.control",` inside `semanticTokens.border` after `default`.

In `packages/tui-kit/soribashi.config.ts`, add inside the `root` object after the `"--border": "var(--border-default)"` line:

```ts
    "--page": "var(--surface-canvas)",
    "--raised": "var(--surface-raised)",
    "--surface-1": "var(--color-ground-1)",
    "--surface-2": "var(--color-ground-2)",
    "--surface-3": "var(--color-ground-3)",
    "--surface-4": "var(--color-ground-4)",
    "--text-1": "var(--color-ink-1)",
    "--text-2": "var(--color-ink-2)",
    "--text-3": "var(--color-ink-3)",
    "--text-4": "var(--color-ink-4)",
    "--line-1": "var(--color-rule-1)",
    "--line-2": "var(--color-rule-2)",
    "--line-3": "var(--color-rule-3)",
    "--fill-accent": "var(--color-blue-500)",
    "--fill-accent-hover": "var(--color-blue-hover)",
    "--fill-ok": "var(--color-green-500)",
    "--fill-ok-hover": "var(--color-green-hover)",
    "--fill-bad": "var(--color-red-500)",
    "--fill-bad-hover": "var(--color-red-hover)",
    "--fill-warn": "var(--color-amber-500)",
    "--fill-warn-hover": "var(--color-amber-hover)",
    "--fill-purple": "var(--color-purple-500)",
    "--fill-purple-hover": "var(--color-purple-hover)",
    "--fill-cyan": "var(--color-cyan-500)",
    "--fill-cyan-hover": "var(--color-cyan-hover)",
    "--text-accent": "var(--color-blue-text)",
    "--text-accent-small": "var(--color-blue-textSmall)",
    "--text-ok": "var(--color-green-text)",
    "--text-ok-small": "var(--color-green-textSmall)",
    "--text-bad": "var(--color-red-text)",
    "--text-bad-small": "var(--color-red-textSmall)",
    "--text-warn": "var(--color-amber-text)",
    "--text-warn-small": "var(--color-amber-textSmall)",
    "--text-purple": "var(--color-purple-text)",
    "--text-purple-small": "var(--color-purple-textSmall)",
    "--text-cyan": "var(--color-cyan-text)",
    "--text-cyan-small": "var(--color-cyan-textSmall)",
```

- [ ] **Step 4: Waive the new public names in the consumption gate**

`packages/tokens/test/consumption.test.ts` fails any custom property emitted in tui-kit's `theme.css` that no recipe CSS, `canvas.css` or `theme.css` itself references, unless it is listed in `WAIVED_TUI` with a reason. Above `WAIVED_TUI` add:

```ts
const RAMP_HUES = ['accent', 'ok', 'bad', 'warn', 'purple', 'cyan'];
const RAMP_PUBLIC_NAMES = [
  '--page',
  '--raised',
  '--border-control',
  ...[1, 2, 3, 4].flatMap(i => [`--surface-${i}`, `--text-${i}`]),
  ...[1, 2, 3].map(i => `--line-${i}`),
  ...RAMP_HUES.flatMap(h => [`--fill-${h}`, `--fill-${h}-hover`, `--text-${h}`, `--text-${h}-small`]),
];
const RAMP_WAIVER =
  'ramp name emitted ahead of the apps-wide migration; the storybook specimens and the ramp contrast gate read it, no kit recipe does yet.';
```

and make the first entries of `WAIVED_TUI`:

```ts
const WAIVED_TUI: Record<string, string> = {
  ...Object.fromEntries(RAMP_PUBLIC_NAMES.map(name => [name, RAMP_WAIVER])),
```

keeping every existing entry after that spread. `--surface-raised` is not waived: the `--raised` alias references it. The no-stale-waivers check will name any entry that is now referenced; remove exactly those.

- [ ] **Step 5: Regenerate and run the node tier**

Run:
```bash
bun run tokens:codegen
cd packages/tui-kit && bun run codegen && bunx vitest run --project node
cd ../tokens && bunx vitest run test/consumption.test.ts
```
Expected: PASS, including `theme.test.ts`'s referential-closure test (every `var()` has a declaration). `test/no-hardcoded-values.test.ts` and `test/token-existence.test.ts` are unaffected because no recipe changes here.

- [ ] **Step 6: Write the failing resolver test**

Create `packages/tui-kit/test/intent-resolver.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { retunedTextColor, tuiIntentResolver } from "../src/intent-resolver.ts";

describe("hue text retune", () => {
  test("filled paints a white label on hue fills and a scheme-aware label on the neutral fill", () => {
    const r = tuiIntentResolver({ intent: "ok", variant: "filled" });
    expect(r.color).toBe("#ffffff");
    expect(r.hover).toBe("var(--color-green-hover)");
    const m = tuiIntentResolver({ intent: "muted", variant: "filled" });
    expect(m.color).toBe("light-dark(var(--text-1), #ffffff)");
  });

  test("outline and subtle take the hue text token", () => {
    expect(retunedTextColor("var(--color-green-500)", "outline", "ok")).toBe("var(--text-ok)");
    expect(retunedTextColor("var(--color-purple-500)", "subtle", "purple")).toBe("var(--text-purple)");
  });

  test("the tinted light variant takes the small hue text token", () => {
    expect(retunedTextColor("var(--color-blue-500)", "light", "accent")).toBe("var(--text-accent-small)");
  });

  test("muted maps onto the neutral text ramp", () => {
    expect(retunedTextColor("var(--color-gray-muted)", "outline", "muted")).toBe("var(--text-2)");
    expect(retunedTextColor("var(--color-gray-muted)", "light", "muted")).toBe("var(--text-4)");
  });

  test("default is untouched", () => {
    expect(retunedTextColor("var(--color-blue-500)", "default", "accent")).toBe("var(--color-blue-500)");
  });
});
```

Run: `cd packages/tui-kit && bunx vitest run --project node test/intent-resolver.test.ts`
Expected: FAIL.

- [ ] **Step 7: Retune**

In `packages/tui-kit/src/intent-resolver.ts`, delete `LIGHT_VARIANT_TONE_WEIGHT`, `OUTLINE_SUBTLE_TONE_WEIGHT`, `toneWeightFor` and the comment block above them, and replace them with:

```ts
/**
 * Text tones. Fills are Radix step 9 or 10 and read under AA as text on the
 * kit's surfaces, so every text-bearing variant reads the hue's text token
 * instead; the tinted `light` variant lifts its ground above the page and
 * takes the small token for headroom. Both tokens are solved in
 * packages/tokens, one value per scheme, so nothing here mixes toward --fg.
 */
const TEXT_TONE: Record<string, string> = {
  accent: "var(--text-accent)",
  ok: "var(--text-ok)",
  warn: "var(--text-warn)",
  bad: "var(--text-bad)",
  cyan: "var(--text-cyan)",
  purple: "var(--text-purple)",
  muted: "var(--text-2)",
};

const TINT_TEXT_TONE: Record<string, string> = {
  accent: "var(--text-accent-small)",
  ok: "var(--text-ok-small)",
  warn: "var(--text-warn-small)",
  bad: "var(--text-bad-small)",
  cyan: "var(--text-cyan-small)",
  purple: "var(--text-purple-small)",
  muted: "var(--text-4)",
};

export function retunedTextColor(tone: string, variant: string, intent: string): string {
  if (variant === "light") return TINT_TEXT_TONE[intent] ?? tone;
  if (variant === "outline" || variant === "subtle") return TEXT_TONE[intent] ?? tone;
  return tone;
}
```

In `tuiIntentResolver`, the `filled` branch becomes:

```ts
  if (variant === "filled") {
    const neutral = family === "gray";
    result = {
      ...result,
      // slate 9 carries a white label at 3.3 in light and 5.1 in dark; the
      // high-contrast text step reads 5.0 on it in light, so the neutral fill
      // flips its label per scheme where the hue fills keep Radix's white.
      color: neutral ? "light-dark(var(--text-1), #ffffff)" : "#ffffff",
      hover: neutral ? `color-mix(in srgb, ${tone} 88%, var(--fg))` : `var(--color-${family}-hover)`,
      border: "transparent",
    };
  }
```

and the tail becomes:

```ts
  const color = retunedTextColor(tone, variant, intent);
  return color === tone ? result : { ...result, color };
```

`Chip.test.tsx` and `Button.test.tsx` import `retunedTextColor`; `Chip.test.tsx` also imports `toneWeightFor` if its census does (grep for it); replace any `toneWeightFor` use with a direct `retunedTextColor` comparison, since the probe already paints `retunedTextColor(...)`.

In `packages/tui-kit/src/recipes/Button/Button.tsx` line 89, change the pinned value to `"--sb-button-bad-color": "var(--text-bad)",` and delete the comment on line 88 that names `LIGHT_VARIANT_TONE_WEIGHT`, which no longer exists. In `packages/tui-kit/src/recipes/Button/Button.test.tsx` line 172, the `default|bad` probe paints the literal `"color-mix(in srgb, var(--red) 80%, var(--fg))"`; change it to `"var(--text-bad)"` so it keeps matching the pin. Delete the stale comment above the resolver's `filled` branch ("filled paints scheme-inverting text: --bg flips ..."); the branch's own comment in Step 7 replaces it.

- [ ] **Step 8: Rewrite the ledger**

Replace the `KNOWN_CONTRAST_DEBT` array in `packages/tui-kit/src/a11y/known-contrast-debt.ts` with exactly these eight entries (keep the header comment, the types and the helpers; reword the header's first paragraph to say the cells are Radix step 9 and 10 fills carrying the white label Radix's contract specifies):

```ts
export const KNOWN_CONTRAST_DEBT: readonly ContrastDebtEntry[] = [
  { variant: "filled", intent: "ok", scheme: "light", state: "rest", measuredRatio: 3.46, reason: "white label on teal 10, Radix's own label choice for the solid step" },
  { variant: "filled", intent: "warn", scheme: "light", state: "rest", measuredRatio: 3.33, reason: "white label on orange 10, Radix's own label choice for the solid step" },
  { variant: "filled", intent: "cyan", scheme: "light", state: "rest", measuredRatio: 3.42, reason: "white label on cyan 10, Radix's own label choice for the solid step" },
  { variant: "filled", intent: "bad", scheme: "light", state: "rest", measuredRatio: 3.85, reason: "white label on crimson 9, Radix's own label choice for the solid step" },
  { variant: "filled", intent: "ok", scheme: "dark", state: "rest", measuredRatio: 3.07, reason: "white label on teal 9, Radix's own label choice for the solid step" },
  { variant: "filled", intent: "warn", scheme: "dark", state: "rest", measuredRatio: 2.97, reason: "white label on orange 9, Radix's own label choice for the solid step" },
  { variant: "filled", intent: "cyan", scheme: "dark", state: "rest", measuredRatio: 3.0, reason: "white label on cyan 9, Radix's own label choice for the solid step" },
  { variant: "filled", intent: "bad", scheme: "dark", state: "rest", measuredRatio: 3.85, reason: "white label on crimson 9, Radix's own label choice for the solid step" },
];
```

The matrix asserts a ledger cell within `measuredRatio - 0.05 <= ratio < 4.5`; Chromium's serialization can land a few thousandths off the tokens-package number, and the tolerance covers that. The `filled|muted` cell is not in the ledger on purpose: its label flips per scheme in Step 7 (4.96 in light on the text-1 label, 5.13 in dark on white), so it clears the floor in both.

- [ ] **Step 9: Run the resolver test, codegen, then the matrix in both schemes**

Run:
```bash
cd packages/tui-kit && bunx vitest run --project node test/intent-resolver.test.ts && bun run codegen && bun run build
bunx vitest run --project browser src/recipes/Button/Button.matrix.test.tsx
```
Expected: PASS in both schemes with the ledger above (plus the muted entry if needed). A cell that fails outside the ledger is a wrong tone in `intent-resolver.ts` or `Button.tsx`, never a new ledger entry. `theme.css` does not change from the resolver edit; soribashi applies resolver output at render time (`autoVars`), so the codegen run only confirms nothing else moved.

- [ ] **Step 10: The rest of the browser tier, and every visual baseline**

Run: `cd packages/tui-kit && bunx vitest run --project browser --exclude '**/*.visual.test.tsx' --exclude '**/*.parity.test.tsx'`
Expected: PASS. `Chip.test.tsx`'s census probes and `Button.test.tsx`'s outline and subtle probes build their expected colours from `retunedTextColor`, so they follow the retune; the `default|bad` probe was repointed in Step 7.

Every recipe's visual baselines moved with the palette (local-only, CI excludes them): `cd packages/tui-kit && bunx vitest run --project browser visual -u`. Look at `button-grid-light` and `button-grid-dark` before committing: filled labels white, outline and subtle text the hue text tones, tinted variants on the Radix 3 ground. A layout shift is a defect; a colour shift is expected. `Button.parity.test.tsx` is excluded from CI and its oracle predates the arcade palette; leave it alone and say so in the report.

- [ ] **Step 11: Commit**

```bash
git add packages/tokens packages/tui-kit
git commit -m "tui-kit: emit the Radix ramps as public names; buttons read the hue text tokens; ledger to Radix's eight white-label cells"
```

### Task 3: Emit the ramps through tokyo, regenerate deck

**Files:**
- Modify: `packages/tokens/scripts/generate.ts:153-245`
- Modify: `packages/tokens/test/consumption.test.ts`
- Create: `packages/tokens/test/tokyo-ramp-names.test.ts`
- Regenerate: `packages/tokyo/src/tokyo-theme.css`, `apps/deck/core/generated/board.css`, `apps/deck/core/generated/board.js`, `apps/deck/core/generated/gateway.css`

**Interfaces:**
- Produces: `--tk-surface-1..4`, `--tk-text-1..4`, `--tk-line-1..3`, `--tk-raised`, `--tk-fill-<hue>`, `--tk-fill-<hue>-hover`, `--tk-text-<hue>`, `--tk-text-<hue>-small` in both `[data-mantine-color-scheme]` blocks of `tokyo-theme.css`.

- [ ] **Step 1: Write the failing test**

Create `packages/tokens/test/tokyo-ramp-names.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { HUES, TOKENS } from '../src/values.ts';

const css = readFileSync(join(import.meta.dirname, '..', '..', 'tokyo', 'src', 'tokyo-theme.css'), 'utf8');

function block(scheme: 'light' | 'dark'): string {
  const begin = css.indexOf(`/* BEGIN GENERATED: tokyo tokens ${scheme} */`);
  const end = css.indexOf('/* END GENERATED */', begin);
  return css.slice(begin, end);
}

describe('tokyo-theme.css carries the ramps', () => {
  it.each(['light', 'dark'] as const)('%s: numbered ramps and roles match TOKENS', scheme => {
    const b = block(scheme);
    const t = TOKENS[scheme];
    t.surfaceRamp.forEach((v, i) => expect(b).toContain(`--tk-surface-${i + 1}: ${v};`));
    t.textRamp.forEach((v, i) => expect(b).toContain(`--tk-text-${i + 1}: ${v};`));
    t.lineRamp.forEach((v, i) => expect(b).toContain(`--tk-line-${i + 1}: ${v};`));
    expect(b).toContain(`--tk-raised: ${t.surface.raised};`);
  });

  it.each(['light', 'dark'] as const)('%s: fill, hover and text names per hue', scheme => {
    const b = block(scheme);
    const t = TOKENS[scheme];
    for (const hue of HUES) {
      expect(b).toContain(`--tk-fill-${hue}: ${t.hue[hue]};`);
      expect(b).toContain(`--tk-fill-${hue}-hover: ${t.hueHover[hue]};`);
      expect(b).toContain(`--tk-text-${hue}: ${t.hueText[hue]};`);
      expect(b).toContain(`--tk-text-${hue}-small: ${t.hueTextSmall[hue]};`);
    }
  });
});
```

Run: `cd packages/tokens && bunx vitest run test/tokyo-ramp-names.test.ts`
Expected: FAIL, names absent.

- [ ] **Step 2: Emit them**

In `packages/tokens/scripts/generate.ts`, inside `renderTokyoSchemeBlock` add at the top `const t = TOKENS[scheme];` and `const at = (leaf: string, value: string) => pick(`${scheme}.${leaf}`, value);`, and add these lines to the returned array after `` `  --tk-dot-bad: ${d.dotBad};` `` and before `''`:

```ts
    `  --tk-raised: ${at('surface.raised', t.surface.raised)};`,
    ...t.surfaceRamp.map((v, i) => `  --tk-surface-${i + 1}: ${at(`surfaceRamp.${i}`, v)};`),
    ...t.textRamp.map((v, i) => `  --tk-text-${i + 1}: ${at(`textRamp.${i}`, v)};`),
    ...t.lineRamp.map((v, i) => `  --tk-line-${i + 1}: ${at(`lineRamp.${i}`, v)};`),
    ...HUES.map(h => `  --tk-fill-${h}: ${at(`hue.${h}`, t.hue[h])};`),
    ...HUES.map(h => `  --tk-fill-${h}-hover: ${at(`hueHover.${h}`, t.hueHover[h])};`),
    ...HUES.map(h => `  --tk-text-${h}: ${at(`hueText.${h}`, t.hueText[h])};`),
    ...HUES.map(h => `  --tk-text-${h}-small: ${at(`hueTextSmall.${h}`, t.hueTextSmall[h])};`),
```

Import `HUES` from `../src/values.ts`. In `buildTokyoDeclarations`, the three `dot*` entries read `t.hue.ok`, `t.hue.warn`, `t.hue.bad` (the `dot` block no longer exists).

In `packages/tokyo/src/tokyo-theme.css` line 154, change `--ui-bg-4: color-mix(in srgb, var(--tk-fg) 8%, var(--tk-card));` to `--ui-bg-4: var(--tk-raised);` and reword the comment above the `:root` block's fourth level to say level 4 is the raised ground from the tokens package rather than a wash over the card.

The hand-authored comments in `TOKYO_LIGHT_TOP_COMMENT` and `TOKYO_DARK_TOP_COMMENT` describe the old Supabase-style ramp; replace both with one sentence each: light `  /* Light surfaces: white cards on Radix slate 1 to 3 (packages/tokens/src/radix.ts); contrast rides text and borders, not surface-to-surface fill. */`, dark `  /* Dark surfaces: Radix slate 1 to 4, page darkest, cards on step 3, step 4 reserved for raised grounds. */`. `packages/tokens/test/fragment-sync.test.ts` or the tokyo test may pin the old comment text; if one does, update the pinned string to the new sentence.

- [ ] **Step 3: Waive the new `--tk-*` names**

Above `WAIVED_TOKYO` in `packages/tokens/test/consumption.test.ts` add:

```ts
const TK_RAMP_NAMES = [
  ...[1, 2, 3, 4].flatMap(i => [`--tk-surface-${i}`, `--tk-text-${i}`]),
  ...[1, 2, 3].map(i => `--tk-line-${i}`),
  ...RAMP_HUES.flatMap(h => [`--tk-fill-${h}`, `--tk-fill-${h}-hover`, `--tk-text-${h}`, `--tk-text-${h}-small`]),
];
const TK_RAMP_WAIVER =
  'ramp name mirrored from the tui theme for app-kit consumers ahead of the migration; no packages/ui component wires it yet.';
```

and make the first entries of `WAIVED_TOKYO` the spread `...Object.fromEntries(TK_RAMP_NAMES.map(name => [name, TK_RAMP_WAIVER])),`. `--tk-raised` is not waived: Step 2's `--ui-bg-4: var(--tk-raised)` references it.

- [ ] **Step 4: Regenerate everything downstream**

```bash
bun run tokens:codegen
cd packages/tokens && bunx vitest run
cd ../../ && bun run tui-kit:build
cd apps/deck && bun run build:board && cd ../..
git status --short
```
Expected: tokens tests PASS except `ramp-anchors.test.ts` (Task 4 regenerates `ramps.ts`; the old hand-written tuples no longer anchor on the new hues, and that is expected here). `git status` lists `packages/tokyo/src/tokyo-theme.css` and `apps/deck/core/generated/*` as modified.

- [ ] **Step 5: Run the freshness gate, the app suites and purity**

```bash
bun run tokens:codegen && git diff --exit-code packages/tui-kit/src/generated packages/tui-kit/assets packages/tokyo/src
bun run chat:test && bun run console:test && bun run board:test
scripts/repo-purity.sh
```
Expected: the diff gate prints nothing; app suites PASS (an app test that pins an old `--tk-*` hex is updated to read the value from `@mattstack/tokens` rather than to a new literal; list any such change in the report); purity PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/tokens packages/tokyo/src/tokyo-theme.css apps/deck/core/generated
git commit -m "tokyo: emit the Radix ramps as --tk-* names, raised as --ui-bg-4; regenerate deck's vendored board"
```

---

## Part B: Mantine tuples and pins (spec §9 step 1, MAT-421 reframed)

### Task 4: Generate tokyo's tuples and pins from the Radix scales

**Files:**
- Create: `packages/tokens/scripts/generate-ramps.ts`, `packages/tokens/src/mantine-pins.ts`
- Regenerate: `packages/tokyo/src/ramps.ts`, `packages/tokyo/src/tokyo-theme.css` (pin blocks)
- Modify: `packages/tokens/scripts/generate.ts` (pin splice), `packages/tokyo/src/theme.ts`, `packages/tokyo/src/tokyo-theme.css` (marker pairs, retired dark block), `packages/tokens/test/ramp-anchors.test.ts`, root `package.json`, `.github/workflows/ci.yml:24`, `.prettierignore`
- Test: `packages/tokens/test/generated-ramps.test.ts` (new)

**Interfaces:**
- Consumes: `RADIX`, `HUE_SCALE`, `TOKENS[scheme]` from Tasks 0 and 1.
- Produces: `packages/tokyo/src/ramps.ts` (generated) exporting `tokyoRamps` (six hue pairs `<hue>Day` / `<hue>Night` plus `grayDay` and `darkNight`), `TokyoRampName`, `ramp()`; `mantinePins(scheme): Record<string, string>` in `packages/tokens/src/mantine-pins.ts`; two generated `:root:root[data-mantine-color-scheme='<scheme>']` blocks in `tokyo-theme.css`; `primaryShade: { light: 6, dark: 3 }`. Root script `bun run tokens:ramps`.

- [ ] **Step 1: Write the failing tests**

Replace `packages/tokens/test/ramp-anchors.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { tokyoRamps } from '../../tokyo/src/ramps.ts';
import { mantinePins } from '../src/mantine-pins.ts';
import { RADIX } from '../src/radix.ts';
import { HUE_SCALE, HUES, TOKENS } from '../src/values.ts';

const css = readFileSync(join(import.meta.dirname, '..', '..', 'tokyo', 'src', 'tokyo-theme.css'), 'utf8');

function pinBlock(scheme: 'light' | 'dark'): string {
  const begin = css.indexOf(`/* BEGIN GENERATED: mantine pins ${scheme} */`);
  const end = css.indexOf('/* END GENERATED */', begin);
  if (begin === -1 || end === -1) throw new Error(`tokyo-theme.css: no mantine pins ${scheme} block`);
  return css.slice(begin, end);
}

const DAY = ['accentDay', 'okDay', 'badDay', 'warnDay', 'purpleDay', 'cyanDay'] as const;
const NIGHT = ['accentNight', 'okNight', 'badNight', 'warnNight', 'purpleNight', 'cyanNight'] as const;

describe('tokyo ramps anchor on Radix step 9', () => {
  it.each(HUES.map((h, i) => [h, DAY[i]!, NIGHT[i]!] as const))('%s', (hue, day, night) => {
    const scale = RADIX[HUE_SCALE[hue]];
    expect(tokyoRamps[day][6]).toBe(scale.light[8]);
    expect(tokyoRamps[night][3]).toBe(scale.dark[8]);
  });
});

describe('pins land every Mantine derivation on the step the tokens chose', () => {
  it.each(HUES)('%s', hue => {
    const l = TOKENS.light;
    const d = TOKENS.dark;
    const light = mantinePins('light');
    const dark = mantinePins('dark');
    expect(light[`--mantine-color-${hue}-filled`]).toBe(l.hue[hue]);
    expect(light[`--mantine-color-${hue}-filled-hover`]).toBe(l.hueHover[hue]);
    expect(light[`--mantine-color-${hue}-text`]).toBe(l.hueText[hue]);
    expect(light[`--mantine-color-${hue}-outline`]).toBe(l.hueText[hue]);
    expect(dark[`--mantine-color-${hue}-filled`]).toBe(d.hue[hue]);
    expect(dark[`--mantine-color-${hue}-filled-hover`]).toBe(d.hueHover[hue]);
    expect(dark[`--mantine-color-${hue}-text`]).toBe(d.hueText[hue]);
    expect(dark[`--mantine-color-${hue}-outline`]).toBe(d.hueText[hue]);
    expect(dark[`--mantine-color-${hue}-light`]).toBe(RADIX[HUE_SCALE[hue]].dark[2]);
    expect(dark[`--mantine-color-${hue}-light-hover`]).toBe(RADIX[HUE_SCALE[hue]].dark[3]);
  });

  it.each(['light', 'dark'] as const)('%s: every pin is in tokyo-theme.css under the doubled-root selector', scheme => {
    const begin = css.indexOf(`/* BEGIN GENERATED: mantine pins ${scheme} */`);
    const selector = `:root:root[data-mantine-color-scheme='${scheme}']`;
    const selectorAt = css.lastIndexOf(selector, begin);
    expect(selectorAt, 'selector precedes the marker').toBeGreaterThan(-1);
    expect(css.lastIndexOf('}', begin), 'no rule closes between the selector and the marker').toBeLessThan(selectorAt);
    const block = pinBlock(scheme);
    for (const [name, value] of Object.entries(mantinePins(scheme))) {
      expect(block, name).toContain(`${name}: ${value};`);
    }
  });

  it('the hand-written dark tuple remap is gone', () => {
    expect(css).not.toContain('--mantine-color-dark-7: var(--tk-bg)');
  });
});
```

Create `packages/tokens/test/generated-ramps.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { srgbLuminance } from '../src/color-math.ts';
import { tokyoRamps } from '../../tokyo/src/ramps.ts';
import { RADIX } from '../src/radix.ts';

const source = readFileSync(join(import.meta.dirname, '..', '..', 'tokyo', 'src', 'ramps.ts'), 'utf8');
const DAY_PICK = [1, 3, 4, 5, 6, 7, 9, 10, 11, 12];
const NIGHT_PICK = [12, 11, 10, 9, 8, 7, 6, 5, 4, 3];

describe('generated ramps', () => {
  it('ramps.ts is a generated file', () => {
    expect(source.startsWith('/* GENERATED by packages/tokens/scripts/generate-ramps.ts; do not edit. */')).toBe(true);
  });

  it.each(Object.entries(tokyoRamps))('%s has ten stops', (_name, stops) => {
    expect(stops).toHaveLength(10);
    for (const s of stops) expect(s).toMatch(/^#[0-9a-f]{6}$/);
  });

  it.each([
    ['accent', 'indigo'],
    ['ok', 'teal'],
    ['bad', 'crimson'],
    ['warn', 'orange'],
    ['purple', 'purple'],
    ['cyan', 'cyan'],
  ] as const)('%s tuples are the documented pick from the %s scale', (hue, scale) => {
    expect([...tokyoRamps[`${hue}Day`]]).toEqual(DAY_PICK.map(s => RADIX[scale].light[s - 1]));
    expect([...tokyoRamps[`${hue}Night`]]).toEqual(NIGHT_PICK.map(s => RADIX[scale].dark[s - 1]));
  });

  it('the day tuples darken from stop 0 to the primary stop 6', () => {
    for (const [name, stops] of Object.entries(tokyoRamps)) {
      if (!name.endsWith('Day')) continue;
      const lums = stops.slice(0, 7).map(srgbLuminance);
      for (let i = 1; i < lums.length; i++) expect(lums[i], `${name} stop ${i}`).toBeLessThan(lums[i - 1]!);
    }
  });

  it('gray and dark tuples come from slate', () => {
    expect(tokyoRamps.grayDay[4]).toBe(RADIX.slate.light[6]);
    expect(tokyoRamps.grayDay[6]).toBe(RADIX.slate.light[10]);
    expect(tokyoRamps.darkNight[4]).toBe(RADIX.slate.dark[7]);
    expect(tokyoRamps.darkNight[5]).toBe(RADIX.slate.dark[3]);
    expect(tokyoRamps.darkNight[6]).toBe(RADIX.slate.dark[2]);
    expect(tokyoRamps.darkNight[2]).toBe(RADIX.slate.dark[10]);
    expect(tokyoRamps.darkNight[7]).toBe(RADIX.slate.dark[1]);
  });
});
```

The pick is the invariant, not luminance: Radix indigo's light steps 10 and 11 rise slightly in WCAG luminance (0.1244 to 0.1251), so a whole-tuple monotonic check would fail on a correct file. Luminance is asserted only over stops 0 to 6, the tint-to-primary run Mantine's `light` and `filled` variants depend on.

Run: `cd packages/tokens && bunx vitest run test/ramp-anchors.test.ts test/generated-ramps.test.ts`
Expected: FAIL (`mantinePins` does not exist, the marker blocks are absent, and the hand-written tuples do not anchor on Radix).

- [ ] **Step 2: The generator**

Create `packages/tokens/scripts/generate-ramps.ts`:

```ts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { RADIX, type Scale12 } from '../src/radix.ts';
import { HUE_SCALE, HUES, type HueName } from '../src/values.ts';

const OUT = join(import.meta.dirname, '..', '..', 'tokyo', 'src', 'ramps.ts');

// Mantine reads tuple index 6 as the light primary and, with
// primaryShade.dark = 3 in packages/tokyo/src/theme.ts, index 3 as the dark
// primary; both picks put Radix step 9 there. Radix dark scales run darkest
// to lightest, Mantine tuples lightest to darkest, hence the reversed pick.
const DAY_PICK = [1, 3, 4, 5, 6, 7, 9, 10, 11, 12] as const;
const NIGHT_PICK = [12, 11, 10, 9, 8, 7, 6, 5, 4, 3] as const;
const GRAY_PICK = [2, 3, 4, 6, 7, 8, 11, 11, 12, 12] as const;
const DARK_PICK = [12, 11, 11, 9, 8, 4, 3, 2, 1, 1] as const;

const pick = (scale: Scale12, steps: readonly number[]) => steps.map(s => scale[s - 1]!);

function tuple(name: string, values: string[]): string {
  return [`  ${name}: [`, ...values.map(v => `    '${v}',`), '  ],'].join('\n');
}

function render(): string {
  const lines: string[] = [
    '/* GENERATED by packages/tokens/scripts/generate-ramps.ts; do not edit. */',
    "import type { MantineColorsTuple } from '@mantine/core';",
    '',
    '/**',
    ' * Radix Colors scales (packages/tokens/src/radix.ts) picked down to the ten',
    ' * shades Mantine reads: light 1 3 4 5 6 7 9 10 11 12, dark 12 11 10 9 8 7 6',
    ' * 5 4 3, so step 9 sits on the primary shade in both schemes. The pins',
    ' * that override Mantine derivations live in tokyo-theme.css (generated',
    ' * from packages/tokens/src/mantine-pins.ts). Regenerate with',
    ' * `bun run tokens:ramps`.',
    ' */',
    'export const tokyoRamps = {',
  ];
  for (const hue of HUES as readonly HueName[]) {
    const scale = RADIX[HUE_SCALE[hue]];
    lines.push(tuple(`${hue}Day`, pick(scale.light, DAY_PICK)));
    lines.push(tuple(`${hue}Night`, pick(scale.dark, NIGHT_PICK)));
  }
  lines.push(tuple('grayDay', pick(RADIX.slate.light, GRAY_PICK)));
  lines.push(tuple('darkNight', pick(RADIX.slate.dark, DARK_PICK)));
  lines.push('} as const satisfies Record<string, readonly string[]>;', '');
  lines.push('export type TokyoRampName = keyof typeof tokyoRamps;', '');
  lines.push('export const ramp = (name: TokyoRampName): MantineColorsTuple =>');
  lines.push('  tokyoRamps[name] as unknown as MantineColorsTuple;', '');
  return lines.join('\n');
}

if (import.meta.main) {
  writeFileSync(OUT, render());
}
```

Root `package.json` scripts, after `"tokens:radix"`: `"tokens:ramps": "bun run packages/tokens/scripts/generate-ramps.ts",`. Add `packages/tokyo/src/ramps.ts` to `.prettierignore` under the `radix.ts` entry with the comment `# generated by packages/tokens/scripts/generate-ramps.ts; the freshness gate byte-compares it`.

Run: `bun run tokens:ramps && cd packages/tokens && bunx vitest run test/generated-ramps.test.ts`
Expected: PASS. `ramp-anchors.test.ts` still fails here: it imports `mantine-pins.ts` and reads the pin blocks, both created in Step 3.

- [ ] **Step 3: The pins module and the CSS splice**

Create `packages/tokens/src/mantine-pins.ts`:

```ts
import { RADIX } from './radix.ts';
import { HUE_SCALE, HUES, TOKENS } from './values.ts';

// Mantine 9.5 derives text, outline, filled-hover and the dark light tint
// from fixed tuple indices (get-css-color-variables.mjs); these are the
// variables where that derivation and the tokens' step choices differ.
export function mantinePins(scheme: 'light' | 'dark'): Record<string, string> {
  const t = TOKENS[scheme];
  const out: Record<string, string> = {};
  for (const hue of HUES) {
    const scale = RADIX[HUE_SCALE[hue]][scheme];
    out[`--mantine-color-${hue}-filled`] = t.hue[hue];
    out[`--mantine-color-${hue}-filled-hover`] = t.hueHover[hue];
    out[`--mantine-color-${hue}-text`] = t.hueText[hue];
    out[`--mantine-color-${hue}-outline`] = t.hueText[hue];
    if (scheme === 'dark') {
      out[`--mantine-color-${hue}-light`] = scale[2]!;
      out[`--mantine-color-${hue}-light-hover`] = scale[3]!;
    }
  }
  return out;
}
```

Light `filled` for indigo, crimson and purple pins to the same step 9 Mantine already derives; pinning every hue keeps the block uniform and the test simple.

In `packages/tokyo/src/tokyo-theme.css`, delete the `:root[data-mantine-color-scheme='dark'] { --mantine-color-dark-0 ... }` block and the comment above it (lines 240-258; the `dark` tuple now comes from slate through the theme), delete any bare-`:root` `--mantine-color-gray-*` declaration in the file for the same reason (grep for `--mantine-color-gray-`; the `gray` tuple now carries slate), and in the dark block's place add:

```css
/*
 * Mantine derives a hue's text, outline, filled-hover and dark tint from
 * fixed tuple indices; the tokens package chooses steps by rule instead,
 * and these blocks pin the two together. Doubled `:root` for the same
 * reason as `anchor` above: Mantine re-emits colour variables from the
 * theme into its runtime style tag.
 */
:root:root[data-mantine-color-scheme='light'] {
  /* BEGIN GENERATED: mantine pins light */
  /* END GENERATED */
}
:root:root[data-mantine-color-scheme='dark'] {
  /* BEGIN GENERATED: mantine pins dark */
  /* END GENERATED */
}
```

In `packages/tokens/scripts/generate.ts`, add

```ts
import { mantinePins } from '../src/mantine-pins.ts';

function renderMantinePins(scheme: 'light' | 'dark'): string {
  return Object.entries(mantinePins(scheme))
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n');
}
```

and in `generateTokyoThemeCss`, after the two existing `spliceGenerated` calls, splice `renderMantinePins('light')` at `'/* BEGIN GENERATED: mantine pins light */'` and `renderMantinePins('dark')` at `'/* BEGIN GENERATED: mantine pins dark */'`. `spliceGenerated` already refuses a missing or duplicated marker.

In `packages/tokyo/src/theme.ts`:

- Change `primaryShade: { light: 6, dark: 4 }` to `primaryShade: { light: 6, dark: 3 }` and rewrite the comment above it to: "`primaryShade` is where the generated picks put Radix step 9 (index 6 in Day, index 3 in Night); moving either number without regenerating `ramps.ts` re-points every primary surface."
- In `colors`, add `gray: ramp('grayDay'),` and `dark: ramp('darkNight'),` after the six virtual hues. Mantine reads `gray` only in light and `dark` only in dark, so neither needs a virtual pair.

Also in `tokyo-theme.css`, move `--mantine-color-placeholder` out of the bare `:root` block (where it loses to Mantine's scheme block) into the existing `:root[data-mantine-color-scheme='light'], :root[data-mantine-color-scheme='dark']` block beside `--mantine-color-dimmed`, as `--mantine-color-placeholder: var(--tk-muted-text);`. Without it, dark placeholder text reads Mantine's `dark-3`, which is slate 9 (a fill step) at 3.10 on the input ground.

Deleting the dark remap block and moving `placeholder` off `--tk-muted` leaves `--tk-muted` and `--tk-border-soft` referenced by nothing under `packages/tokyo` or `packages/ui`; add both to `WAIVED_TOKYO` in `packages/tokens/test/consumption.test.ts` with the reasons "raw neutral fill, kept for parity with tui-kit's --muted until the step-5 audit" and "soft rule, kept for parity with tui-kit's --border-soft; no packages/ui component wires it yet".

Run: `bun run tokens:ramps && bun run tokens:codegen && cd packages/tokens && bunx vitest run`
Expected: PASS, including `ramp-anchors.test.ts` (both pin blocks present with every pin, each under its doubled-root selector) and `consumption.test.ts` (the pins reference `--mantine-*` names, which its tokyo scan does not count as `--tk-*` definitions; the two new waivers cover the names the deletions orphaned).

- [ ] **Step 4: Typecheck, test, CI gate**

Run:
```bash
bun run typecheck
cd packages/ui && bunx vitest run && cd ../..
bun run chat:test && bun run console:test && bun run board:test
cd apps/deck && bun run build:board && cd ../..
```
Expected: PASS. `packages/ui/src/design-system/colors.test.tsx` pins no colour value or `primaryShade` today; if a test elsewhere does, it is updated to read from `@mattstack/mantine-tokyo`'s `tokyoRamps`, never to a new literal. The deck rebuild most likely produces no diff (deck bundles tui-kit, not `tokyo-theme.css`); run it anyway so the freshness test is exercised.

In `.github/workflows/ci.yml` line 24, change the run line to:

```yaml
      - run: bun run tokens:radix && bun run tokens:codegen && bun run tokens:ramps && git diff --exit-code packages/tokens/src/radix.ts packages/tui-kit/src/generated packages/tui-kit/assets packages/tokyo/src
```

Run it locally. Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add package.json bun.lock .prettierignore packages/tokens packages/tokyo apps/deck/core/generated .github/workflows/ci.yml
git commit -m "tokyo: Mantine tuples and pins generated from the Radix scales (MAT-421)"
```

Tasks 0 to 4 are one PR (`radix-palette`); its description carries the spec's §3 "what repaints" paragraph and the ledger delta (nineteen entries to eight).



---

## Part D: bound tui-kit provider (spec §9 step 3)

### Task 5: `TuiKitProvider`

**Files:**
- Rename: `packages/tui-kit/src/provider.ts` to `packages/tui-kit/src/provider.tsx`
- Modify: `packages/tui-kit/src/index.ts:173-179`
- Test: `packages/tui-kit/test/provider.test.tsx`

**Interfaces:**
- Produces: `TuiKitProvider({ children }: { children: ReactNode }): JSX.Element`, exported from `@mattstack/tui-kit` and `@mattstack/tui-kit/provider`. Calling `registerTheme(tuiTheme)` at the provider module's top level is part of the contract: importing the provider registers the theme.

- [ ] **Step 1: Write the failing test**

Create `packages/tui-kit/test/provider.test.tsx`:

```tsx
import { useTheme } from "@soribashi/core";
import { expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { TuiKitProvider } from "../src/provider.tsx";
import { Button } from "../src/recipes/Button/Button.tsx";

function ThemeName() {
  return <span data-testid="theme-name">{useTheme().name}</span>;
}

test("TuiKitProvider binds tuiTheme for useTheme() without a registerTheme call at the call site", async () => {
  const screen = await render(
    <TuiKitProvider>
      <ThemeName />
      <Button intent="accent" variant="filled">
        Go
      </Button>
    </TuiKitProvider>,
  );
  await expect.element(screen.getByTestId("theme-name")).toHaveTextContent("tui-kit");
  await expect.element(screen.getByRole("button", { name: "Go" })).toBeVisible();
});
```

This file deliberately does not import `test-utils.tsx`, whose module top calls `registerTheme(tuiTheme)`; the provider under test must do that itself.

Run: `cd packages/tui-kit && bunx vitest run --project browser test/provider.test.tsx`
Expected: FAIL, `TuiKitProvider` is not exported.

- [ ] **Step 2: Implement**

`git mv packages/tui-kit/src/provider.ts packages/tui-kit/src/provider.tsx`, then replace its contents with:

```tsx
import { registerTheme, SoribashiProvider } from "@soribashi/core";
import type { ReactNode } from "react";
import { tuiTheme } from "./theme.ts";

/**
 * The kit's app-entry wiring, `@mattstack/tui-kit/provider`.
 *
 * An adopter MUST reach soribashi's provider through the kit rather than
 * importing `@soribashi/core` directly: bundlers key module identity by
 * resolved path, and an adopter's own `@soribashi/core` resolves down a
 * different path than the kit's files do, yielding two `SoribashiContext`
 * objects and a silent fallback to the DEFAULT theme. See docs/decisions.md.
 *
 * `registerTheme` runs here at module scope so that importing the provider
 * is enough for style-prop resolvers, which read the registry rather than
 * React context; `TuiKitProvider` supplies the context half.
 */
registerTheme(tuiTheme);

export function TuiKitProvider({ children }: { children: ReactNode }) {
  return <SoribashiProvider theme={tuiTheme}>{children}</SoribashiProvider>;
}

export { registerTheme, SoribashiProvider };
```

In `packages/tui-kit/src/index.ts` change the provider export line to:

```ts
export { registerTheme, SoribashiProvider, TuiKitProvider } from "./provider.tsx";
```

`package.json`'s `./provider` subpath already points at `dist/src/provider.js` / `.d.ts`; `tsc` emits the same names from a `.tsx` source.

- [ ] **Step 3: Run the test, the build and the node tier**

Run:
```bash
cd packages/tui-kit && bunx vitest run --project browser test/provider.test.tsx && bun run build && bunx vitest run --project node && bun run typecheck
```
Expected: PASS; `dist/src/provider.js` and `dist/src/provider.d.ts` exist (`ls dist/src/provider.*`). `test/no-node-builtins.test.ts` and `test/token-existence.test.ts` are unaffected.

- [ ] **Step 4: Switch the board to the bound provider**

In `apps/board/src/client/main.tsx`, replace the two imports on lines 4-5 with `import { TuiKitProvider } from '@mattstack/tui-kit/provider';`, delete the `registerTheme(tuiTheme);` call and its explanatory comment block (lines 18-28), and replace `<SoribashiProvider theme={tuiTheme}>` / `</SoribashiProvider>` with `<TuiKitProvider>` / `</TuiKitProvider>`.

Update the two docs that name the old file: `packages/tui-kit/docs/consuming.md` line 83 and `packages/tui-kit/docs/decisions.md` line 145 say `src/provider.ts`; make them `src/provider.tsx` and mention `TuiKitProvider` as the one-import path.

Deck bundles the provider from `dist` into `apps/deck/core/generated/board.js`, and `apps/deck/core/generated-fresh.test.ts` byte-compares that file against a live rebuild in CI, so regenerate it here.

Run: `bun run tui-kit:build && bun run board:typecheck && bun run board:test && bun run board:build && cd apps/deck && bun run build:board && cd ../..`
Expected: PASS; `git status` shows `apps/deck/core/generated/board.js` modified.

- [ ] **Step 5: Commit**

```bash
git add -A packages/tui-kit/src packages/tui-kit/test/provider.test.tsx packages/tui-kit/docs apps/board/src/client/main.tsx apps/deck/core/generated
git commit -m "tui-kit: TuiKitProvider registers and provides the theme in one import"
```

---

## Part E: tokens storybook, MAT-419 (spec §9 step 4)

### Task 6: Storybook wiring for both kits

**Files:**
- Modify: `.storybook/main.ts:4-9`, `.storybook/preview.tsx`
- Modify: root `package.json` (devDependencies, `lint` script), `tsconfig.tools.json` (`include`)
- Modify: `packages/tokens/package.json` (`exports`)
- Create: `stories/README.md`

**Interfaces:**
- Produces: story globs `../stories/**/*.stories.@(ts|tsx)`; a decorator that sets the Mantine colour scheme AND toggles `dark` on `<html>` so tui-kit's `light-dark()` follows the same toolbar; `@mattstack/tokens/color-math` export for render-time contrast.

- [ ] **Step 1: Dependencies and config**

Root `package.json` devDependencies: add `"@mattstack/tui-kit": "workspace:*"` and `"@mattstack/tokens": "workspace:*"` next to `"@mattstack/app-kit": "workspace:*"`. Change the `lint` script to `eslint --no-error-on-unmatched-pattern packages .storybook stories`.

`packages/tokens/package.json` exports:

```json
  "exports": {
    ".": "./src/values.ts",
    "./color-math": "./src/color-math.ts"
  },
```

`tsconfig.tools.json` include: `[".storybook/**/*.ts", ".storybook/**/*.tsx", "stories/**/*.ts", "stories/**/*.tsx", "vitest.config.ts"]`.

Run: `bun install` (root). Expected: root `bun.lock` updated; no member lockfile.

- [ ] **Step 2: Story globs**

`.storybook/main.ts` `stories` array becomes:

```ts
  stories: [
    '../stories/**/*.mdx',
    '../stories/**/*.stories.@(ts|tsx)',
    '../packages/ui/src/**/*.mdx',
    '../packages/ui/src/**/*.stories.@(js|jsx|mjs|ts|tsx)',
    '../apps/console/src/**/*.stories.@(ts|tsx)',
    '../apps/board/src/**/*.stories.@(ts|tsx)',
  ],
```

- [ ] **Step 3: The decorator**

Replace `.storybook/preview.tsx` with:

```tsx
import '@mattstack/app-kit/styles.css';
import '@mattstack/tui-kit/theme.css';

import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import type { Preview } from '@storybook/react-vite';
import { useEffect } from 'react';

import { theme } from '@mattstack/app-kit/design-system';
import { TuiKitProvider } from '@mattstack/tui-kit/provider';

// tui-kit's tokens are light-dark() declarations flipped by `.dark` on the
// root; Mantine reads forceColorScheme. One toolbar drives both.
function SchemeSync({ scheme }: { scheme: 'light' | 'dark' }) {
  useEffect(() => {
    document.documentElement.classList.toggle('dark', scheme === 'dark');
  }, [scheme]);
  return null;
}

const preview: Preview = {
  globalTypes: {
    scheme: {
      description: 'Color scheme',
      toolbar: {
        title: 'Scheme',
        icon: 'mirror',
        items: ['light', 'dark'],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { scheme: 'light' },
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },

    a11y: {
      // 'todo' - show a11y violations in the test UI only
      // 'error' - fail CI on a11y violations
      // 'off' - skip a11y checks entirely
      test: 'todo',
    },
  },

  decorators: [
    (Story, context) => {
      const scheme = context.globals.scheme === 'dark' ? 'dark' : 'light';
      return (
        <MantineProvider theme={theme} forceColorScheme={scheme}>
          <TuiKitProvider>
            <SchemeSync scheme={scheme} />
            <ModalsProvider>
              <Story />
              <Notifications />
            </ModalsProvider>
          </TuiKitProvider>
        </MantineProvider>
      );
    },
  ],
};

export default preview;
```

- [ ] **Step 4: A README for the stories root and a smoke check**

Create `stories/README.md`:

```md
# Stories

Root-level stories that span packages. `ramps/` is the tokens reference
catalogue: it renders `packages/tokens` values directly, both schemes side
by side, with contrast computed at render time. `specimens/` renders real
tui-kit and app-kit components on the emitted tokens and fails the a11y
addon on any violation; use the Scheme toolbar to switch.

`bun run tui-kit:build` must run before `bun run storybook` or
`bun run build-storybook`; the provider import resolves to `dist/`.
```

Run: `bun run tui-kit:build && bun run build-storybook && bunx tsc -p tsconfig.tools.json && bun run lint`
Expected: the build finishes with the existing stories; typecheck and lint clean.

- [ ] **Step 5: Commit**

```bash
git add .storybook package.json bun.lock tsconfig.tools.json packages/tokens/package.json stories/README.md
git commit -m "storybook: root stories glob, tui-kit provider and scheme sync in the decorator"
```

### Task 7: Reference catalogue stories

**Files:**
- Create: `stories/ramps/catalogue.tsx` (shared pieces), `stories/ramps/Surfaces.stories.tsx`, `stories/ramps/Text.stories.tsx`, `stories/ramps/Lines.stories.tsx`, `stories/ramps/Palette.stories.tsx`, `stories/ramps/Type.stories.tsx`

**Interfaces:**
- Consumes: `TOKENS`, `HUES` from `@mattstack/tokens`; `contrastRatio` from `@mattstack/tokens/color-math`.
- Produces: `Swatch`, `SchemeColumn`, `Ratio` components in `catalogue.tsx`.

Every story here renders BOTH schemes from `TOKENS` literals, so it does not depend on the toolbar, and every number on screen is computed from the same values the tests assert.

- [ ] **Step 1: Shared pieces**

Create `stories/ramps/catalogue.tsx`:

```tsx
import type { CSSProperties, ReactNode } from 'react';

import { contrastRatio } from '@mattstack/tokens/color-math';
import { TOKENS, type ColorScheme } from '@mattstack/tokens';

export type SchemeName = 'light' | 'dark';
export const SCHEMES: readonly SchemeName[] = ['light', 'dark'];

export function scheme(name: SchemeName): ColorScheme {
  return TOKENS[name];
}

export function Ratio({ fg, bg, bar }: { fg: string; bg: string; bar?: number }) {
  const ratio = contrastRatio(fg, bg);
  const ok = bar === undefined || ratio >= bar;
  return (
    <span style={{ fontVariantNumeric: 'tabular-nums', color: ok ? 'inherit' : '#de004e' }}>
      {ratio.toFixed(2)}
      {bar !== undefined ? ` / ${bar.toFixed(1)}` : ''}
    </span>
  );
}

export function Swatch({
  hex,
  label,
  textOn,
  children,
  style,
}: {
  hex: string;
  label: string;
  textOn: string;
  children?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        background: hex,
        color: textOn,
        padding: 12,
        borderRadius: 6,
        fontFamily: TOKENS.font.sans,
        fontSize: 13,
        display: 'grid',
        gap: 4,
        ...style,
      }}
    >
      <strong>{label}</strong>
      <code>{hex}</code>
      {children}
    </div>
  );
}

export function SchemeColumn({ name, children }: { name: SchemeName; children: ReactNode }) {
  const t = scheme(name);
  return (
    <section
      style={{
        background: t.surface.bg,
        color: t.text.fg,
        padding: 20,
        borderRadius: 10,
        display: 'grid',
        gap: 12,
        alignContent: 'start',
        fontFamily: TOKENS.font.sans,
      }}
    >
      <h3 style={{ margin: 0, fontSize: 14, letterSpacing: 1, textTransform: 'uppercase' }}>{name}</h3>
      {children}
    </section>
  );
}

export function TwoSchemes({ render }: { render: (name: SchemeName) => ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
      {SCHEMES.map(name => (
        <SchemeColumn key={name} name={name}>
          {render(name)}
        </SchemeColumn>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Surfaces**

Create `stories/ramps/Surfaces.stories.tsx`:

```tsx
import type { Meta, StoryObj } from '@storybook/react-vite';

import { Ratio, scheme, Swatch, TwoSchemes } from './catalogue';

const ROLES = ['card', 'panel', 'page', 'chrome', 'inset', 'overlay'] as const;

function Surfaces() {
  return (
    <TwoSchemes
      render={name => {
        const t = scheme(name);
        return (
          <>
            {t.surfaceRamp.map((hex, i) => (
              <Swatch key={hex} hex={hex} label={`surface-${i + 1}`} textOn={t.text.fg}>
                <span>
                  text-1 on it: <Ratio fg={t.text.fg} bg={hex} />
                </span>
                <span>
                  roles: {ROLES.filter(r => t.surfaceRole[r] === i + 1).join(', ') || 'none'}
                </span>
              </Swatch>
            ))}
          </>
        );
      }}
    />
  );
}

const meta = {
  title: 'Tokens/Surfaces',
  component: Surfaces,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Surfaces>;

export default meta;

export const Ramp: StoryObj<typeof meta> = {};
```

- [ ] **Step 3: Text**

Create `stories/ramps/Text.stories.tsx`:

```tsx
import type { Meta, StoryObj } from '@storybook/react-vite';

import { Ratio, scheme, TwoSchemes } from './catalogue';

const BAR = [7.0, 4.5, 5.2, 7.0] as const;
const SERVES = ['every size', 'display, title, body', 'meta', 'small, micro'] as const;
const SIZE = [15, 14.45, 13.26, 11.9] as const;

function TextRamp() {
  return (
    <TwoSchemes
      render={name => {
        const t = scheme(name);
        return (
          <>
            {t.surfaceRamp.map((surface, s) => (
              <div key={surface} style={{ background: surface, padding: 12, borderRadius: 6, display: 'grid', gap: 6 }}>
                <code style={{ color: t.text.fg }}>surface-{s + 1}</code>
                {t.textRamp.map((hex, i) => (
                  <div key={hex} style={{ color: hex, fontSize: SIZE[i], display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <span>
                      text-{i + 1} {hex} for {SERVES[i]}
                    </span>
                    <Ratio fg={hex} bg={surface} bar={BAR[i]} />
                  </div>
                ))}
              </div>
            ))}
          </>
        );
      }}
    />
  );
}

const meta = {
  title: 'Tokens/Text',
  component: TextRamp,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof TextRamp>;

export default meta;

export const Ramp: StoryObj<typeof meta> = {};
```

- [ ] **Step 4: Lines**

Create `stories/ramps/Lines.stories.tsx`:

```tsx
import type { Meta, StoryObj } from '@storybook/react-vite';

import { Ratio, scheme, TwoSchemes } from './catalogue';

const ROLES = ['border', 'soft', 'control', 'edgeOnCard', 'softOnCard'] as const;

function Lines() {
  return (
    <TwoSchemes
      render={name => {
        const t = scheme(name);
        const ground = name === 'light' ? t.surfaceRamp[0] : t.surface.card;
        return (
          <>
            {t.lineRamp.map((hex, i) => (
              <div key={i} style={{ background: ground, padding: 12, borderRadius: 6, border: `1px solid ${hex}`, display: 'grid', gap: 4 }}>
                <span>
                  line-{i + 1} <code>{hex}</code>
                </span>
                <span>
                  against {name === 'light' ? 'surface-1' : 'card'}: <Ratio fg={hex} bg={ground} />
                </span>
                <span>roles: {ROLES.filter(r => t.lineRole[r] === i + 1).join(', ') || 'none'}</span>
              </div>
            ))}
          </>
        );
      }}
    />
  );
}

const meta = {
  title: 'Tokens/Lines',
  component: Lines,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Lines>;

export default meta;

export const Ramp: StoryObj<typeof meta> = {};
```

- [ ] **Step 5: Palette**

Create `stories/ramps/Palette.stories.tsx`:

```tsx
import type { Meta, StoryObj } from '@storybook/react-vite';

import { HUE_SCALE, HUES } from '@mattstack/tokens';
import { RADIX } from '@mattstack/tokens/radix';

import { Ratio, scheme, TwoSchemes } from './catalogue';

function Palette() {
  return (
    <TwoSchemes
      render={name => {
        const t = scheme(name);
        const worstSurface = t.surfaceRamp[3];
        return (
          <>
            {HUES.map(hue => {
              const steps = RADIX[HUE_SCALE[hue]][name];
              const { fill, text } = t.hueStep[hue];
              return (
                <div key={hue} style={{ display: 'grid', gap: 6 }}>
                  <code>
                    {hue} ({HUE_SCALE[hue]}): fill {fill}, text {text}, small 12
                  </code>
                  <div style={{ display: 'flex', gap: 3 }}>
                    {steps.map((hex, i) => {
                      const step = i + 1;
                      const chosen = step === fill || step === text || step === 12;
                      return (
                        <div key={hex} style={{ display: 'grid', gap: 2, justifyItems: 'center' }}>
                          <div style={{ width: 40, height: chosen ? 40 : 28, background: hex, borderRadius: 3, outline: chosen ? `2px solid ${t.text.fg}` : 'none' }} />
                          <span style={{ fontSize: 10 }}>{step}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ display: 'flex', gap: 16, fontSize: 12 }}>
                    <span>
                      fill {t.hue[hue]} <Ratio fg={t.hue[hue]} bg={worstSurface} bar={3.0} />
                    </span>
                    <span style={{ color: t.hueText[hue] }}>
                      text {t.hueText[hue]} <Ratio fg={t.hueText[hue]} bg={worstSurface} bar={4.5} />
                    </span>
                    <span style={{ color: t.hueTextSmall[hue], fontSize: 11.9 }}>
                      small {t.hueTextSmall[hue]} <Ratio fg={t.hueTextSmall[hue]} bg={worstSurface} bar={7.0} />
                    </span>
                  </div>
                </div>
              );
            })}
          </>
        );
      }}
    />
  );
}

const meta = {
  title: 'Tokens/Palette',
  component: Palette,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Palette>;

export default meta;

export const RadixSteps: StoryObj<typeof meta> = {};
```

`@mattstack/tokens/radix` needs an export in `packages/tokens/package.json`: add `"./radix": "./src/radix.ts"` beside `"./color-math"`. The three fills the spec ledgers (light warn, dark accent, dark purple) render their ratio in red here on purpose; the story is the visible ledger.

- [ ] **Step 6: Type**

Create `stories/ramps/Type.stories.tsx`:

```tsx
import type { Meta, StoryObj } from '@storybook/react-vite';

const STEPS = [
  { name: 'display', px: 17, weight: 700, line: 1.25, bar: 4.5, token: '--text-2' },
  { name: 'title', px: 15.3, weight: 600, line: 1.3, bar: 4.5, token: '--text-2' },
  { name: 'body', px: 14.45, weight: 400, line: 1.5, bar: 4.5, token: '--text-2' },
  { name: 'meta', px: 13.26, weight: 400, line: 1.45, bar: 5.5, token: '--text-3' },
  { name: 'small', px: 11.9, weight: 400, line: 1.4, bar: 7.0, token: '--text-4' },
  { name: 'micro', px: 10.54, weight: 500, line: 1.35, bar: 7.0, token: '--text-4' },
] as const;

function TypeRamp() {
  return (
    <div style={{ background: 'var(--card)', color: 'var(--fg)', padding: 20, display: 'grid', gap: 10, fontFamily: 'var(--font-sans)' }}>
      {STEPS.map(s => (
        <div key={s.name} style={{ display: 'grid', gridTemplateColumns: '90px 1fr 1fr', gap: 16, alignItems: 'baseline' }}>
          <code style={{ fontSize: 12 }}>{s.name}</code>
          <span style={{ fontSize: `var(--type-${s.name})`, fontWeight: s.weight, lineHeight: s.line }}>
            The quick brown fox at {s.px}px
          </span>
          <span style={{ fontSize: `var(--type-${s.name})`, fontWeight: s.weight, lineHeight: s.line, color: `var(${s.token})` }}>
            secondary text takes {s.token} ({s.bar}:1)
          </span>
        </div>
      ))}
    </div>
  );
}

const meta = {
  title: 'Tokens/Type',
  component: TypeRamp,
  parameters: { layout: 'padded', a11y: { test: 'error' } },
} satisfies Meta<typeof TypeRamp>;

export default meta;

export const Steps: StoryObj<typeof meta> = {};
```

This one reads the emitted `--type-*` and `--text-N` names, so it follows the toolbar, and it is the first story with `a11y.test = 'error'`.

- [ ] **Step 7: Build and look**

Run: `bun run tui-kit:build && bunx tsc -p tsconfig.tools.json && bun run lint && bun run build-storybook`
Expected: clean. Then `bun run storybook` and open `Tokens/Palette`; the three fill ratios in red are exactly light `warn`, dark `accent` and dark `purple`, and nothing else is red. Take a screenshot of each story in each scheme and attach the paths to the task report.

- [ ] **Step 8: Commit**

```bash
git add stories/ramps
git commit -m "storybook: tokens reference catalogue (surfaces, text, lines, palette, type)"
```

### Task 8: Specimen wall for both kits

**Files:**
- Create: `stories/specimens/TuiKit.stories.tsx`, `stories/specimens/AppKit.stories.tsx`

**Interfaces:**
- Consumes: `Button`, `Chip`, `Badge` from `@mattstack/tui-kit` (check `packages/tui-kit/src/index.ts` for the exact export names before writing; `Button` is `export { Button } from "./recipes/Button/Button.tsx"`); `Button`, `Text`, `Badge` from `@mattstack/app-kit/core`.

- [ ] **Step 1: tui-kit specimens**

Create `stories/specimens/TuiKit.stories.tsx`:

```tsx
import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from '@mattstack/tui-kit';

const INTENTS = ['accent', 'ok', 'warn', 'bad', 'cyan', 'purple', 'muted'] as const;
const VARIANTS = ['default', 'filled', 'light', 'outline', 'subtle'] as const;
const SURFACES = ['--surface-1', '--surface-2', '--surface-3', '--surface-4'] as const;

function ButtonWall() {
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {SURFACES.map(surface => (
        <div key={surface} style={{ background: `var(${surface})`, padding: 16, borderRadius: 8, display: 'grid', gap: 8 }}>
          <code style={{ color: 'var(--text-3)', fontSize: 12 }}>{surface}</code>
          {VARIANTS.map(variant => (
            <div key={variant} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {INTENTS.map(intent => (
                <Button key={intent} intent={intent} variant={variant}>
                  {intent}
                </Button>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function TextWall() {
  const texts = ['--text-1', '--text-2', '--text-3', '--text-4'] as const;
  const sizes = { '--text-1': 14.45, '--text-2': 14.45, '--text-3': 13.26, '--text-4': 11.9 } as const;
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {SURFACES.map(surface => (
        <div key={surface} style={{ background: `var(${surface})`, padding: 16, borderRadius: 8, display: 'grid', gap: 6, fontFamily: 'var(--font-sans)' }}>
          {texts.map(text => (
            <p key={text} style={{ margin: 0, color: `var(${text})`, fontSize: sizes[text] }}>
              {text} on {surface}: Inventory counts pause on Friday; items on loan keep their due dates.
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}

const meta = {
  title: 'Specimens/tui-kit',
  parameters: { layout: 'padded', a11y: { test: 'error' } },
} satisfies Meta;

export default meta;

export const Buttons: StoryObj = { render: () => <ButtonWall /> };
export const Text: StoryObj = { render: () => <TextWall /> };
```

- [ ] **Step 2: app-kit specimens**

Create `stories/specimens/AppKit.stories.tsx`:

```tsx
import type { Meta, StoryObj } from '@storybook/react-vite';

import { Badge, Button, Group, Stack, Text } from '@mattstack/app-kit/core';

const COLORS = ['accent', 'ok', 'warn', 'bad', 'cyan', 'purple'] as const;
const VARIANTS = ['filled', 'light', 'outline', 'subtle'] as const;
const GROUNDS = ['--ui-bg-1', '--ui-bg-2', '--ui-bg-3', '--ui-bg-4'] as const;

function ButtonWall() {
  return (
    <Stack gap="md">
      {GROUNDS.map(ground => (
        <Stack key={ground} gap="xs" p="md" style={{ background: `var(${ground})`, borderRadius: 8 }}>
          <Text size="xs" c="dimmed">
            {ground}
          </Text>
          {VARIANTS.map(variant => (
            <Group key={variant} gap="xs">
              {COLORS.map(color => (
                <Button key={color} color={color} variant={variant}>
                  {color}
                </Button>
              ))}
            </Group>
          ))}
          <Group gap="xs">
            {COLORS.map(color => (
              <Badge key={color} color={color}>
                {color}
              </Badge>
            ))}
          </Group>
        </Stack>
      ))}
    </Stack>
  );
}

function TextWall() {
  return (
    <Stack gap="md">
      {GROUNDS.map(ground => (
        <Stack key={ground} gap={4} p="md" style={{ background: `var(${ground})`, borderRadius: 8 }}>
          <Text>Default text on {ground}: inventory counts pause on Friday.</Text>
          <Text c="dimmed">Dimmed text on {ground}: items on loan keep their due dates.</Text>
          <Text size="xs" c="dimmed">
            Small dimmed text on {ground}: returns reopen Monday.
          </Text>
        </Stack>
      ))}
    </Stack>
  );
}

const meta = {
  title: 'Specimens/app-kit',
  parameters: { layout: 'padded', a11y: { test: 'error' } },
} satisfies Meta;

export default meta;

export const Buttons: StoryObj = { render: () => <ButtonWall /> };
export const TextRoles: StoryObj = { render: () => <TextWall /> };
```

The `style` props on `Stack` are the ground for each row, not app styling, and `stories/` is outside the preset's `app` globs, so `local/no-inline-styles` does not fire here. If `@mattstack/app-kit/core` does not export `Group` or `Stack`, import those two from `@mantine/core` and add an `eslint-disable-next-line no-restricted-imports` with the reason "story ground, not app code".

- [ ] **Step 3: Build, run the a11y addon, look**

Run: `bunx tsc -p tsconfig.tools.json && bun run lint && bun run build-storybook`
Expected: clean. Then `bun run storybook`, open each specimen story in both schemes and read the a11y panel: with `test: 'error'` a colour-contrast violation is listed as a failure. Light `filled` buttons for `ok`, `warn`, `cyan` and the light `light`/`outline`/`subtle` cells the Button ledger names are expected failures today (they are the ledgered debt); dark must show none. Record what the panel shows per story and scheme in the task report; do not change any token or component in this task.

- [ ] **Step 4: Commit**

```bash
git add stories/specimens
git commit -m "storybook: specimen walls for tui-kit and app-kit with a11y set to error"
```

---

## Part F: contrast gate (spec §9 step 5)

### Task 9: Ramp contrast matrix with a fill ledger

**Files:**
- Modify: `packages/tui-kit/src/a11y/known-contrast-debt.ts`
- Create: `packages/tui-kit/test/ramps.matrix.test.tsx`

**Interfaces:**
- Produces: `FillContrastDebtEntry { hue: string; scheme: ContrastScheme; measuredRatio: number; reason: string }`, `KNOWN_FILL_DEBT`, `fillDebtKey({ hue, scheme })`, `FILL_DEBT_BY_KEY`. The Button entry shape is untouched.

The gate renders every text step on every surface and every hue text token on every surface, in both schemes, and asserts the bar for that token; then every fill on every surface at 3.0, ratcheted against the fill ledger. It runs in the browser project, which CI already runs, so it measures the emitted `light-dark()` values as Chromium resolves them.

- [ ] **Step 1: Widen the ledger**

Append to `packages/tui-kit/src/a11y/known-contrast-debt.ts`:

```ts
/**
 * Fill-against-surface cells under the 3:1 non-text bar. Same ratchet as
 * the Button ledger above: an entry may be removed or improved, never
 * worsened, and never added to admit a new below-floor fill.
 */
export interface FillContrastDebtEntry {
  hue: string;
  scheme: ContrastScheme;
  measuredRatio: number;
  reason: string;
}

export const KNOWN_FILL_DEBT: readonly FillContrastDebtEntry[] = [
  {
    hue: "warn",
    scheme: "light",
    measuredRatio: 2.93,
    reason: "orange 10 on the light row surface; 11 reads brown, so the fill stays at 10 and a warn fill alone must not carry meaning on rows",
  },
  {
    hue: "accent",
    scheme: "dark",
    measuredRatio: 2.77,
    reason: "indigo 9 against the dark raised ground; 10 would drop the white label under 4.5, so Radix's step 9 wins",
  },
  {
    hue: "purple",
    scheme: "dark",
    measuredRatio: 2.79,
    reason: "purple 9 against the dark raised ground; 10 would drop the white label under 4.5, so Radix's step 9 wins",
  },
  {
    hue: "line-1",
    scheme: "dark",
    measuredRatio: 2.82,
    reason: "slate 9 control edge against the dark raised ground; clears 3.0 on page, panels and cards",
  },
];

export function fillDebtKey(entry: Pick<FillContrastDebtEntry, "hue" | "scheme">): string {
  return `${entry.scheme}|${entry.hue}`;
}

export const FILL_DEBT_BY_KEY: ReadonlyMap<string, FillContrastDebtEntry> = new Map(
  KNOWN_FILL_DEBT.map((entry) => [fillDebtKey(entry), entry]),
);
```

- [ ] **Step 2: Write the matrix**

Create `packages/tui-kit/test/ramps.matrix.test.tsx`:

```tsx
import {
  contrastRatio,
  installNoTransitionStyle,
  NO_TRANSITION_CLASS,
  resolveCanvasColor,
  toRgbString,
} from "@soribashi/core/testing";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { render } from "vitest-browser-react/pure";
import { FILL_DEBT_BY_KEY, fillDebtKey } from "../src/a11y/known-contrast-debt.ts";
import { TuiKitProvider } from "../src/provider.tsx";

const SURFACES = [1, 2, 3, 4] as const;
const TEXT_BAR: Record<number, number> = { 1: 7.0, 2: 4.5, 3: 5.2, 4: 7.0 };
const HUES = ["accent", "ok", "bad", "warn", "purple", "cyan"] as const;
const SCHEMES = ["light", "dark"] as const;
const FILL_BAR = 3.0;

function id(kind: string, a: string | number, b: string | number) {
  return `ramp-${kind}-${a}-on-${b}`;
}

describe("ramp contrast matrix (text steps, hue text and fills against every surface, both schemes)", () => {
  let container: HTMLDivElement;
  let removeNoTransitionStyle: () => void;

  beforeAll(async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    removeNoTransitionStyle = installNoTransitionStyle();
    container.classList.add(NO_TRANSITION_CLASS);

    await render(
      <TuiKitProvider>
        {SURFACES.map((s) => (
          <div key={s} data-testid={id("surface", s, "root")} style={{ background: `var(--surface-${s})`, padding: 8 }}>
            {SURFACES.map((t) => (
              <span key={t} data-testid={id("text", t, s)} style={{ color: `var(--text-${t})` }}>
                text
              </span>
            ))}
            {HUES.map((h) => (
              <span key={h} data-testid={id("hue", h, s)} style={{ color: `var(--text-${h})` }}>
                text
              </span>
            ))}
            {HUES.map((h) => (
              <span key={`${h}-small`} data-testid={id("hue-small", h, s)} style={{ color: `var(--text-${h}-small)` }}>
                text
              </span>
            ))}
            {HUES.map((h) => (
              <span key={`${h}-fill`} data-testid={id("fill", h, s)} style={{ background: `var(--fill-${h})`, display: "inline-block", width: 12, height: 12 }} />
            ))}
            <span data-testid={id("fill", "line-1", s)} style={{ background: "var(--line-1)", display: "inline-block", width: 12, height: 12 }} />
          </div>
        ))}
      </TuiKitProvider>,
      { container },
    );
  });

  afterAll(() => {
    container.remove();
    removeNoTransitionStyle();
  });

  function el(testId: string): HTMLElement {
    const node = container.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
    if (!node) throw new Error(`ramp matrix: nothing rendered for "${testId}"`);
    return node;
  }

  function textRatio(testId: string, surface: number): number {
    const fg = toRgbString(getComputedStyle(el(testId)).color);
    const bg = toRgbString(getComputedStyle(el(id("surface", surface, "root"))).backgroundColor);
    return contrastRatio(fg, bg, resolveCanvasColor(container));
  }

  function fillRatio(hue: string, surface: number): number {
    const fill = toRgbString(getComputedStyle(el(id("fill", hue, surface))).backgroundColor);
    const bg = toRgbString(getComputedStyle(el(id("surface", surface, "root"))).backgroundColor);
    return contrastRatio(fill, bg);
  }

  function assertScheme(scheme: (typeof SCHEMES)[number]) {
    for (const s of SURFACES) {
      for (const t of SURFACES) {
        const ratio = textRatio(id("text", t, s), s);
        expect(ratio, `${scheme} text-${t} on surface-${s} ratio=${ratio.toFixed(3)}`).toBeGreaterThanOrEqual(TEXT_BAR[t]!);
      }
      {
        const line = fillRatio("line-1", s);
        const label = `${scheme} line-1 on surface-${s} ratio=${line.toFixed(3)}`;
        const debt = FILL_DEBT_BY_KEY.get(fillDebtKey({ hue: "line-1", scheme }));
        if (debt && s === 4) {
          expect(line, `${label} regressed below its known-contrast-debt.ts floor`).toBeGreaterThanOrEqual(debt.measuredRatio - 0.05);
          expect(line, `${label} cleared ${FILL_BAR}; remove its entry`).toBeLessThan(FILL_BAR);
        } else if (scheme === "dark") {
          expect(line, label).toBeGreaterThanOrEqual(FILL_BAR);
        }
      }
      for (const h of HUES) {
        const body = textRatio(id("hue", h, s), s);
        expect(body, `${scheme} text-${h} on surface-${s} ratio=${body.toFixed(3)}`).toBeGreaterThanOrEqual(4.5);
        const small = textRatio(id("hue-small", h, s), s);
        expect(small, `${scheme} text-${h}-small on surface-${s} ratio=${small.toFixed(3)}`).toBeGreaterThanOrEqual(7.0);

        const fill = fillRatio(h, s);
        const label = `${scheme} fill-${h} on surface-${s} ratio=${fill.toFixed(3)}`;
        const debt = FILL_DEBT_BY_KEY.get(fillDebtKey({ hue: h, scheme }));
        if (debt) {
          expect(fill, `${label} regressed below its known-contrast-debt.ts floor (${debt.measuredRatio} - 0.05)`).toBeGreaterThanOrEqual(debt.measuredRatio - 0.05);
          if (s === 4) {
            expect(fill, `${label} cleared ${FILL_BAR}; remove this fill's entry from known-contrast-debt.ts`).toBeLessThan(FILL_BAR);
          }
        } else {
          expect(fill, label).toBeGreaterThanOrEqual(FILL_BAR);
        }
      }
    }
  }

  describe("light scheme", () => {
    test("every cell clears its bar or matches its ledger entry", () => assertScheme("light"));
  });

  describe("dark scheme", () => {
    beforeAll(() => {
      container.classList.add("dark");
      void container.offsetHeight;
    });
    afterAll(() => {
      container.classList.remove("dark");
    });
    test("every cell clears its bar or matches its ledger entry", () => assertScheme("dark"));
  });
});
```

The ledger's `measuredRatio` is the worst surface, `surface-4` in both schemes (light slate 3, dark slate 4), so the "cleared the bar, remove the entry" check runs only on that surface; the floor check runs on all four. `line-1` is measured like a fill in dark only: it must clear 3.0 on surfaces 1 to 3 and matches its ledger entry on `surface-4`; every light line is under 3.0 by design (the spec's ledgered light control edge), so light lines are not asserted here. `--muted` is not in the matrix until the step-5 audit.

- [ ] **Step 3: Run it**

Run: `cd packages/tui-kit && bun run build && bunx vitest run --project browser test/ramps.matrix.test.tsx`
Expected: PASS in both schemes. A failure names the exact cell and its measured ratio. Because every value is solved to the first hex clearing its bar, a cell can fail by a few thousandths if Chromium's `light-dark()` resolution or `toRgbString` rounds differently from the tokens package's math; if that happens, print the failing cell's `fg` and `bg` strings, confirm the hex Chromium painted equals the token, and report it rather than nudging a token. Do not lower a bar.

- [ ] **Step 4: Confirm the file is in CI's include set and commit**

`vitest.browser.config.ts` includes `test/**/*.test.tsx`, and CI runs `--project browser` with only visual and parity files excluded, so nothing to wire.

```bash
git add packages/tui-kit/src/a11y/known-contrast-debt.ts packages/tui-kit/test/ramps.matrix.test.tsx
git commit -m "tui-kit: ramp contrast matrix gate with a ratcheted fill ledger"
```

---

## Part G: namespace lint, MAT-420 (spec §9 step 6)

### Task 10: Classifier and the TSX rule

**Files:**
- Create: `packages/ui/presets/eslint-local/token-namespaces.js` (classifier) and `token-namespaces.d.ts`, `packages/ui/presets/eslint-local/token-namespaces-tsx.js` (rule) and `token-namespaces-tsx.d.ts`
- Test: `packages/ui/presets/eslint-local/token-namespaces.test.ts`
- Modify: `packages/ui/vitest.config.ts` (`include`), `packages/ui/presets/eslint.js`

`packages/ui/tsconfig.json` compiles `presets`, so the `.ts` test's imports of `.js` rule files need declaration files beside them (the `presets/vite.d.ts` convention); without them `bun run typecheck` fails with TS7016.

**Interfaces:**
- Produces: `classifyTokenUse(property: string, varName: string): string | null` returning a message when the pair is a violation, else `null`; `tokenNamespacesTsx` ESLint rule reporting `local/token-namespaces` on string-valued style object properties.

Rules, from the spec:

| var prefix | allowed properties | never |
| --- | --- | --- |
| `--text-*` | `color` | |
| `--fill-*` | anything but `color` | `color` |
| `--surface-*` | `background`, `background-color`, `background-image`, `fill` | `--surface-[1-4]` anywhere |
| `--border`, `--border-*` | properties starting `border` or `outline`, and `scrollbar-color` | |
| `--line-[1-3]` | | anywhere |

`--line-height-*` is soribashi's line-height scale, not a line token; only the exact numeric ramp steps `--line-1..3` are checked.

A property that is itself a custom property (`--gate-muted: var(--text-muted-on-card)`) is an alias and is never checked; the alias's use site is.

- [ ] **Step 1: Write the failing classifier tests**

Add `'presets/**/*.test.ts'` to `include` in `packages/ui/vitest.config.ts`. Create `packages/ui/presets/eslint-local/token-namespaces.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { classifyTokenUse } from './token-namespaces.js';

describe('classifyTokenUse', () => {
  it('lets text tokens colour text', () => {
    expect(classifyTokenUse('color', '--text-3')).toBeNull();
    expect(classifyTokenUse('color', '--text-ok-small')).toBeNull();
  });

  it('rejects text tokens as backgrounds and fills as text', () => {
    expect(classifyTokenUse('background', '--text-3')).toMatch(/--text-\* is for color/);
    expect(classifyTokenUse('color', '--fill-warn')).toMatch(/--fill-\* is never a text colour/);
  });

  it('lets surfaces be backgrounds and fills, nothing else', () => {
    expect(classifyTokenUse('background', '--surface-card')).toBeNull();
    expect(classifyTokenUse('background-color', '--surface-wash-fg-8')).toBeNull();
    expect(classifyTokenUse('fill', '--surface-panel')).toBeNull();
    expect(classifyTokenUse('color', '--surface-card')).toMatch(/--surface-\* is for background/);
    expect(classifyTokenUse('border-color', '--surface-card')).toMatch(/--surface-\* is for background/);
  });

  it('rejects the numeric ramp steps everywhere', () => {
    expect(classifyTokenUse('background', '--surface-1')).toMatch(/only the tokens file/);
    expect(classifyTokenUse('border', '--line-2')).toMatch(/only the tokens file/);
  });

  it('lets border tokens draw borders, outlines and scrollbars', () => {
    expect(classifyTokenUse('border', '--border')).toBeNull();
    expect(classifyTokenUse('border-top-color', '--border-soft')).toBeNull();
    expect(classifyTokenUse('outline-color', '--border-control')).toBeNull();
    expect(classifyTokenUse('scrollbar-color', '--border-on-card')).toBeNull();
    expect(classifyTokenUse('background', '--border-soft')).toMatch(/--border-\* is for border/);
  });

  it('ignores alias declarations, line-height and unrelated tokens', () => {
    expect(classifyTokenUse('--gate-muted', '--text-muted-on-card')).toBeNull();
    expect(classifyTokenUse('line-height', '--line-height-base')).toBeNull();
    expect(classifyTokenUse('color', '--muted')).toBeNull();
    expect(classifyTokenUse('color', '--accent')).toBeNull();
  });
});
```

Run: `cd packages/ui && bunx vitest run presets/eslint-local/token-namespaces.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 2: The classifier**

Create `packages/ui/presets/eslint-local/token-namespaces.js`:

```js
const BACKGROUND = new Set(['background', 'background-color', 'background-image', 'fill']);

const isBorderish = property =>
  property.startsWith('border') || property.startsWith('outline') || property === 'scrollbar-color';

/**
 * @param {string} property CSS property (kebab-case) or a style-object key
 * @param {string} varName custom property name including the leading `--`
 * @returns {string | null} a message when the pair is a violation
 */
export function classifyTokenUse(property, varName) {
  if (property.startsWith('--')) return null;
  const prop = property.replace(/[A-Z]/g, c => '-' + c.toLowerCase());

  if (/^--surface-[1-4]$/.test(varName) || /^--line-[1-3]$/.test(varName)) {
    return `${varName} is a ramp step; only the tokens file writes it. Use a role (--card, --border) instead.`;
  }
  if (varName.startsWith('--text-')) {
    return prop === 'color' ? null : `${varName}: --text-* is for color only.`;
  }
  if (varName.startsWith('--fill-')) {
    return prop === 'color' ? `${varName}: --fill-* is never a text colour; use --text-${varName.slice(7)}.` : null;
  }
  if (varName.startsWith('--surface-')) {
    return BACKGROUND.has(prop) ? null : `${varName}: --surface-* is for background and fill only.`;
  }
  if (varName.startsWith('--border-') || varName === '--border') {
    return isBorderish(prop) ? null : `${varName}: --border-* is for border and outline properties only.`;
  }
  return null;
}

export const VAR_PATTERN = /var\(\s*(--[a-zA-Z0-9-]+)/g;
```

Create `packages/ui/presets/eslint-local/token-namespaces.d.ts`:

```ts
export function classifyTokenUse(property: string, varName: string): string | null;
export const VAR_PATTERN: RegExp;
```

- [ ] **Step 3: The TSX rule**

Create `packages/ui/presets/eslint-local/token-namespaces-tsx.js`:

```js
import { classifyTokenUse, VAR_PATTERN } from './token-namespaces.js';

function keyName(node) {
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  return null;
}

function stringOf(node) {
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral') return node.quasis.map(q => q.value.cooked ?? '').join(' ');
  return null;
}

export default {
  meta: {
    type: 'problem',
    messages: { misuse: '{{message}}' },
  },
  create(context) {
    return {
      Property(node) {
        const property = keyName(node.key);
        const value = stringOf(node.value);
        if (!property || !value) return;
        for (const match of value.matchAll(VAR_PATTERN)) {
          const message = classifyTokenUse(property, match[1]);
          if (message) context.report({ node: node.value, messageId: 'misuse', data: { message } });
        }
      },
    };
  },
};
```

and `packages/ui/presets/eslint-local/token-namespaces-tsx.d.ts`:

```ts
import type { Rule } from 'eslint';

declare const rule: Rule.RuleModule;
export default rule;
```

- [ ] **Step 4: Rule tests**

Append to `packages/ui/presets/eslint-local/token-namespaces.test.ts`:

```ts
import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';

import tokenNamespacesTsx from './token-namespaces-tsx.js';

const tester = new RuleTester({
  languageOptions: { parser: tseslint.parser, ecmaVersion: 2023, sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } } },
});

// RuleTester.run creates its own describe/it blocks from the vitest globals
// (`globals: true` in packages/ui/vitest.config.ts); wrapping it in an it()
// makes vitest throw "Calling the suite function inside test function is
// not allowed", so the run call sits directly in the describe body.
describe('local/token-namespaces (tsx)', () => {
  tester.run('token-namespaces', tokenNamespacesTsx, {
    valid: [
      { code: 'const s = { color: "var(--text-3)", background: "var(--card)" };' },
      { code: 'const s = { borderColor: `1px solid var(--border-soft)` };' },
      { code: 'const s = { "--gate-muted": "var(--text-muted-on-card)" };' },
    ],
    invalid: [
      { code: 'const s = { color: "var(--fill-warn)" };', errors: [{ messageId: 'misuse' }] },
      { code: 'const s = { background: "var(--surface-2)" };', errors: [{ messageId: 'misuse' }] },
      { code: 'const s = { backgroundColor: `var(--text-2)` };', errors: [{ messageId: 'misuse' }] },
    ],
  });
});
```

Run: `cd packages/ui && bunx vitest run presets/eslint-local/token-namespaces.test.ts && bun run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Wire into the preset**

In `packages/ui/presets/eslint.js`, import `tokenNamespacesTsx from './eslint-local/token-namespaces-tsx.js'`, add `'token-namespaces': tokenNamespacesTsx` to the `local` plugin's `rules`, and add `'local/token-namespaces': 'error'` to the `rules` block beside `'local/no-inline-styles': 'off'`.

Run: `bun run lint && bun run chat:lint && bun run console:lint && bun run boxscore:lint`
Expected: clean. If an app reports a violation, it is a real one: list it in the report with file and line, and fix it only if the fix is a token swap on that line; otherwise leave it and report.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/presets packages/ui/vitest.config.ts
git commit -m "eslint: token-namespaces rule for style objects (MAT-420)"
```

### Task 11: The CSS rule

**Files:**
- Create: `packages/ui/presets/eslint-local/token-namespaces-css.js` and `token-namespaces-css.d.ts` (same two-line shape as `token-namespaces-tsx.d.ts`)
- Modify: `packages/ui/presets/eslint-local/token-namespaces.test.ts`, `eslint.config.js`, root `package.json`

**Interfaces:**
- Consumes: `classifyTokenUse` from Task 10.
- Produces: `tokenNamespacesCss`, an `@eslint/css` rule; root config blocks that lint `.css` under `packages/ui/src` and `stories/` at `error`, and under `packages/tui-kit/src` (excluding `generated/`) and `apps/board/src` at `warn` until each migrates.

- [ ] **Step 1: Install the CSS language plugin**

Run: `bun add -d @eslint/css` (repo root). Record the resolved version in the task report. Expected: root `bun.lock` and root `package.json` devDependencies updated.

- [ ] **Step 2: Write the failing rule test**

Append to `packages/ui/presets/eslint-local/token-namespaces.test.ts`:

```ts
import css from '@eslint/css';

import tokenNamespacesCss from './token-namespaces-css.js';

const cssTester = new RuleTester({
  plugins: { css },
  language: 'css/css',
});

describe('local/token-namespaces-css', () => {
  cssTester.run('token-namespaces-css', tokenNamespacesCss, {
    valid: [
      { code: '.a { color: var(--text-3); background: var(--card); }' },
      { code: '.a { border: 1px solid var(--border-soft); outline: 2px solid var(--border-control); }' },
      { code: '.a { --gate-muted: var(--text-muted-on-card); }' },
      { code: '.a { background: color-mix(in srgb, var(--fill-warn) 9%, transparent); }' },
    ],
    invalid: [
      { code: '.a { color: var(--fill-warn); }', errors: [{ messageId: 'misuse' }] },
      { code: '.a { color: color-mix(in srgb, var(--fill-warn) 86%, #000); }', errors: [{ messageId: 'misuse' }] },
      { code: '.a { background: var(--surface-1); }', errors: [{ messageId: 'misuse' }] },
      { code: '.a { border-color: var(--surface-card); }', errors: [{ messageId: 'misuse' }] },
      { code: '.a { background: var(--text-2); }', errors: [{ messageId: 'misuse' }] },
    ],
  });
});
```

Run: `cd packages/ui && bunx vitest run presets/eslint-local/token-namespaces.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: The rule**

Create `packages/ui/presets/eslint-local/token-namespaces-css.js`:

```js
import { classifyTokenUse } from './token-namespaces.js';

function collectVars(node, out) {
  if (!node || typeof node !== 'object') return out;
  if (node.type === 'Function' && node.name === 'var') {
    const first = node.children?.[0];
    if (first?.type === 'Identifier') out.push(first.name);
  }
  const children = node.children ?? [];
  for (const child of children) collectVars(child, out);
  if (node.value && typeof node.value === 'object') collectVars(node.value, out);
  return out;
}

export default {
  meta: {
    type: 'problem',
    messages: { misuse: '{{message}}' },
  },
  create(context) {
    return {
      Declaration(node) {
        for (const varName of collectVars(node.value, [])) {
          const message = classifyTokenUse(node.property, varName);
          if (message) context.report({ node, messageId: 'misuse', data: { message } });
        }
      },
    };
  },
};
```

`@eslint/css` hands rules a css-tree AST in plain-object form (`children` are arrays, not css-tree lists), which is what the walker above reads.

Run: `cd packages/ui && bunx vitest run presets/eslint-local/token-namespaces.test.ts`
Expected: PASS.

- [ ] **Step 4: Wire the CSS blocks into the root config**

In `eslint.config.js`:

- Change the tui-kit ignore from `{ ignores: ['packages/tui-kit/**'] }` to `{ ignores: ['packages/tui-kit/**/*.{ts,tsx,js,mjs}', 'packages/tui-kit/dist/**', 'packages/tui-kit/src/generated/**'] }` so its recipe CSS becomes lintable while its TS keeps its own conventions.
- Add imports: `import css from '@eslint/css';` and `import tokenNamespacesCss from './packages/ui/presets/eslint-local/token-namespaces-css.js';`.
- `mattstackEslint()` returns `js.configs.recommended`, the react-hooks block, `tseslint.configs.recommended` and the prettier config with no `files`, so once `.css` files match a config block those JavaScript rules run against the CSS language's SourceCode and ESLint crashes (`sourceCode.getAllComments is not a function`). Scope them to script files: add `const SCRIPT_FILES = ['**/*.{js,mjs,cjs,jsx,ts,tsx,mts,cts}'];` near the top and replace `...mattstackEslint(),` with

```js
  ...mattstackEslint().map(c => (c.files || c.ignores ? c : { ...c, files: SCRIPT_FILES })),
```

  The apps' own configs never see CSS and need nothing.
- Append before `...storybook.configs['flat/recommended']`:

```js
  {
    files: ['packages/ui/src/**/*.css', 'stories/**/*.css'],
    plugins: { css, local: { rules: { 'token-namespaces-css': tokenNamespacesCss } } },
    language: 'css/css',
    rules: { 'local/token-namespaces-css': 'error' },
  },
  {
    files: ['packages/tui-kit/src/**/*.css', 'apps/board/src/**/*.css'],
    plugins: { css, local: { rules: { 'token-namespaces-css': tokenNamespacesCss } } },
    language: 'css/css',
    rules: { 'local/token-namespaces-css': 'warn' },
  },
```

Change the root `lint` script to `eslint --no-error-on-unmatched-pattern packages .storybook stories 'apps/board/src/**/*.css'` (the CSS glob, not the directory: the board's TypeScript is not linted by the root config and reports over a hundred unrelated errors if it is).

Run: `bun run lint`
Expected: zero errors and five warnings, the migration's work list, not this task's: `Panel.module.css` (a wash used as `color`), `ContextMenu.module.css` and `Table.module.css` (`--border-soft` / `--border` painted as a hairline `background`), and `apps/board/src/style.css` lines 3644 and 3667 (`--border` outside a border property). Paste the list (file:line and message) into the task report and leave the code alone; a sixth warning is a regression to look at, not to add to the list. An error under `packages/ui/src` is a real misuse in kit CSS: fix it only if the fix is a one-token swap on that line, otherwise report it.

- [ ] **Step 5: Add the rule to the app presets' docs and commit**

In `AGENTS.md`, in the section that lists the import wall and consumer requirements, add one paragraph:

```md
### Token namespaces (lint)

`local/token-namespaces` (style objects) and `local/token-namespaces-css`
(stylesheets) enforce the ramp namespaces: `--text-*` only in `color`,
`--surface-*` only in backgrounds and `fill`, `--border-*` only in border
and outline properties, `--fill-*` never in `color`, and the numeric
ramp steps `--surface-N` / `--line-N` never outside the tokens package.
An app that uses `mattstackEslint()` gets the first rule; add the CSS
block from the root `eslint.config.js` to lint its stylesheets.
```

```bash
git add eslint.config.js package.json bun.lock packages/ui/presets AGENTS.md
git commit -m "eslint: token-namespaces-css rule over kit, story and board stylesheets"
```

---

## Self-review

Spec coverage:

| Spec section | Task |
| --- | --- |
| §2 Radix vendored, freshness test | 0 |
| §3 surfaces, `raised`, what repaints | 1, 2, 3 |
| §4 two layers, semantic roles, `--page`, `--raised` | 1 (roles by index), 2 (aliases) |
| §5 text ramp on slate 11/12, bars | 1 (invariants), 7 (Text story), 9 (gate) |
| §6 type bars (5.2 meta) | 7 (Type story), 9 |
| §7 palette by rule, ledgers, `dot` retired, legacy text leaves | 1 (rules as tests), 2 (aliases, Button ledger), 9 (fill ledger) |
| §7.1 step 9 shared by scheme | 1 |
| §7.2 lines from slate 8/7/6, card-scope aliases | 1, 2 |
| §7.3 Mantine picks, `primaryShade`, pins, `gray`/`dark` tuples | 4 |
| §8.1 namespaces | 10, 11 |
| §8.2 bound provider | 5 |
| §9 step 0 aliases (`--muted-text` → text-3, `--dot-*` → `--fill-*`, legacy hue text) | 1, 2 |
| §9 step 1 tuples and pins generated, dark block retired | 4 |
| §9 step 0 resolver retune both schemes, ledger to eight | 2 |
| §9 step 3 storybook decorator, tui-kit theme.css, build order | 6, 7, 8 |
| §9 step 4 gate on the vitest browser project, ledger shape widened | 9 |
| §9 step 5 lint before migration | 10, 11 (tui-kit and board at `warn`) |
| §9.1 measurement helpers | 9 uses `@soribashi/core/testing`; 7 uses tokens' math for pure hex values |

Not in this plan, by the spec's own sequencing: the apps-wide migration onto the new names (the 154 `--muted` classifications, the `--gate-*` block deletion, the board's own CSS moving off `--accent-text` and friends) follows after Task 11 lands.

Type consistency checked: `RADIX`, `RADIX_SCALES`, `Scale12` (Task 0) are what Tasks 1, 4 and 7 read; `HUES`, `HUE_SCALE`, `HueName`, `Step`, `hueStep`, `hueHover`, `surface.raised`, `line.control` (Task 1) are what Tasks 2, 3, 4, 7 read; `mantinePins` (Task 4) is what Task 4's generator and test import; `TuiKitProvider` (Task 5) is what Tasks 6, 8, 9 import; `FILL_DEBT_BY_KEY` / `fillDebtKey` (Task 9) match their own use; `classifyTokenUse` (Task 10) is what Task 11 imports.

---

## Part H: light surface ramp correction (spec §3, §10)

### Task 13: Stretch the light surface ramp to slate 2-4

Added after Task 7's storybook made the defect visible: on slate 1 to 3 the
four light surfaces spanned 16.39 to 14.41 against `text-1` and rendered as
four near-identical whites, while dark's four steps (16.25 to 12.43) read
as a ramp. §3's rule ("each step after `surface-1` has less contrast") was
not delivered in light, so this is a defect, not a preference.

**Files:**
- Modify: `packages/tokens/src/values.ts`, `packages/tokens/scripts/generate.ts`, `packages/tokens/test/invariants.test.ts`, `packages/tui-kit/test/theme.test.ts`, `packages/tui-kit/src/recipes/Button/Button.tsx`, `stories/ramps/catalogue.tsx`, `stories/ramps/Palette.stories.tsx`, `stories/ramps/Text.stories.tsx`, `stories/ramps/Type.stories.tsx`, the spec's §1.1/§3/§4/§5/§6/§7/§9/§10
- Regenerate: `packages/tokyo/src/tokyo-theme.css`, `packages/tui-kit/src/generated/{theme.css,tokens.ts}`, `apps/deck/core/generated/{board.js,board.css,gateway.css}`

**What was done:**

1. `values.ts`: light `surfaceSteps` `['#ffffff', 1, 2, 3]` to
   `['#ffffff', 2, 3, 4]`, so the light ramp is `#ffffff`, `#f9f9fb`,
   `#f0f0f3`, `#e8e8ec` (16.39, 15.58, 14.41, 13.41 against `text-1`). Dark
   is untouched, and no role index moves.
2. `values.ts`: `LIGHT_HUE_STEPS.bad` text step 11 to 12. Crimson 11
   measures 4.41 against the new floor, under the 4.5 body bar, which is
   what `invariants.test.ts`'s `ruleText` computes; the pin now matches the
   rule again.
3. `invariants.test.ts`: `TEXT_BAR` meta 5.2 to 4.8 (slate 11's worst case
   moves 5.22 to 4.86); the surface identity test reads slate 2..4; the
   fill-ledger case lists five misses (`dark/accent`, `dark/purple`,
   `light/cyan`, `light/ok`, `light/warn`), not three. Five, not six: light
   `warn` was already ledgered, so only `ok` and `cyan` join.
4. `generate.ts`: the emitted tokyo comment says slate 2 to 4.
5. `Button.tsx`: the pinned `light|accent` cell's label moves from
   `var(--accent-text)` (indigo 11) to `var(--text-accent-small)`
   (indigo 12). Its tint is translucent, so its painted ground is the page:
   on the new page the body token measures 4.399, under AA. The small token
   is what the resolver already gives every other tinted cell (spec §9
   step 0), so this is the pin catching up to the rule, not a new exception
   or a ledger entry.
6. Stories: the ramp catalogue's scheme columns sit on a warm mid-tone
   story-chrome literal (`#8a7560`, outside the cool platform palette) with
   28px padding and a 16px gap, so light and dark surfaces both read as
   objects with an edge; `Palette` puts each hue block on the scheme's card
   because it paints hue text directly; `Text` and `Type` carry the 4.8
   meta bar.

**Verification run:** tokens 90, tui-kit node 189, tui-kit browser 453,
visual 76 (refreshed with `-u`, no baseline bytes changed: the comparator's
0.2 per-pixel threshold and 1% mismatch ratio absorb the shift), chat 302,
console 748, board 1707, boxscore 309, deck 753. Freshness
gate, `bun run format`, `bun run lint`, `bun run typecheck` and
`scripts/repo-purity.sh` all clean.

---

## Part I: on-fill labels and the vivid hue text step (spec §7, §10)

Two per-hue tokens that the ramp rules cannot express, both discovered from
rendered UI rather than from the spec.

`--on-fill-<hue>` exists because "white on a hue fill" is wrong for four of
the six hues. `--text-<hue>-vivid` exists because `--text-<hue>` is defined
as the first step from 11 upward clearing 4.5, so it silently resolves to
step 12 in light for ok, bad, warn and cyan, and there is no token that names
step 11 unconditionally.

### Task 12: Emit `--on-fill-<hue>` and `--text-<hue>-vivid`, retune the filled label, rewrite the ledger

**Files:**
- Modify: `packages/tokens/src/values.ts`
- Modify: `packages/tokens/scripts/generate.ts`
- Modify: `packages/tokens/test/invariants.test.ts`
- Modify: `packages/tui-kit/src/intent-resolver.ts:76`
- Modify: `packages/tui-kit/src/a11y/known-contrast-debt.ts`
- Modify: `docs/superpowers/specs/2026-09-20-text-and-surface-ramps-design.md` (§7, the "Labels on fills" paragraph)
- Regenerate (never hand-edit): `packages/tui-kit/src/generated/tokens.ts`,
  `packages/tui-kit/src/generated/theme.css`, `packages/tokyo/src/tokyo-theme.css`,
  `packages/tokyo/src/ramps.ts`, `apps/deck/core/generated/*`

**Interfaces:**
- Consumes: `buildScheme()`'s `hueValue()` helper and `HueStep` from Task 1;
  the `family()` record in `generate.ts:56-61` from Task 2.
- Produces: `ColorScheme.hueOnFill` and `ColorScheme.hueTextVivid` (both
  `HueSet`); CSS custom properties `--tk-on-fill-<hue>` / `--on-fill-<hue>`
  and `--tk-text-<hue>-vivid` / `--text-<hue>-vivid`; tui-kit token-map keys
  `colors.<family>.onFill` and `colors.<family>.textVivid`, which reach CSS
  as `--color-<family>-onFill` and `--color-<family>-textVivid`.

**The two values, measured.** These are the numbers the invariants assert.
The dark neutral label is `#1c2024`, slate 12 light, which is already
`textRamp[0]` in the light scheme.

On-fill, label against fill, both schemes:

| hue | light fill | white | dark label | dark fill | white | dark label | pick |
|---|---|---|---|---|---|---|---|
| accent | `#3e63dd` | 5.21 | 3.15 | `#3e63dd` | 5.21 | 3.15 | white |
| purple | `#8e4ec6` | 5.18 | 3.16 | `#8e4ec6` | 5.18 | 3.16 | white |
| ok | `#0d9b8a` | 3.46 | 4.74 | `#12a594` | 3.07 | 5.33 | dark |
| warn | `#ef5f00` | 3.33 | 4.92 | `#f76b15` | 2.97 | 5.52 | dark |
| cyan | `#0797b9` | 3.42 | 4.79 | `#00a2c7` | 3.00 | 5.46 | dark |
| bad | `#e93d82` | 3.85 | 4.26 | `#e93d82` | 3.85 | 4.26 | dark |

The pick is the same in both schemes for every hue, so it is a property of
the hue, not the scheme. Only `bad` stays under 4.5, at 4.26, so the ledger
goes from eight entries to one.

Vivid text, step 11 unconditionally:

| hue | light | dark |
|---|---|---|
| accent | `#3a5bc7` | `#9eb1ff` |
| ok | `#008573` | `#0bd8b6` |
| bad | `#cb1d63` | `#ff92ad` |
| warn | `#cc4e00` | `#ffa057` |
| purple | `#8145b5` | `#d19dff` |
| cyan | `#107d98` | `#4ccce6` |

- [ ] **Step 1: Write the failing invariants**

In `packages/tokens/test/invariants.test.ts`, add:

```ts
import { contrast } from '../src/color-math.ts';

test('on-fill labels clear 4.5 except the ledgered miss', () => {
  const ledger: string[] = [];
  for (const scheme of ['light', 'dark'] as const) {
    for (const hue of HUES) {
      const fill = TOKENS[scheme].hue[hue];
      const label = TOKENS[scheme].hueOnFill[hue];
      const ratio = contrast(fill, label);
      if (ratio < 4.5) ledger.push(`${scheme}/${hue}`);
      expect(label === '#ffffff' || label === TOKENS.light.textRamp[0]).toBe(true);
    }
  }
  expect(ledger).toEqual(['light/bad', 'dark/bad']);
});

test('on-fill picks the better of white and the dark neutral', () => {
  const dark = TOKENS.light.textRamp[0];
  for (const scheme of ['light', 'dark'] as const) {
    for (const hue of HUES) {
      const fill = TOKENS[scheme].hue[hue];
      const chosen = TOKENS[scheme].hueOnFill[hue];
      const other = chosen === '#ffffff' ? dark : '#ffffff';
      expect(contrast(fill, chosen)).toBeGreaterThanOrEqual(contrast(fill, other));
    }
  }
});

test('the on-fill pick is the same in both schemes', () => {
  for (const hue of HUES) {
    const light = TOKENS.light.hueOnFill[hue] === '#ffffff';
    const dark = TOKENS.dark.hueOnFill[hue] === '#ffffff';
    expect(light).toBe(dark);
  }
});

test('vivid text is step 11 for every hue in both schemes', () => {
  for (const scheme of ['light', 'dark'] as const) {
    for (const hue of HUES) {
      expect(TOKENS[scheme].hueTextVivid[hue]).toBe(
        RADIX[HUE_SCALE[hue]][scheme][10]
      );
    }
  }
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun run --cwd packages/tokens test`
Expected: FAIL, `hueOnFill` and `hueTextVivid` are not properties of `ColorScheme`.

- [ ] **Step 3: Add both to `values.ts`**

Extend the interface (beside `hueTextSmall`, around line 36):

```ts
  hueOnFill: HueSet;
  hueTextVivid: HueSet;
```

Inside `buildScheme()`, after the `hueTextSmall` line:

```ts
  // Radix's step 9 and 10 are chosen to carry a white label, but only the two
  // blue-violet hues actually do: on the other four a white label measures
  // 2.97 to 3.85 while the dark neutral measures 4.26 to 5.52. The winner is
  // the same in both schemes for every hue, so this is a property of the hue.
  const onFillDark = RADIX.slate.light[11]!;
  const hueOnFill = hueValue((scale, step) =>
    contrast(at(scale, step.fill), '#ffffff') >= contrast(at(scale, step.fill), onFillDark)
      ? '#ffffff'
      : onFillDark
  );
  // Step 11 unconditionally. `hueText` promotes to 12 wherever 11 misses 4.5,
  // which in light is three of the six hues, so it cannot name this step.
  const hueTextVivid = hueValue(scale => at(scale, 11));
```

Add `contrast` to the imports at the top of the file:

```ts
import { contrast } from './color-math.ts';
```

Return both from `buildScheme()`, beside `hueTextSmall`:

```ts
    hueOnFill,
    hueTextVivid,
```

- [ ] **Step 4: Run the tokens tests**

Run: `bun run --cwd packages/tokens test`
Expected: PASS, all four new cases green.

- [ ] **Step 5: Emit them**

In `packages/tokens/scripts/generate.ts`, extend `family()` (line 56-61):

```ts
  const family = (hue: HueName) => ({
    '500': at(`hue.${hue}`, t.hue[hue]),
    hover: at(`hueHover.${hue}`, t.hueHover[hue]),
    onFill: at(`hueOnFill.${hue}`, t.hueOnFill[hue]),
    text: at(`hueText.${hue}`, t.hueText[hue]),
    textSmall: at(`hueTextSmall.${hue}`, t.hueTextSmall[hue]),
    textVivid: at(`hueTextVivid.${hue}`, t.hueTextVivid[hue]),
  });
```

In the `--tk-*` block, beside the existing `--tk-fill-${h}-hover` line (268)
and `--tk-text-${h}-small` line (273), add the two matching emitters:

```ts
      h => `  --tk-on-fill-${h}: ${at(`hueOnFill.${h}`, t.hueOnFill[h])};`
```

```ts
        `  --tk-text-${h}-vivid: ${at(`hueTextVivid.${h}`, t.hueTextVivid[h])};`
```

Follow the surrounding block's existing alias pattern so `--on-fill-<hue>`
and `--text-<hue>-vivid` land beside `--fill-<hue>` and `--text-<hue>-small`.
Read the block before editing; do not invent a second alias mechanism.

- [ ] **Step 6: Regenerate and commit the generated files**

Run, in this order:

```bash
bun run tokens:radix && bun run tokens:codegen && bun run tokens:ramps
bun run --cwd packages/tui-kit codegen
bun run tui-kit:build
```

Then confirm the freshness gate: re-run the same commands and check
`git status --porcelain` is empty on the second pass.

- [ ] **Step 7: Point the filled label at the token**

`packages/tui-kit/src/intent-resolver.ts`, in the `variant === "filled"`
block. Replace the `color:` line and its comment:

```ts
      // The neutral fill is the one case with no hue token: slate 9 carries a
      // white label at 3.3 in light and 5.1 in dark, so it flips per scheme.
      color: neutral ? "light-dark(var(--text-1), #ffffff)" : `var(--color-${family}-onFill)`,
```

- [ ] **Step 8: Rewrite the ledger**

`packages/tui-kit/src/a11y/known-contrast-debt.ts` currently holds eight
`filled` entries. Seven of them exist only because the label was white; with
the token they measure 4.74 to 5.52 and are no longer debt. Delete those
seven. Keep exactly one, rewritten to the new value:

```ts
  {
    id: 'filled/bad',
    schemes: ['light', 'dark'],
    measured: 4.26,
    note:
      'Crimson 9 is the one hue no label clears 4.5 on: white measures 3.85 ' +
      'and the dark neutral 4.26. The dark neutral is the better of the two ' +
      'and the fill step is fixed by the spec, so this is the floor.',
  },
```

Match the file's existing entry shape exactly; read it before editing rather
than assuming the field names above.

- [ ] **Step 9: Run every gate**

```bash
bun run --cwd packages/tokens test
bun run --cwd packages/tui-kit test
bun run tui-kit:build
bun run format:check && scripts/repo-purity.sh
```

Expected: all pass. Visual baselines will move where a filled control's label
changed colour; regenerate them with `-u` and LOOK at the resulting PNGs
before accepting. If a baseline moved in a way the token does not explain,
stop and report it rather than accepting the rewrite.

- [ ] **Step 10: Correct the spec**

In `docs/superpowers/specs/2026-09-20-text-and-surface-ramps-design.md` §7,
the "Labels on fills" paragraph currently says a label on a hue fill is
white. Replace that claim with the measured rule and the table from this
task's header, and add `--text-<hue>-vivid` to the §7 token list with its
one-line reason. Do not cite this task number or the review that found it.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "tokens: emit --on-fill-<hue> and --text-<hue>-vivid, retune the filled label"
```

---

## Part J: the seventh hue (spec §7)

Board uses two distinct warm status hues (conflicts vs ci-running, doctor vs
decide) and the six-hue palette has one. This adds a seventh.

### Task 14: Add `gold`, backed by the Radix amber scale

**Files:**
- Modify: `packages/tokens/scripts/generate-radix.ts`
- Regenerate: `packages/tokens/src/radix.ts`
- Modify: `packages/tokens/src/values.ts`
- Modify: `packages/tokens/scripts/generate.ts`
- Modify: `packages/tokens/test/invariants.test.ts`
- Modify: `packages/tui-kit/src/intent-resolver.ts` (`FAMILY`, `TEXT_TONE`, `TINT_TEXT_TONE`)
- Modify: `packages/tui-kit/src/a11y/known-contrast-debt.ts`
- Modify: `packages/tui-kit/soribashi.config.ts`
- Modify: `packages/tui-kit/docs/css-contract.md`
- Modify: `docs/superpowers/specs/2026-09-20-text-and-surface-ramps-design.md` (§7 palette table)
- Regenerate: `packages/tui-kit/src/generated/*`, `packages/tokyo/src/tokyo-theme.css`,
  `packages/tokyo/src/ramps.ts`, `apps/deck/core/generated/*`

**Interfaces:**
- Consumes: `--on-fill-<hue>` and `--text-<hue>-vivid` from Task 12; `HUES`,
  `HUE_SCALE`, `LIGHT_HUE_STEPS`, `DARK_HUE_STEPS` from Task 1.
- Produces: the hue name `gold` in `HUES`, the family alias `gold` in the
  tui-kit token map, and the public aliases `--gold`, `--fill-gold`,
  `--fill-gold-hover`, `--text-gold`, `--text-gold-small`,
  `--text-gold-vivid`, `--on-fill-gold`.

**Why `gold` and not `amber`.** The Radix scale is called amber, but
`--amber` is already a public alias in tui-kit's CSS contract meaning the
warn fill, and board reads `var(--amber)` today. Role names and Radix scale
names already diverge in this file (`warn` is backed by Radix orange), so
`HUE_SCALE.gold = 'amber'` follows the existing pattern rather than breaking
a shipped alias mid-migration.

**Values, read from `@radix-ui/colors` 3.0.0:**

```
light  9 #ffc53d  10 #ffba18  11 #ab6400  12 #4f3422
dark   9 #ffc53d  10 #ffd60a  11 #ffca16  12 #ffe7b3
```

**The fill limitation, and why it is a ledger entry rather than a fix.**
Radix amber is one of their deliberately low-contrast scales: step 9 is a
bright yellow chosen to carry a dark label, not to sit against a white page.
Measured against the light surface ramp, `#ffc53d` is 1.58 on `#ffffff` and
1.51 on `#e8e8ec`, and step 10 is no better. No step between 9 and 10 clears
the 3.0 fill bar in light, so the rule in §7 cannot pick one. Gold still
takes fill step 9 so its token shape matches every other hue, and the
shortfall is ledgered. Gold's intended use is status text, where it is
strong: `--text-gold-vivid` is 3.77 in light and 9.42 in dark.

Its on-fill label is the dark neutral at 10.38, the widest margin of any hue.

- [ ] **Step 1: Vendor the scale**

In `packages/tokens/scripts/generate-radix.ts`, add `'amber'` to the list of
scales it vendors. Read the existing list before editing; keep its ordering
convention.

Run: `bun run tokens:radix`
Expected: `packages/tokens/src/radix.ts` gains an `amber` entry with the
twelve light and twelve dark values above, and `RADIX_SCALES` gains `'amber'`.

- [ ] **Step 2: Write the failing test**

In `packages/tokens/test/invariants.test.ts`:

```ts
test('gold is the seventh hue, backed by Radix amber', () => {
  expect(HUES).toContain('gold');
  expect(HUE_SCALE.gold).toBe('amber');
  expect(TOKENS.light.hue.gold).toBe('#ffc53d');
  expect(TOKENS.dark.hue.gold).toBe('#ffc53d');
  expect(TOKENS.light.hueTextVivid.gold).toBe('#ab6400');
  expect(TOKENS.dark.hueTextVivid.gold).toBe('#ffca16');
});

test('gold takes the dark on-fill label', () => {
  expect(TOKENS.light.hueOnFill.gold).toBe(TOKENS.light.textRamp[0]);
  expect(TOKENS.dark.hueOnFill.gold).toBe(TOKENS.light.textRamp[0]);
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `bun run --cwd packages/tokens test`
Expected: FAIL, `'gold'` is not in `HUES`.

- [ ] **Step 4: Add the hue**

`packages/tokens/src/values.ts`:

```ts
export const HUES = ['accent', 'ok', 'bad', 'warn', 'purple', 'cyan', 'gold'] as const;
```

```ts
export const HUE_SCALE: Record<HueName, RadixScaleName> = {
  accent: 'indigo',
  ok: 'teal',
  bad: 'crimson',
  warn: 'orange',
  purple: 'purple',
  cyan: 'cyan',
  // Radix amber. The role is named gold because `--amber` is already the
  // shipped public alias for the warn fill.
  gold: 'amber',
};
```

Add to both step maps:

```ts
const LIGHT_HUE_STEPS: Record<HueName, HueStep> = {
  ...
  // Radix amber is a low-contrast scale: no step from 9 to 10 clears the 3.0
  // fill bar on a light surface. Step 9 keeps gold's token shape uniform and
  // the shortfall is ledgered; gold's real use is text.
  gold: { fill: 9, text: 12 },
};
```

```ts
const DARK_HUE_STEPS: Record<HueName, HueStep> = {
  ...
  gold: { fill: 9, text: 11 },
};
```

- [ ] **Step 5: Run the tokens tests**

Run: `bun run --cwd packages/tokens test`
Expected: PASS. If the existing "fills clear 3.0 on every surface" invariant
now fails for `light/gold`, that is the documented exception: add
`'light/gold'` to that test's expected-miss list with the measured 1.58 and
the reason, in the same shape the list already uses.

- [ ] **Step 6: Wire the family through the generator**

`packages/tokens/scripts/generate.ts`, in `buildTuiKitColors()`:

```ts
    gold: family('gold'),
```

The `--tk-*` emitters iterate `HUES`, so they pick gold up with no further
edit. Verify that by reading the block rather than assuming it.

- [ ] **Step 7: Wire the resolver**

`packages/tui-kit/src/intent-resolver.ts`, three maps:

```ts
const FAMILY: Record<string, string> = { ..., gold: "gold" };
```

```ts
const TEXT_TONE: Record<string, string> = { ..., gold: "var(--text-gold)" };
```

```ts
const TINT_TEXT_TONE: Record<string, string> = { ..., gold: "var(--text-gold-small)" };
```

Read each map first; match its existing key ordering and quoting style.

- [ ] **Step 8: Add the aliases**

`packages/tui-kit/soribashi.config.ts` gains the gold rows beside the warn
and cyan ones it already has (`--fill-gold`, `--fill-gold-hover`,
`--text-gold`, `--text-gold-small`, `--text-gold-vivid`, `--on-fill-gold`,
`--gold`). Update `packages/tui-kit/docs/css-contract.md`'s table to match.

- [ ] **Step 9: Ledger the fill**

`packages/tui-kit/src/a11y/known-contrast-debt.ts`, one new entry alongside
the `filled/bad` entry from Task 12:

```ts
  {
    id: 'fill/gold-on-surface',
    schemes: ['light'],
    measured: 1.58,
    note:
      'Radix amber is a low-contrast scale by design: step 9 is a bright ' +
      'yellow meant to carry a dark label, not to separate from a white ' +
      'page. No step from 9 to 10 clears 3.0 in light. Gold is a text hue; ' +
      'a gold fill on a light surface needs its own border to read.',
  },
```

- [ ] **Step 10: Regenerate and run every gate**

```bash
bun run tokens:radix && bun run tokens:codegen && bun run tokens:ramps
bun run --cwd packages/tui-kit codegen
bun run tui-kit:build
bun run --cwd packages/tokens test
bun run --cwd packages/tui-kit test
bun run format:check && scripts/repo-purity.sh
```

Re-run the generate commands a second time and confirm `git status
--porcelain` is empty, proving the freshness gate holds.

- [ ] **Step 11: Add gold to the reference catalogue**

`stories/ramps/Palette.stories.tsx` and `stories/ramps/catalogue.tsx` iterate
the hue list; confirm gold appears in the palette story with its fill, hover,
text, small, vivid and on-fill swatches. Screenshot the palette story in both
schemes to `.superpowers/sdd/2026-09-20-text-and-surface-ramps/screenshots/`
and LOOK at it. Gold's light-mode fill will look washed out against the page;
that is the ledgered limitation, not a bug. Say so in the report rather than
"fixing" it.

- [ ] **Step 12: Update the spec**

Add gold to §7's palette table with its scale, steps and the fill-limitation
note. Do not cite this task number.

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "tokens: add gold as the seventh hue, backed by Radix amber"
```

---

## Part K: app-kit's filled labels (spec §7)

Task 12 gave tui-kit's Button the per-hue on-fill label. app-kit's Mantine
Button was never wired to the same fix, so every filled button still paints a
white label on its hue fill. The specimen wall in Task 8 rendered both kits
side by side and made the gap visible: 16 axe violations per scheme in
app-kit against 1 in tui-kit.

### Task 15: app-kit's filled variant reads `--tk-on-fill-<hue>`

**Files:**
- Modify: `packages/ui/src/design-system/variant-resolver.ts`
- Test: `packages/ui/src/design-system/variant-resolver.test.ts` (create if absent; check first)

**Interfaces:**
- Consumes: `--tk-on-fill-<hue>` from Task 12, emitted in
  `packages/tokyo/src/tokyo-theme.css` for all seven hues in both schemes.
  Verified present at lines 107-113 (light) and 203-209 (dark).
- Produces: nothing new. This points an existing resolver at existing tokens.

**Why Mantine's own options do not solve it.** Read from the installed
`@mantine/core` 9.5.2, not from memory:

`default-variant-colors-resolver.mjs`, the `filled` branch, sets

```js
const textColor = _autoContrast
  ? (isVirtual ? `var(--mantine-color-${parsed.color}-contrast)`
               : parsed.isLight ? "var(--mantine-color-black)" : "var(--mantine-color-white)")
  : "var(--mantine-color-white)";
```

So with `autoContrast` off it is unconditionally white, and with it on it is
pure black or pure white chosen by Mantine's own `isLight` luminance test.
Neither reaches our measured pick, which is white for two hues and the dark
neutral `#1c2024` for the other five. Turning `autoContrast` on is therefore
not the fix; overriding the resolver is.

**The values, measured.** Label against fill, identical in both schemes
because the fill hex does not change between them:

| hue | fill (light) | white | `#1c2024` | pick |
|---|---|---|---|---|
| accent | `#3e63dd` | 5.21 | 3.15 | white |
| purple | `#8e4ec6` | 5.18 | 3.16 | white |
| ok | `#0d9b8a` | 3.46 | 4.74 | dark |
| warn | `#ef5f00` | 3.33 | 4.92 | dark |
| cyan | `#0797b9` | 3.42 | 4.79 | dark |
| bad | `#e93d82` | 3.85 | 4.26 | dark |

`bad` stays under 4.5 on its better pick and is already ledgered. Every other
hue crosses from failing to passing.

- [ ] **Step 1: Write the failing test**

Check whether `packages/ui/src/design-system/variant-resolver.test.ts`
exists and follow its conventions if so. Otherwise create it, matching the
test style of its sibling files in `packages/ui/src/design-system/`.

```ts
import { describe, expect, test } from 'vitest';
import { variantColorResolver } from './variant-resolver';
import { baseTheme } from './base-theme';

const HUES = ['accent', 'ok', 'bad', 'warn', 'purple', 'cyan'] as const;

describe('filled labels', () => {
  test.each(HUES)('%s reads its on-fill token', hue => {
    const result = variantColorResolver({
      color: hue,
      theme: baseTheme,
      variant: 'filled',
    } as Parameters<typeof variantColorResolver>[0]);
    expect(result.color).toBe(`var(--tk-on-fill-${hue})`);
  });

  test('a non-hue colour keeps Mantine default', () => {
    const result = variantColorResolver({
      color: 'gray',
      theme: baseTheme,
      variant: 'filled',
    } as Parameters<typeof variantColorResolver>[0]);
    expect(result.color).toBe('var(--mantine-color-white)');
  });

  test('other variants are untouched', () => {
    const result = variantColorResolver({
      color: 'ok',
      theme: baseTheme,
      variant: 'light',
    } as Parameters<typeof variantColorResolver>[0]);
    expect(result.color).not.toBe('var(--tk-on-fill-ok)');
  });
});
```

Note: the import path for `baseTheme` and the exact shape of the resolver
input are things to VERIFY before writing, not to copy from here. If
`baseTheme` is not exported from `./base-theme`, find what is and use that.

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run --cwd packages/ui test variant-resolver`
Expected: FAIL, the filled colour is `var(--mantine-color-white)`.

- [ ] **Step 3: Add the branch**

In `packages/ui/src/design-system/variant-resolver.ts`, add a `filled`
branch beside the existing `default` one. Keep the file's existing doc
comment accurate: it currently says "The one override", which stops being
true.

```ts
const ON_FILL_HUES = new Set(['accent', 'ok', 'bad', 'warn', 'purple', 'cyan']);
```

```ts
  if (input.variant === 'filled' && typeof input.color === 'string' && ON_FILL_HUES.has(input.color)) {
    return {
      ...base,
      color: `var(--tk-on-fill-${input.color})`,
    };
  }
```

`gold` is deliberately absent: it has no Mantine colour entry because its
fill measures 1.29 against the tightest light surface, so no gold filled
button exists to label.

- [ ] **Step 4: Run the test**

Run: `bun run --cwd packages/ui test variant-resolver`
Expected: PASS.

- [ ] **Step 5: Run every gate**

```bash
bun run --cwd packages/ui test
bun run typecheck
bun run lint
bun run format:check && scripts/repo-purity.sh
```

- [ ] **Step 6: Render it and look**

Re-run the `Specimens/app-kit/Buttons` story from Task 8 in both schemes,
screenshot, and read the PNGs. Report the axe violation count before and
after, and say plainly whether the filled labels now read. The expected
result is 16 violations per scheme dropping to 1, the ledgered `bad`.

If the count does not drop as expected, say so rather than declaring
success: it would mean the token is not reaching the component, which is the
same class of silent failure that a `light-dark()` pin hit elsewhere in this
program. Read `getComputedStyle` on a filled button's label to confirm the
value actually resolves, rather than trusting the screenshot.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "app-kit: filled buttons read the per-hue on-fill label"
```
