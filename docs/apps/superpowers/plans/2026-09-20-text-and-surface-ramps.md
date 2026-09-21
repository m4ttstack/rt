# Text and Surface Ramps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the contrast-ranked surface ramp, size-banded text ramp, line ramp and three-value palette in `packages/tokens`, generate the Mantine ramps from those seeds, retune the dark seeds, give tui-kit a bound provider, build the tokens storybook, extend the contrast gate, and ship the namespace lint rule.

**Architecture:** `packages/tokens/src/values.ts` becomes the single home of every ramp; each scheme's role values (`surface.card`, `line.border`, `text.mutedText`) are derived from a ramp index rather than typed by hand, so "every role is a ramp member" is true by construction and checkable by test. The existing generator (`scripts/generate.ts`) emits the new families into tui-kit's `tokens.ts` and tokyo's `tokyo-theme.css`; a new generator (`scripts/generate-ramps.ts`) writes tokyo's Mantine ramps from the same seeds. tui-kit's soribashi codegen then emits the public names (`--surface-1`, `--text-3`, `--fill-ok`, `--text-ok-small`). Everything downstream (provider, storybook, gate, lint) consumes those names.

**Tech Stack:** bun workspaces, TypeScript, vitest (node + browser projects), soribashi codegen (`soribashi build`), `@mantine/colors-generator` + `chroma-js` (codegen devDependency only), Storybook 10 (`@storybook/react-vite`, `@storybook/addon-a11y`), ESLint 10 flat config with `@eslint/css`.

**Spec:** `docs/superpowers/specs/2026-09-20-text-and-surface-ramps-design.md`

## Global Constraints

- The repo is public; every fixture, story string and test value must be invented data. `scripts/repo-purity.sh` gates the whole tree.
- `packages/tokens` takes no React, Mantine or soribashi runtime dependency. `@mantine/colors-generator` and `chroma-js` are devDependencies of its codegen only.
- Root `bun.lock` is the only lockfile. Run `bun install` from the repo root; never inside a package.
- Shared dependency versions live in the root `package.json` `workspaces.catalog`; members declare `"catalog:"`.
- `bun run tui-kit:build` must run before any board, deck or storybook typecheck/test/build.
- Generated artifacts are committed: after any `values.ts` change run `bun run tokens:codegen`, `cd packages/tui-kit && bun run codegen`, and `cd apps/deck && bun run build:board`, and commit `packages/tui-kit/src/generated/*`, `packages/tokyo/src/tokyo-theme.css`, `apps/deck/core/generated/*`. CI fails on drift (`.github/workflows/ci.yml` line 24).
- Light hue seeds are locked: `accent #4658ff`, `ok #00c287`, `bad #ff3d81`, `warn #ff8a00`, `purple #9b45ff`, `cyan #00b8d9`. No task changes them.
- Dark hue seeds change only in Task 6, together with the regenerated Night ramps and the resolver retune (Task 7 lands in the same PR).
- `known-contrast-debt.ts` ratchet: entries are only removed or improved, never worsened; no new dark Button entries anywhere in this plan.
- Contrast bars: text 4.5 (display/title/body), 5.5 (meta), 7.0 (small/micro); fills 3.0 (non-text). Solver values are the first hex clearing the bar, so assert `>= bar` at full float precision with the tokens package's `contrastRatio`.
- No em dashes or en dashes in any text this plan produces (code, comments, commit messages, stories).
- Comments state constraints the code cannot show. No comments that narrate the next line, cite this plan or the spec's section numbers, or record decision history.
- Run `bun run format` before every commit; CI runs `bun run format:check` over the tree (`packages/tui-kit`, `docs` and `apps/deck/core/generated` are prettier-ignored, and Task 5 adds `packages/tokyo/src/ramps.ts` to that list because its generator, not prettier, owns its layout).
- Commit after every task with the message given in that task.

## Values reference (copy verbatim; every task reads from here)

Surface ramps (index 1..4):

| | light | dark |
| --- | --- | --- |
| 1 | `#ffffff` | `#101016` |
| 2 | `#fbfbfc` | `#16161e` |
| 3 | `#f7f8fa` | `#1a1c28` |
| 4 | `#f3f4f7` | `#1e2030` |

Surface roles as ramp indices: light `card 1, panel 2, page 3, chrome 4, inset 3, overlay 2`; dark `card 4, panel 3, page 2, chrome 3, inset 1, overlay 2`.

Text ramps (index 1..4): light `#222222 #666e97 #596084 #4b5170`; dark `#e3e7f6 #7c86b3 #8d96bd #a3aac9`. Bars: 2 → 4.5, 3 → 5.5, 4 → 7.0.

Text roles as ramp indices: `fg 1` both; `mutedText` light 3, dark 4; `mutedOnCard` light 3, dark 4.

Line ramps (index 1..3): light `#c8cad6 #d5d7e2 #d5d7e2` (3 carries 2's value); dark `#6b7499 #505879 #3b4261`.

Line roles as ramp indices: light `border 1, soft 2, control 1, edgeOnCard 1, softOnCard 2`; dark `border 3, soft 3, control 1, edgeOnCard 2, softOnCard 3`. `grid` stays a literal in both schemes.

Hue text (body / small):

| hue | light body | light small | dark body | dark small |
| --- | --- | --- | --- | --- |
| accent | `#4658ff` | `#0e25ff` | `#6e7cf7` | `#9ca5f9` |
| ok | `#008059` | `#005e42` | `#319879` | `#3ec098` |
| bad | `#de004e` | `#a7003b` | `#f4417f` | `#f888af` |
| warn | `#aa5c00` | `#7e4400` | `#bd7827` | `#dc9f56` |
| purple | `#9337ff` | `#6900e3` | `#a867f3` | `#c498f7` |
| cyan | `#007b91` | `#005b6b` | `#0095b0` | `#00bbdd` |

Dark fills (Task 6 only): `accent #4758f4`, `ok #277860`, `bad #d30c52`, `warn #955f1f`, `purple #8c38ef`, `cyan #00768b`.

Public CSS names emitted by tui-kit after Part A: `--surface-1..4`, `--text-1..4`, `--line-1..3`, `--page`, `--fill-<hue>`, `--text-<hue>`, `--text-<hue>-small`, `--border-control`, where `<hue>` is one of `accent ok bad warn purple cyan`. Tokyo emits the same set prefixed `--tk-`.

## File structure

Part A (spec step 0):
- Modify `packages/tokens/src/values.ts`: ramp types, per-scheme spec objects, a `buildScheme()` that derives role values from ramp indices; new `hueText`, `hueTextSmall`, `line.control` fields.
- Modify `packages/tokens/test/invariants.test.ts`: ramp ordering, role membership, bar assertions, locked light hues.
- Modify `packages/tokens/scripts/generate.ts`: emit `ground`/`ink`/`rule` families and hue text shades into tui-kit tokens; emit `--tk-*` ramp names into tokyo.
- Modify `packages/tui-kit/src/theme.ts` (semantic `border.control`), `packages/tui-kit/soribashi.config.ts` (public aliases), `packages/tui-kit/test/theme.test.ts` (rulings).
- Regenerate `packages/tui-kit/src/generated/{tokens.ts,theme.css}`, `packages/tokyo/src/tokyo-theme.css`, `apps/deck/core/generated/*`.

Part B (spec step 1):
- Create `packages/tokens/src/ramp-math.ts` (pure re-anchor), `packages/tokens/test/ramp-math.test.ts`.
- Create `packages/tokens/scripts/generate-ramps.ts`; regenerate `packages/tokyo/src/ramps.ts`; root script `tokens:ramps`; CI freshness line.

Part C (spec step 2):
- Modify `packages/tokens/src/values.ts` (dark `hue`), `packages/tokens/test/invariants.test.ts` (hue angle), regenerate ramps and codegen.
- Modify `packages/tui-kit/src/intent-resolver.ts`; refresh Button visual baselines.

Part D (spec step 3):
- Rename `packages/tui-kit/src/provider.ts` to `provider.tsx`; add `TuiKitProvider`; test `packages/tui-kit/test/provider.test.tsx`.

Part E (spec step 4):
- Create `stories/ramps/*.stories.tsx` (reference catalogue) and `stories/specimens/*.stories.tsx` (both kits); modify `.storybook/main.ts`, `.storybook/preview.tsx`, root `package.json` lint pattern.

Part F (spec step 5):
- Modify `packages/tui-kit/src/a11y/known-contrast-debt.ts` (fill entry shape); create `packages/tui-kit/test/ramps.matrix.test.tsx`.

Part G (spec step 6):
- Create `packages/ui/presets/eslint-local/token-namespaces.js` (classifier), `token-namespaces-tsx.js`, `token-namespaces-css.js`, one `.d.ts` beside each (the `presets/vite.d.ts` convention; `packages/ui/tsconfig.json` compiles `presets`), and `token-namespaces.test.ts`; wire into `packages/ui/presets/eslint.js` and root `eslint.config.js`.

---

## Part A: tokens, scheme-safe part (spec §9 step 0)

Tasks 1, 2 and 3 land as one PR: Task 1 alone leaves the generated files stale, Task 2 alone leaves tokyo and deck stale.

### Task 1: Ramps in `values.ts`, derived roles, invariants

**Files:**
- Modify: `packages/tokens/src/values.ts`
- Test: `packages/tokens/test/invariants.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `ColorScheme` gains `surfaceRamp: Ramp4`, `textRamp: Ramp4`, `lineRamp: Ramp3`, `surfaceRole: Record<SurfaceRole, RampIndex4>`, `textRole: Record<TextRole, RampIndex4>`, `lineRole: Record<LineRole, RampIndex3>`, `hueText: HueSet`, `hueTextSmall: HueSet`, and `line.control: string`. `TOKENS.light` / `TOKENS.dark` keep every existing field with the values in the reference table. Exports `HUES` (`['accent','ok','bad','warn','purple','cyan'] as const`) and the types `Ramp3`, `Ramp4`, `HueName`, `SurfaceRole`, `TextRole`, `LineRole`.

- [ ] **Step 1: Write the failing invariants**

Append to `packages/tokens/test/invariants.test.ts` (keep every existing test):

```ts
import { HUES } from '../src/values.ts';

const LOCKED_LIGHT_HUES = {
  accent: '#4658ff',
  ok: '#00c287',
  bad: '#ff3d81',
  warn: '#ff8a00',
  purple: '#9b45ff',
  cyan: '#00b8d9',
} as const;

const TEXT_BAR = [0, 4.5, 5.5, 7.0] as const;

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
  });
});

describe('text ramp', () => {
  it.each(SCHEMES)('%s: text-2..4 clear their bars on every surface', scheme => {
    const t = TOKENS[scheme];
    for (let i = 1; i < 4; i++) {
      for (const surface of t.surfaceRamp) {
        expect(
          contrastRatio(t.textRamp[i]!, surface),
          `${scheme} text-${i + 1} on ${surface}`
        ).toBeGreaterThanOrEqual(TEXT_BAR[i]!);
      }
    }
  });

  it.each(SCHEMES)('%s: text-1 clears 7.0 on every surface', scheme => {
    const t = TOKENS[scheme];
    for (const surface of t.surfaceRamp) {
      expect(contrastRatio(t.textRamp[0], surface)).toBeGreaterThanOrEqual(7.0);
    }
  });

  it.each(SCHEMES)('%s: text roles are ramp steps', scheme => {
    const t = TOKENS[scheme];
    expect(t.text.fg).toBe(t.textRamp[t.textRole.fg - 1]);
    expect(t.text.mutedText).toBe(t.textRamp[t.textRole.mutedText - 1]);
    expect(t.text.mutedOnCard).toBe(t.textRamp[t.textRole.mutedOnCard - 1]);
  });
});

describe('line ramp', () => {
  it.each(SCHEMES)('%s: line-1 is strongest against the ground it sits on, non-increasing', scheme => {
    const t = TOKENS[scheme];
    const ground = scheme === 'light' ? t.surfaceRamp[0] : t.surface.card;
    const ratios = t.lineRamp.map(l => contrastRatio(l, ground));
    for (let i = 1; i < ratios.length; i++) {
      expect(ratios[i]).toBeLessThanOrEqual(ratios[i - 1]!);
    }
  });

  it.each(SCHEMES)('%s: line roles are ramp steps', scheme => {
    const t = TOKENS[scheme];
    expect(t.line.border).toBe(t.lineRamp[t.lineRole.border - 1]);
    expect(t.line.soft).toBe(t.lineRamp[t.lineRole.soft - 1]);
    expect(t.line.control).toBe(t.lineRamp[t.lineRole.control - 1]);
    expect(t.line.edgeOnCard).toBe(t.lineRamp[t.lineRole.edgeOnCard - 1]);
    expect(t.line.softOnCard).toBe(t.lineRamp[t.lineRole.softOnCard - 1]);
  });
});

describe('palette', () => {
  it('light fills are the locked hex', () => {
    for (const hue of HUES) {
      expect(TOKENS.light.hue[hue], hue).toBe(LOCKED_LIGHT_HUES[hue]);
    }
  });

  it('dark fills clear 3.0 on every dark surface', () => {
    for (const hue of HUES) {
      for (const surface of TOKENS.dark.surfaceRamp) {
        expect(contrastRatio(TOKENS.dark.hue[hue], surface), `${hue} on ${surface}`).toBeGreaterThanOrEqual(3.0);
      }
    }
  });

  it.each(SCHEMES)('%s: hue text clears 4.5 at body and 7.0 at small on every surface', scheme => {
    const t = TOKENS[scheme];
    for (const hue of HUES) {
      for (const surface of t.surfaceRamp) {
        expect(contrastRatio(t.hueText[hue], surface), `${scheme} text-${hue} on ${surface}`).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(t.hueTextSmall[hue], surface), `${scheme} text-${hue}-small on ${surface}`).toBeGreaterThanOrEqual(7.0);
      }
    }
  });

  it('light: fill, body, small progress darker', () => {
    const t = TOKENS.light;
    for (const hue of HUES) {
      const [fill, body, small] = [t.hue[hue], t.hueText[hue], t.hueTextSmall[hue]].map(srgbLuminance);
      expect(fill, `${hue} fill vs body`).toBeGreaterThanOrEqual(body!);
      expect(body, `${hue} body vs small`).toBeGreaterThan(small!);
    }
  });
});
```

The dark direction (fill lighter than body lighter than small) is asserted in Task 6, where the dark fills change; with today's Tokyo Night seeds every dark fill is lighter than its solved body text and the assertion would fail here.

Also change the existing `AA floors for text-role tokens` describe so its `surfaces` list reads the ramp: replace `const surfaces = ['chrome', 'bg', 'panel', 'card'] as const;` and the inner loop with `for (const surface of t.surfaceRamp)` and `contrastRatio(t.text[roleName], surface)`.

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/tokens && bunx vitest run test/invariants.test.ts`
Expected: FAIL. `HUES` is not exported and `surfaceRamp` is undefined.

- [ ] **Step 3: Rewrite `values.ts`**

Replace the whole of `packages/tokens/src/values.ts` above `CSS_TEXT` with:

```ts
export const HUES = ['accent', 'ok', 'bad', 'warn', 'purple', 'cyan'] as const;
export type HueName = (typeof HUES)[number];
export type HueSet = Record<HueName, string>;

export type Ramp4 = readonly [string, string, string, string];
export type Ramp3 = readonly [string, string, string];
export type RampIndex4 = 1 | 2 | 3 | 4;
export type RampIndex3 = 1 | 2 | 3;

export type SurfaceRole = 'card' | 'panel' | 'page' | 'chrome' | 'inset' | 'overlay';
export type TextRole = 'fg' | 'mutedText' | 'mutedOnCard';
export type LineRole = 'border' | 'soft' | 'control' | 'edgeOnCard' | 'softOnCard';

export interface ColorScheme {
  hue: HueSet;
  hueText: HueSet;
  hueTextSmall: HueSet;
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
  dot: {
    ok: string;
    warn: string;
    bad: string;
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

interface SchemeSpec {
  hue: HueSet;
  hueText: HueSet;
  hueTextSmall: HueSet;
  surfaceRamp: Ramp4;
  textRamp: Ramp4;
  lineRamp: Ramp3;
  surfaceRole: Record<SurfaceRole, RampIndex4>;
  textRole: Record<TextRole, RampIndex4>;
  lineRole: Record<LineRole, RampIndex3>;
  text: Omit<ColorScheme['text'], 'fg' | 'mutedText' | 'mutedOnCard'>;
  grid: string;
  dot: ColorScheme['dot'];
  wash: string;
}

// Role values are read off the ramps by index so a role can never carry a
// colour that is not a ramp step; invariants.test.ts checks the ramps' order.
function buildScheme(spec: SchemeSpec): ColorScheme {
  const s = (i: RampIndex4) => spec.surfaceRamp[i - 1];
  const t = (i: RampIndex4) => spec.textRamp[i - 1];
  const l = (i: RampIndex3) => spec.lineRamp[i - 1];
  return {
    hue: spec.hue,
    hueText: spec.hueText,
    hueTextSmall: spec.hueTextSmall,
    surfaceRamp: spec.surfaceRamp,
    textRamp: spec.textRamp,
    lineRamp: spec.lineRamp,
    surfaceRole: spec.surfaceRole,
    textRole: spec.textRole,
    lineRole: spec.lineRole,
    text: {
      fg: t(spec.textRole.fg),
      mutedText: t(spec.textRole.mutedText),
      mutedOnCard: t(spec.textRole.mutedOnCard),
      ...spec.text,
    },
    surface: {
      chrome: s(spec.surfaceRole.chrome),
      bg: s(spec.surfaceRole.page),
      panel: s(spec.surfaceRole.panel),
      card: s(spec.surfaceRole.card),
      inset: s(spec.surfaceRole.inset),
      overlay: s(spec.surfaceRole.overlay),
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
    dot: spec.dot,
    wash: spec.wash,
  };
}

export const TOKENS: Tokens = {
  light: buildScheme({
    hue: {
      accent: '#4658ff',
      ok: '#00c287',
      bad: '#ff3d81',
      warn: '#ff8a00',
      purple: '#9b45ff',
      cyan: '#00b8d9',
    },
    hueText: {
      accent: '#4658ff',
      ok: '#008059',
      bad: '#de004e',
      warn: '#aa5c00',
      purple: '#9337ff',
      cyan: '#007b91',
    },
    hueTextSmall: {
      accent: '#0e25ff',
      ok: '#005e42',
      bad: '#a7003b',
      warn: '#7e4400',
      purple: '#6900e3',
      cyan: '#005b6b',
    },
    surfaceRamp: ['#ffffff', '#fbfbfc', '#f7f8fa', '#f3f4f7'],
    // Canonical 6-digit spelling; CSS_TEXT below overrides the shipped
    // spelling of text-1 back to the 3-digit `#222`.
    textRamp: ['#222222', '#666e97', '#596084', '#4b5170'],
    // line-3 has no light consumer yet and carries line-2's value because a
    // light-dark() declaration needs a colour on both sides.
    lineRamp: ['#c8cad6', '#d5d7e2', '#d5d7e2'],
    surfaceRole: { card: 1, panel: 2, page: 3, chrome: 4, inset: 3, overlay: 2 },
    textRole: { fg: 1, mutedText: 3, mutedOnCard: 3 },
    lineRole: { border: 1, soft: 2, control: 1, edgeOnCard: 1, softOnCard: 2 },
    text: {
      muted: '#8990b3',
      accentText: '#3a3fe8',
      okText: '#008559',
      warnText: '#b36000',
      badgeText: '#454b66',
      redText: '#c8214f',
    },
    grid: 'rgba(52, 59, 88, 0.05)',
    dot: {
      ok: '#1f9d3a',
      warn: '#e08a00',
      bad: '#e5153f',
    },
    wash: '10%',
  }),
  dark: buildScheme({
    hue: {
      accent: '#7aa2f7',
      ok: '#9ece6a',
      bad: '#f7768e',
      warn: '#e0af68',
      purple: '#bb9af7',
      cyan: '#7dcfff',
    },
    hueText: {
      accent: '#6e7cf7',
      ok: '#319879',
      bad: '#f4417f',
      warn: '#bd7827',
      purple: '#a867f3',
      cyan: '#0095b0',
    },
    hueTextSmall: {
      accent: '#9ca5f9',
      ok: '#3ec098',
      bad: '#f888af',
      warn: '#dc9f56',
      purple: '#c498f7',
      cyan: '#00bbdd',
    },
    surfaceRamp: ['#101016', '#16161e', '#1a1c28', '#1e2030'],
    textRamp: ['#e3e7f6', '#7c86b3', '#8d96bd', '#a3aac9'],
    lineRamp: ['#6b7499', '#505879', '#3b4261'],
    surfaceRole: { card: 4, panel: 3, page: 2, chrome: 3, inset: 1, overlay: 2 },
    textRole: { fg: 1, mutedText: 4, mutedOnCard: 4 },
    lineRole: { border: 3, soft: 3, control: 1, edgeOnCard: 2, softOnCard: 3 },
    text: {
      muted: '#7e86ad',
      accentText: '#7aa2f7',
      okText: '#9ece6a',
      warnText: '#e0af68',
      badgeText: '#aab3d8',
      redText: '#f7768e',
    },
    grid: 'rgba(122, 162, 247, 0.06)',
    dot: {
      ok: '#4ade5b',
      warn: '#ffbb3d',
      bad: '#ff5c72',
    },
    wash: '15%',
  }),
  font: {
    mono: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    baseSize: '13.5px',
    lineHeight: '1.55',
  },
};
```

Keep the existing `CSS_TEXT` export unchanged below it.

- [ ] **Step 4: Run the tokens tests**

Run: `cd packages/tokens && bunx vitest run`
Expected: PASS for `invariants.test.ts`. `ramp-anchors.test.ts` still passes (dark `hue` is unchanged). `consumption.test.ts` and `fragment-sync.test.ts` may fail because the generated files are now stale; that is Task 2's job, so note it and continue.

- [ ] **Step 5: Typecheck**

Run: `cd packages/tokens && bun run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/tokens/src/values.ts packages/tokens/test/invariants.test.ts
git commit -m "tokens: surface, text and line ramps with roles derived by index"
```

### Task 2: Emit the ramps through tui-kit

**Files:**
- Modify: `packages/tokens/scripts/generate.ts:39-90`
- Modify: `packages/tui-kit/src/theme.ts:236-242`
- Modify: `packages/tui-kit/soribashi.config.ts:42-95`
- Modify: `packages/tui-kit/test/theme.test.ts:193-214,325-335`
- Regenerate: `packages/tui-kit/src/generated/tokens.ts`, `packages/tui-kit/src/generated/theme.css`

**Interfaces:**
- Consumes: `TOKENS[scheme].surfaceRamp/textRamp/lineRamp/hueText/hueTextSmall/line.control` from Task 1.
- Produces: tui-kit colour families `ground["1".."4"]`, `ink["1".."4"]`, `rule["1".."3"]`, `<family>.text`, `<family>.textSmall`, `line.control`; emitted CSS names `--color-ground-N`, `--color-ink-N`, `--color-rule-N`, `--color-<family>-text`, `--color-<family>-textSmall`, `--border-control`; public aliases `--surface-1..4`, `--text-1..4`, `--line-1..3`, `--page`, `--fill-<hue>`, `--text-<hue>`, `--text-<hue>-small`.

- [ ] **Step 1: Write the failing theme tests**

In `packages/tui-kit/test/theme.test.ts`, add after the `DARK_SURFACE_RETUNE` constant:

```ts
// `--border-soft` is excluded from the DARK sweep: the line ramp folds the
// census soft rule into the ramp's third step. See the "line ramp" block.
const LINE_RAMP_RULING = new Set(["--border-soft"]);
```

and extend the `DARK_COLORS` filter to `!TEXT_CONFORMANCE_RULING.has(name) && !DARK_SURFACE_RETUNE.has(name) && !LINE_RAMP_RULING.has(name)`.

Replace the `muted FILL (--muted) stays the raw census hex...` test body's four `mutedText` / `--muted-text` expectations with:

```ts
  expect(tuiTheme.tokens.colors.gray!.mutedText).toBe("#596084");
  expect(tuiTheme.dark!.colors!.gray!.mutedText).toBe("#a3aac9");
  expect(resolve("--muted-text", "light")).toBe("#596084");
  expect(resolve("--muted-text", "dark")).toBe("#a3aac9");
```

Add these tests at the end of the file:

```ts
// ── ramps ────────────────────────────────────────────────────────────────

test("the public ramp names resolve to the tokens package's ramp values", () => {
  expect(resolve("--surface-1", "light")).toBe("#ffffff");
  expect(resolve("--surface-4", "light")).toBe("#f3f4f7");
  expect(resolve("--surface-1", "dark")).toBe("#101016");
  expect(resolve("--surface-4", "dark")).toBe("#1e2030");
  expect(resolve("--text-1", "light")).toBe("#222");
  expect(resolve("--text-4", "light")).toBe("#4b5170");
  expect(resolve("--text-2", "dark")).toBe("#7c86b3");
  expect(resolve("--line-1", "dark")).toBe("#6b7499");
  expect(resolve("--line-3", "light")).toBe("#d5d7e2");
  expect(resolve("--page", "light")).toBe("#f7f8fa");
  expect(resolve("--page", "dark")).toBe("#16161e");
});

test("every surface role is a ramp step in both schemes", () => {
  for (const scheme of ["light", "dark"] as const) {
    const ramp = [1, 2, 3, 4].map((i) => resolve(`--surface-${i}`, scheme));
    for (const role of ["--card", "--panel", "--page", "--chrome", "--surface-inset", "--surface-overlay"]) {
      expect(ramp, `${scheme} ${role}`).toContain(resolve(role, scheme));
    }
  }
});

test("the line ramp carries the dark soft rule on line-3 and the card-scope edges on their steps", () => {
  expect(resolve("--border-soft", "dark")).toBe("#3b4261");
  expect(resolve("--border-on-card", "dark")).toBe("#505879");
  expect(resolve("--border-control", "dark")).toBe("#6b7499");
  expect(resolve("--border-control", "light")).toBe("#c8cad6");
  expect(resolve("--border-soft-on-card", "dark")).toBe("#3b4261");
});

test("fill and text names exist for every hue, and text-<hue> is never the fill in dark", () => {
  for (const hue of ["accent", "ok", "bad", "warn", "purple", "cyan"]) {
    for (const scheme of ["light", "dark"] as const) {
      expect(resolve(`--fill-${hue}`, scheme)).toMatch(/^#[0-9a-f]{6}$/);
      expect(resolve(`--text-${hue}`, scheme)).toMatch(/^#[0-9a-f]{6}$/);
      expect(resolve(`--text-${hue}-small`, scheme)).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(resolve(`--text-${hue}`, "dark")).not.toBe(resolve(`--fill-${hue}`, "dark"));
  }
  expect(resolve("--fill-ok", "light")).toBe("#00c287");
  expect(resolve("--text-ok", "light")).toBe("#008059");
  expect(resolve("--text-ok-small", "light")).toBe("#005e42");
});
```

Note `resolve("--text-1", "light")` expects `#222`: `CSS_TEXT` prints text-1 in its shipped 3-digit spelling, the same as `--fg`.

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/tui-kit && bunx vitest run --project node test/theme.test.ts`
Expected: FAIL on the new tests (names not emitted) and on the `--muted-text` values.

- [ ] **Step 3: Emit the new families from `generate.ts`**

In `packages/tokens/scripts/generate.ts`, replace `buildTuiKitColors` with:

```ts
function buildTuiKitColors(scheme: 'light' | 'dark') {
  const t: ColorScheme = TOKENS[scheme];
  const at = (leaf: string, value: string) => pick(`${scheme}.${leaf}`, value);
  const family = (hue: HueName) => ({
    '500': at(`hue.${hue}`, t.hue[hue]),
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
      ok: at('dot.ok', t.dot.ok),
      warn: at('dot.warn', t.dot.warn),
      bad: at('dot.bad', t.dot.bad),
    },
  };
}
```

Change the import line to `import { CSS_TEXT, TOKENS, type ColorScheme, type HueName } from '../src/values.ts';`. Add to `CSS_TEXT` in `values.ts`: `'light.textRamp.0': '#222',` so `ink.1` prints the same shipped spelling as `gray.fg`.

- [ ] **Step 4: Declare the semantic border role and the public aliases in tui-kit**

In `packages/tui-kit/src/theme.ts`, add `control: "colors.line.control",` inside `semanticTokens.border` after `default`.

In `packages/tui-kit/soribashi.config.ts`, add inside the `root` object after the `"--border": "var(--border-default)"` line:

```ts
    "--page": "var(--surface-canvas)",
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
    "--fill-ok": "var(--color-green-500)",
    "--fill-bad": "var(--color-red-500)",
    "--fill-warn": "var(--color-amber-500)",
    "--fill-purple": "var(--color-purple-500)",
    "--fill-cyan": "var(--color-cyan-500)",
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

- [ ] **Step 5: Waive the new public names in the consumption gate**

`packages/tokens/test/consumption.test.ts` fails any custom property emitted in tui-kit's `theme.css` that no recipe CSS, `canvas.css` or `theme.css` itself references, unless it is listed in `WAIVED_TUI` with a reason. The 31 public ramp names have no kit consumer until the storybook and the gate (both outside its scan) and the migration. Above `WAIVED_TUI` in that file add:

```ts
const RAMP_HUES = ['accent', 'ok', 'bad', 'warn', 'purple', 'cyan'];
const RAMP_PUBLIC_NAMES = [
  '--page',
  '--border-control',
  ...[1, 2, 3, 4].flatMap(i => [`--surface-${i}`, `--text-${i}`]),
  ...[1, 2, 3].map(i => `--line-${i}`),
  ...RAMP_HUES.flatMap(h => [`--fill-${h}`, `--text-${h}`, `--text-${h}-small`]),
];
const RAMP_WAIVER =
  'ramp name emitted ahead of the apps-wide migration; the storybook specimens and the ramp contrast gate read it, no kit recipe does yet.';
```

and make the first entries of `WAIVED_TUI`:

```ts
const WAIVED_TUI: Record<string, string> = {
  ...Object.fromEntries(RAMP_PUBLIC_NAMES.map(name => [name, RAMP_WAIVER])),
```

keeping every existing entry after that spread.

- [ ] **Step 6: Regenerate and run the node tier**

Run:
```bash
bun run tokens:codegen
cd packages/tui-kit && bun run codegen && bunx vitest run --project node
cd ../tokens && bunx vitest run test/consumption.test.ts
```
Expected: PASS, including `theme.test.ts`'s referential-closure test (every `var()` has a declaration) and the census sweeps with the new ruling. If `token-existence.test.ts` or `no-hardcoded-values.test.ts` fail, the failure names a recipe reading a token that moved; none should, because no recipe changes here.

- [ ] **Step 7: Run the browser tier the way CI does**

Run: `cd packages/tui-kit && bun run build && bunx vitest run --project browser --exclude '**/*.visual.test.tsx' --exclude '**/*.parity.test.tsx'`
Expected: PASS. `Button.matrix.test.tsx` is unaffected: no seed or resolver changed, and the `muted` intent reads `--color-gray-muted`, which did not move.

- [ ] **Step 8: Commit**

```bash
git add packages/tokens packages/tui-kit/src/theme.ts packages/tui-kit/soribashi.config.ts packages/tui-kit/test/theme.test.ts packages/tui-kit/src/generated
git commit -m "tui-kit: emit the surface, text, line and hue-text ramps as public names"
```

### Task 3: Emit the ramps through tokyo, regenerate deck

**Files:**
- Modify: `packages/tokens/scripts/generate.ts:153-245`
- Regenerate: `packages/tokyo/src/tokyo-theme.css`, `apps/deck/core/generated/board.css`, `apps/deck/core/generated/board.js`, `apps/deck/core/generated/gateway.css`

**Interfaces:**
- Produces: `--tk-surface-1..4`, `--tk-text-1..4`, `--tk-line-1..3`, `--tk-fill-<hue>`, `--tk-text-<hue>`, `--tk-text-<hue>-small` in both `[data-mantine-color-scheme]` blocks of `tokyo-theme.css`.

- [ ] **Step 1: Write the failing test**

Create `packages/tokens/test/tokyo-ramp-names.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { HUES, TOKENS } from '../src/values.ts';

const css = readFileSync(
  join(import.meta.dirname, '..', '..', 'tokyo', 'src', 'tokyo-theme.css'),
  'utf8'
);

function block(scheme: 'light' | 'dark'): string {
  const begin = css.indexOf(`/* BEGIN GENERATED: tokyo tokens ${scheme} */`);
  const end = css.indexOf('/* END GENERATED */', begin);
  return css.slice(begin, end);
}

describe('tokyo-theme.css carries the ramps', () => {
  it.each(['light', 'dark'] as const)('%s: numbered ramps match TOKENS', scheme => {
    const b = block(scheme);
    const t = TOKENS[scheme];
    t.surfaceRamp.forEach((v, i) => expect(b).toContain(`--tk-surface-${i + 1}: ${v};`));
    t.lineRamp.forEach((v, i) => expect(b).toContain(`--tk-line-${i + 1}: ${v};`));
    expect(b).toContain(`--tk-text-2: ${t.textRamp[1]};`);
    expect(b).toContain(`--tk-text-4: ${t.textRamp[3]};`);
  });

  it.each(['light', 'dark'] as const)('%s: fill and text names per hue', scheme => {
    const b = block(scheme);
    const t = TOKENS[scheme];
    for (const hue of HUES) {
      expect(b).toContain(`--tk-fill-${hue}: ${t.hue[hue]};`);
      expect(b).toContain(`--tk-text-${hue}: ${t.hueText[hue]};`);
      expect(b).toContain(`--tk-text-${hue}-small: ${t.hueTextSmall[hue]};`);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/tokens && bunx vitest run test/tokyo-ramp-names.test.ts`
Expected: FAIL, names absent.

- [ ] **Step 3: Emit them**

In `packages/tokens/scripts/generate.ts`, inside `renderTokyoSchemeBlock` add these lines to the returned array, after `` `  --tk-dot-bad: ${d.dotBad};` `` and before `''`:

```ts
    ...t.surfaceRamp.map((v, i) => `  --tk-surface-${i + 1}: ${at(`surfaceRamp.${i}`, v)};`),
    ...t.textRamp.map((v, i) => `  --tk-text-${i + 1}: ${at(`textRamp.${i}`, v)};`),
    ...t.lineRamp.map((v, i) => `  --tk-line-${i + 1}: ${at(`lineRamp.${i}`, v)};`),
    ...HUES.map(h => `  --tk-fill-${h}: ${at(`hue.${h}`, t.hue[h])};`),
    ...HUES.map(h => `  --tk-text-${h}: ${at(`hueText.${h}`, t.hueText[h])};`),
    ...HUES.map(h => `  --tk-text-${h}-small: ${at(`hueTextSmall.${h}`, t.hueTextSmall[h])};`),
```

and at the top of `renderTokyoSchemeBlock` add `const t = TOKENS[scheme];` and `const at = (leaf: string, value: string) => pick(`${scheme}.${leaf}`, value);`. Import `HUES` from `../src/values.ts`.

Because `--tk-text-1` light goes through `CSS_TEXT` it prints `#222`; the test only checks text-2 and text-4 for that reason.

- [ ] **Step 4: Waive the new `--tk-*` names, regenerate everything downstream**

The tokyo half of `packages/tokens/test/consumption.test.ts` fails any `--tk-*` name no `packages/tokyo` or `packages/ui` CSS references unless it is in `WAIVED_TOKYO`. Above `WAIVED_TOKYO` add:

```ts
const TK_RAMP_NAMES = [
  ...[1, 2, 3, 4].flatMap(i => [`--tk-surface-${i}`, `--tk-text-${i}`]),
  ...[1, 2, 3].map(i => `--tk-line-${i}`),
  ...RAMP_HUES.flatMap(h => [`--tk-fill-${h}`, `--tk-text-${h}`, `--tk-text-${h}-small`]),
];
const TK_RAMP_WAIVER =
  'ramp name mirrored from the tui theme for app-kit consumers ahead of the migration; no packages/ui component wires it yet.';
```

(`RAMP_HUES` is the constant Task 2 added at the top of the same file) and make the first entries of `WAIVED_TOKYO`:

```ts
const WAIVED_TOKYO: Record<string, string> = {
  ...Object.fromEntries(TK_RAMP_NAMES.map(name => [name, TK_RAMP_WAIVER])),
```

Run:
```bash
bun run tokens:codegen
cd packages/tokens && bunx vitest run
cd ../../ && bun run tui-kit:build
cd apps/deck && bun run build:board
cd ../.. && git status --short
```
Expected: tokens tests PASS, including both consumption suites and their no-stale-waivers checks; `git status` lists `packages/tokyo/src/tokyo-theme.css` and `apps/deck/core/generated/*` as modified.

- [ ] **Step 5: Run the freshness gate and the app suites CI runs**

Run:
```bash
bun run tokens:codegen && git diff --exit-code packages/tui-kit/src/generated packages/tui-kit/assets packages/tokyo/src
bun run chat:test && bun run console:test && bun run board:test
scripts/repo-purity.sh
```
Expected: the diff gate prints nothing and exits 0 (everything committed matches a live rebuild); app suites PASS; purity PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/tokens packages/tokyo/src/tokyo-theme.css apps/deck/core/generated
git commit -m "tokyo: emit the ramps as --tk-* names; regenerate deck's vendored board"
```

## Part B: generated Mantine ramps, MAT-421 (spec §9 step 1)

### Task 4: Pure re-anchoring math

**Files:**
- Create: `packages/tokens/src/ramp-math.ts`
- Test: `packages/tokens/test/ramp-math.test.ts`

**Interfaces:**
- Produces: `type Lab = readonly [number, number, number]`; `rawPosition(outIndex: number, baseIndex: number, targetIndex: number): number`; `resampleRamp(raw: readonly Lab[], baseIndex: number, targetIndex: number): Lab[]`. Both pure; no colour library.

The warp keeps three fixed points (0 to 0, target to base, 9 to 9) and is linear between them, so an output index maps to a fractional raw position and the OKLab triple is interpolated between the two raw stops around it.

`@mantine/colors-generator` never produces a stop darker than about HSL lightness 0.34, and three of the dark seeds Task 6 introduces (`ok #277860`, `warn #955f1f`, `cyan #00768b`) sit below that, so the generator returns them at `baseColorIndex 9` with nothing darker to warp onto. For that case the light side is resampled from the raw ramp as usual and the five stops past the seed are extrapolated from the seed toward black in OKLab: lightness falls linearly to 45% of the seed's and chroma to 60% of the seed's at stop 9. A seed lighter than the raw ramp's lightest stop (`baseColorIndex 0`) still throws; no seed in this program hits it.

- [ ] **Step 1: Write the failing tests**

Create `packages/tokens/test/ramp-math.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { rawPosition, resampleRamp, type Lab } from '../src/ramp-math.ts';

const raw: Lab[] = Array.from({ length: 10 }, (_, i) => [1 - i * 0.1, i * 0.01, -i * 0.02]);

describe('rawPosition', () => {
  it('is the identity when base and target coincide', () => {
    for (let i = 0; i < 10; i++) expect(rawPosition(i, 6, 6)).toBe(i);
  });

  it('pins 0, target and 9', () => {
    expect(rawPosition(0, 3, 6)).toBe(0);
    expect(rawPosition(6, 3, 6)).toBe(3);
    expect(rawPosition(9, 3, 6)).toBe(9);
  });

  it('is linear on each side of the target', () => {
    expect(rawPosition(3, 3, 6)).toBeCloseTo(1.5);
    expect(rawPosition(7, 3, 6)).toBeCloseTo(5);
  });
});

describe('resampleRamp', () => {
  it('returns ten stops with the raw base at the target index and the raw endpoints preserved', () => {
    const out = resampleRamp(raw, 3, 6);
    expect(out).toHaveLength(10);
    expect(out[6]).toEqual(raw[3]);
    expect(out[0]).toEqual(raw[0]);
    expect(out[9]).toEqual(raw[9]);
  });

  it('interpolates between raw stops', () => {
    const out = resampleRamp(raw, 3, 6);
    expect(out[3]![0]).toBeCloseTo(0.85);
  });

  it('keeps a monotonic lightness channel monotonic', () => {
    const out = resampleRamp(raw, 7, 4);
    for (let i = 1; i < out.length; i++) expect(out[i]![0]).toBeLessThan(out[i - 1]![0]);
  });

  it('extrapolates past a seed that is the darkest raw stop', () => {
    const out = resampleRamp(raw, 9, 4);
    expect(out).toHaveLength(10);
    expect(out[0]).toEqual(raw[0]);
    expect(out[4]).toEqual(raw[9]);
    expect(out[2]![0]).toBeCloseTo(raw[4]![0] + (raw[5]![0] - raw[4]![0]) * 0.5);
    for (let i = 1; i < out.length; i++) expect(out[i]![0]).toBeLessThan(out[i - 1]![0]);
    expect(out[9]![0]).toBeCloseTo(raw[9]![0] * 0.45);
    expect(out[9]![1]).toBeCloseTo(raw[9]![1] * 0.6);
  });

  it('throws when the seed is lighter than the lightest raw stop', () => {
    expect(() => resampleRamp(raw, 0, 6)).toThrow(/lighter/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/tokens && bunx vitest run test/ramp-math.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

Create `packages/tokens/src/ramp-math.ts`:

```ts
export type Lab = readonly [number, number, number];

const STOPS = 10;
const LAST = STOPS - 1;

export function rawPosition(outIndex: number, baseIndex: number, targetIndex: number): number {
  if (outIndex <= targetIndex) {
    return targetIndex === 0 ? 0 : (outIndex * baseIndex) / targetIndex;
  }
  return baseIndex + ((outIndex - targetIndex) * (LAST - baseIndex)) / (LAST - targetIndex);
}

function lerp(a: Lab, b: Lab, f: number): Lab {
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

const DARK_L_FLOOR = 0.45;
const DARK_CHROMA_FLOOR = 0.6;

function sampleAt(raw: readonly Lab[], p: number): Lab {
  const lo = Math.floor(p);
  const hi = Math.min(lo + 1, LAST);
  return lo === hi ? raw[lo]! : lerp(raw[lo]!, raw[hi]!, p - lo);
}

// The generator has no stop darker than this seed, so the dark side is
// drawn from the seed toward black instead of warped from the raw ramp.
function extrapolateDark(seed: Lab, count: number): Lab[] {
  const out: Lab[] = [];
  for (let k = 1; k <= count; k++) {
    const f = k / count;
    out.push([
      seed[0] * (1 - (1 - DARK_L_FLOOR) * f),
      seed[1] * (1 - (1 - DARK_CHROMA_FLOOR) * f),
      seed[2] * (1 - (1 - DARK_CHROMA_FLOOR) * f),
    ]);
  }
  return out;
}

export function resampleRamp(raw: readonly Lab[], baseIndex: number, targetIndex: number): Lab[] {
  if (raw.length !== STOPS) throw new Error(`resampleRamp: expected ${STOPS} stops, got ${raw.length}`);
  if (baseIndex <= 0) {
    throw new Error(`resampleRamp: base index 0; the seed is lighter than the generator's lightest stop`);
  }
  if (baseIndex === LAST) {
    const out: Lab[] = [];
    for (let i = 0; i < targetIndex; i++) out.push(sampleAt(raw, (i * LAST) / targetIndex));
    out[0] = raw[0]!;
    out.push(raw[LAST]!, ...extrapolateDark(raw[LAST]!, LAST - targetIndex));
    return out;
  }
  const out: Lab[] = [];
  for (let i = 0; i < STOPS; i++) out.push(sampleAt(raw, rawPosition(i, baseIndex, targetIndex)));
  out[targetIndex] = raw[baseIndex]!;
  out[0] = raw[0]!;
  out[LAST] = raw[LAST]!;
  return out;
}
```

- [ ] **Step 4: Run the tests**

Run: `cd packages/tokens && bunx vitest run test/ramp-math.test.ts && bun run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/tokens/src/ramp-math.ts packages/tokens/test/ramp-math.test.ts
git commit -m "tokens: pure OKLab ramp re-anchoring"
```

### Task 5: The ramp generator, wired into codegen and CI

**Files:**
- Create: `packages/tokens/scripts/generate-ramps.ts`
- Modify: `package.json` (catalog + `tokens:ramps` script), `packages/tokens/package.json` (devDependencies)
- Modify: `.github/workflows/ci.yml:24`
- Regenerate: `packages/tokyo/src/ramps.ts`
- Test: `packages/tokens/test/ramp-anchors.test.ts` (existing, must stay green), `packages/tokens/test/generated-ramps.test.ts` (new)

**Interfaces:**
- Consumes: `resampleRamp` from Task 4; `TOKENS[scheme].hue` seeds.
- Produces: `packages/tokyo/src/ramps.ts` with the same exports as today (`tokyoRamps`, `TokyoRampName`, `ramp`), generated. Root script `bun run tokens:ramps`.

- [ ] **Step 1: Add the codegen dependencies**

In root `package.json` `workspaces.catalog`, add (keep alphabetical order with the neighbours):

```json
      "@mantine/colors-generator": "^9.5.2",
      "@types/chroma-js": "^3.1.1",
      "chroma-js": "^3.1.2",
```

In `packages/tokens/package.json` add:

```json
  "devDependencies": {
    "@mantine/colors-generator": "catalog:",
    "@types/chroma-js": "catalog:",
    "chroma-js": "catalog:"
  }
```

Run: `bun install` (repo root). Expected: `bun.lock` updated at the root only; `git status` shows no `packages/tokens/bun.lock`.

- [ ] **Step 2: Write the failing generated-ramps test**

Create `packages/tokens/test/generated-ramps.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { srgbLuminance } from '../src/color-math.ts';
import { tokyoRamps } from '../../tokyo/src/ramps.ts';

const source = readFileSync(join(import.meta.dirname, '..', '..', 'tokyo', 'src', 'ramps.ts'), 'utf8');

describe('generated ramps', () => {
  it('ramps.ts is a generated file', () => {
    expect(source.startsWith('/* GENERATED by packages/tokens/scripts/generate-ramps.ts; do not edit. */')).toBe(true);
  });

  it.each(Object.entries(tokyoRamps))('%s has ten stops, strictly darkening', (_name, stops) => {
    expect(stops).toHaveLength(10);
    for (const s of stops) expect(s).toMatch(/^#[0-9a-f]{6}$/);
    const lums = stops.map(srgbLuminance);
    for (let i = 1; i < lums.length; i++) expect(lums[i], `stop ${i}`).toBeLessThan(lums[i - 1]!);
  });
});
```

Run: `cd packages/tokens && bunx vitest run test/generated-ramps.test.ts`
Expected: FAIL on the header assertion (the hand-written file has a different header).

- [ ] **Step 3: Write the generator**

Create `packages/tokens/scripts/generate-ramps.ts`:

```ts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { generateColorsMap } from '@mantine/colors-generator';
import chroma from 'chroma-js';

import { srgbLuminance } from '../src/color-math.ts';
import { resampleRamp, type Lab } from '../src/ramp-math.ts';
import { HUES, TOKENS, type HueName } from '../src/values.ts';

const OUT = join(import.meta.dirname, '..', '..', 'tokyo', 'src', 'ramps.ts');

// Mantine reads shade 6 as primary in light and shade 4 in dark
// (packages/tokyo/src/theme.ts `primaryShade`); the seed must land there.
const PRIMARY_INDEX = { light: 6, dark: 4 } as const;

const HEADER = `/* GENERATED by packages/tokens/scripts/generate-ramps.ts; do not edit. */
import type { MantineColorsTuple } from '@mantine/core';

/**
 * Tokyo Day / Tokyo Night as ten-shade Mantine ramps, one pair per hue.
 * Each ramp is @mantine/colors-generator's output for the tokens package's
 * seed, re-anchored in OKLab so the seed's exact hex sits on the shade
 * Mantine reads as primary (6 in Day, 4 in Night) and the ramp stays
 * monotonic in lightness. Regenerate with \`bun run tokens:ramps\`.
 */
`;

const FOOTER = `} as const satisfies Record<string, readonly string[]>;

export type TokyoRampName = keyof typeof tokyoRamps;

export const ramp = (name: TokyoRampName): MantineColorsTuple =>
  tokyoRamps[name] as unknown as MantineColorsTuple;
`;

export function buildRamp(seed: string, targetIndex: number): string[] {
  const map = generateColorsMap(seed);
  const raw: Lab[] = map.colors.map(c => {
    const [l, a, b] = c.oklab();
    return [l, a, b];
  });
  const out = resampleRamp(raw, map.baseColorIndex, targetIndex).map(lab => chroma.oklab(lab[0], lab[1], lab[2]).hex());
  out[targetIndex] = seed;
  out[0] = map.colors[0]!.hex();
  if (map.baseColorIndex !== 9) out[9] = map.colors[9]!.hex();
  return out;
}

export function assertRamp(name: string, seed: string, targetIndex: number, stops: readonly string[]): void {
  if (stops.length !== 10) throw new Error(`${name}: expected 10 stops, got ${stops.length}`);
  if (stops[targetIndex] !== seed) throw new Error(`${name}: stop ${targetIndex} is ${stops[targetIndex]}, seed is ${seed}`);
  const lums = stops.map(srgbLuminance);
  for (let i = 1; i < lums.length; i++) {
    if (!(lums[i]! < lums[i - 1]!)) {
      throw new Error(`${name}: stops ${i - 1} and ${i} (${stops[i - 1]}, ${stops[i]}) are not strictly darkening`);
    }
  }
}

function render(): string {
  const lines: string[] = [HEADER, 'export const tokyoRamps = {'];
  for (const hue of HUES as readonly HueName[]) {
    for (const [scheme, suffix] of [['light', 'Day'], ['dark', 'Night']] as const) {
      const seed = TOKENS[scheme].hue[hue];
      const target = PRIMARY_INDEX[scheme];
      const stops = buildRamp(seed, target);
      assertRamp(`${hue}${suffix}`, seed, target, stops);
      lines.push(`  ${hue}${suffix}: [`);
      for (const s of stops) lines.push(`    '${s}',`);
      lines.push('  ],');
    }
  }
  lines.push(FOOTER);
  return lines.join('\n');
}

if (import.meta.main) {
  writeFileSync(OUT, render());
}
```

`chroma.oklab(l, a, b)` and `Color.oklab()` are chroma-js 2.2+ APIs; `chroma-js@3` types them.

- [ ] **Step 4: Wire the script and generate**

Root `package.json` scripts, after `"tokens:codegen"`:

```json
    "tokens:ramps": "bun run packages/tokens/scripts/generate-ramps.ts",
```

Add `packages/tokyo/src/ramps.ts` to `.prettierignore` under the `apps/deck/core/generated` entry, with the comment `# generated by packages/tokens/scripts/generate-ramps.ts; the freshness gate byte-compares it against a live rebuild`.

Run: `bun run tokens:ramps && git diff --stat packages/tokyo/src/ramps.ts`
Expected: the file is rewritten; the generator threw nothing (every current seed sits inside the generator's range, so the extrapolation branch is not exercised until Task 6). If it throws `lighter than`, stop and report which seed; do not hand-edit the output.

- [ ] **Step 5: Verify anchors and record the delta**

Run: `cd packages/tokens && bunx vitest run test/ramp-anchors.test.ts test/generated-ramps.test.ts`
Expected: PASS. `ramp-anchors.test.ts` pins `tokyoRamps[<hue>Day][6] === TOKENS.light.hue[hue]` and `[<hue>Night][4] === TOKENS.dark.hue[hue]`; the generator lands both by construction.

Then compute how far the other nine stops moved from the hand-written ramps:

```bash
git show HEAD:packages/tokyo/src/ramps.ts > packages/tokens/ramps-before.tmp.ts
cd packages/tokens && bun -e "
import { tokyoRamps as before } from './ramps-before.tmp.ts';
import { tokyoRamps as after } from '../tokyo/src/ramps.ts';
import chroma from 'chroma-js';
let worst = 0, where = '';
for (const name of Object.keys(after)) for (let i = 0; i < 10; i++) {
  const d = chroma.deltaE(before[name][i], after[name][i]);
  if (d > worst) { worst = d; where = name + '[' + i + '] ' + before[name][i] + ' -> ' + after[name][i]; }
}
console.log('max deltaE', worst.toFixed(2), where);
" && rm ramps-before.tmp.ts && cd ../..
```

Write the printed line into the task report. A max deltaE under 5 is a re-solve of the same procedure with rounding differences; over 5 means the hand-written procedure and this one diverge somewhere, and the report must say on which stop so the reviewer can look at it. Either way the anchors are what the spec requires.

- [ ] **Step 6: Run the consumers**

Run: `bun run typecheck && bun run chat:test && bun run console:test`
Expected: PASS. tokyo's `theme.ts` reads `ramp()` unchanged.

- [ ] **Step 7: Extend the CI freshness gate**

In `.github/workflows/ci.yml` line 24, change the run line to:

```yaml
      - run: bun run tokens:codegen && bun run tokens:ramps && git diff --exit-code packages/tui-kit/src/generated packages/tui-kit/assets packages/tokyo/src
```

Run it locally: `bun run tokens:codegen && bun run tokens:ramps && git diff --exit-code packages/tui-kit/src/generated packages/tui-kit/assets packages/tokyo/src`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add package.json bun.lock .prettierignore packages/tokens packages/tokyo/src/ramps.ts .github/workflows/ci.yml
git commit -m "tokens: generate tokyo's Mantine ramps from the hue seeds (MAT-421)"
```

---

## Part C: dark seeds, one change (spec §9 step 2)

Tasks 6 and 7 land in one PR. Task 6 alone leaves the dark Button grid under the floor; Task 7 fixes it. Do not open a PR between them.

### Task 6: Retune the dark seeds and regenerate

**Files:**
- Modify: `packages/tokens/src/values.ts` (dark `hue` block only)
- Modify: `packages/tokens/test/invariants.test.ts`
- Regenerate: `packages/tokyo/src/ramps.ts`, `packages/tui-kit/src/generated/*`, `packages/tokyo/src/tokyo-theme.css`, `apps/deck/core/generated/*`

**Interfaces:**
- Produces: `TOKENS.dark.hue` = the dark fills from the values reference; `tokyoRamps.*Night[4]` = those fills.

- [ ] **Step 1: Write the failing hue-angle invariant**

Append to `packages/tokens/test/invariants.test.ts`:

```ts
function hueAngle(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let angle: number;
  if (max === r) angle = ((g - b) / d) % 6;
  else if (max === g) angle = (b - r) / d + 2;
  else angle = (r - g) / d + 4;
  return ((angle * 60) + 360) % 360;
}

describe('dark hue correction', () => {
  it('every dark fill holds its light fill hue angle within 1 degree', () => {
    for (const hue of HUES) {
      const light = hueAngle(TOKENS.light.hue[hue]);
      const dark = hueAngle(TOKENS.dark.hue[hue]);
      const delta = Math.min(Math.abs(light - dark), 360 - Math.abs(light - dark));
      expect(delta, `${hue}: light ${light.toFixed(1)} vs dark ${dark.toFixed(1)}`).toBeLessThanOrEqual(1);
    }
  });

  it('dark: fill, body, small progress lighter', () => {
    const t = TOKENS.dark;
    for (const hue of HUES) {
      const [fill, body, small] = [t.hue[hue], t.hueText[hue], t.hueTextSmall[hue]].map(srgbLuminance);
      expect(fill, `${hue} fill vs body`).toBeLessThan(body!);
      expect(body, `${hue} body vs small`).toBeLessThan(small!);
    }
  });
});
```

Run: `cd packages/tokens && bunx vitest run test/invariants.test.ts`
Expected: FAIL on both new tests (`ok` is 73 degrees apart; every Tokyo Night fill is lighter than its solved body text).

- [ ] **Step 2: Change the dark seeds**

In `packages/tokens/src/values.ts`, the dark `hue` block becomes:

```ts
    hue: {
      accent: '#4758f4',
      ok: '#277860',
      bad: '#d30c52',
      warn: '#955f1f',
      purple: '#8c38ef',
      cyan: '#00768b',
    },
```

- [ ] **Step 3: Regenerate everything and run the tokens tests**

```bash
bun run tokens:ramps && bun run tokens:codegen
cd packages/tokens && bunx vitest run
```
Expected: PASS, including `ramp-anchors.test.ts` (the Night ramps were regenerated in the same step), `generated-ramps.test.ts`, and the two `dark hue correction` tests. `okNight`, `warnNight` and `cyanNight` take the extrapolation branch of `resampleRamp` (their seeds are darker than anything the generator emits); open the regenerated `ramps.ts` and confirm those three have stop 4 equal to the seed and stops 5 to 9 darker, then note it in the report.

- [ ] **Step 4: Regenerate the kits and deck**

```bash
cd packages/tui-kit && bun run codegen && cd ../..
bun run tui-kit:build
cd apps/deck && bun run build:board && cd ../..
cd packages/tui-kit && bunx vitest run --project node
```
Expected: node tier PASS. The census dark sweep covers `--accent`, `--green`, `--red`, `--amber`, `--purple`, `--cyan`; add a ruling set in `packages/tui-kit/test/theme.test.ts`:

```ts
// The six dark hues are excluded from the DARK sweep: the dark hue
// correction re-seeds them on the light palette's hue angles. See the
// "dark hue correction" block.
const DARK_HUE_CORRECTION = new Set(["--accent", "--green", "--red", "--amber", "--purple", "--cyan"]);
```

added to the `DARK_COLORS` filter, plus this explicit test at the end of the file:

```ts
test("the dark hues carry the corrected seeds", () => {
  expect(resolve("--accent", "dark")).toBe("#4758f4");
  expect(resolve("--green", "dark")).toBe("#277860");
  expect(resolve("--red", "dark")).toBe("#d30c52");
  expect(resolve("--amber", "dark")).toBe("#955f1f");
  expect(resolve("--purple", "dark")).toBe("#8c38ef");
  expect(resolve("--cyan", "dark")).toBe("#00768b");
});
```

Then re-run the node tier. Expected: PASS.

- [ ] **Step 5: Confirm the dark Button grid is now red, as expected**

Run: `cd packages/tui-kit && bunx vitest run --project browser src/recipes/Button/Button.matrix.test.tsx`
Expected: dark cells FAIL (filled label is `var(--bg)` on a dark fill; outline and subtle tones are the seeds). Do not touch the ledger. Task 7 fixes this.

- [ ] **Step 6: Commit (no PR yet)**

```bash
git add packages/tokens packages/tokyo/src packages/tui-kit/src/generated packages/tui-kit/test/theme.test.ts apps/deck/core/generated
git commit -m "tokens: dark hues re-seeded on the light hue angles; Night ramps regenerated"
```

### Task 7: Retune the tui-kit button resolver for the new dark fills

**Files:**
- Modify: `packages/tui-kit/src/intent-resolver.ts:38-111`
- Test: `packages/tui-kit/src/recipes/Button/Button.matrix.test.tsx` (existing, must go green), `packages/tui-kit/test/intent-resolver.test.ts` (new, node tier)
- Refresh: `packages/tui-kit/src/recipes/Button/__screenshots__/*dark*`

**Interfaces:**
- Consumes: `--text-<hue>`, `--text-<hue>-small`, `--text-2`, `--text-4` from Task 2.
- Produces: `retunedTextColor(tone, variant, intent)` now returns a `light-dark()` expression for `light`, `outline` and `subtle`; `filled` paints `light-dark(var(--bg), #ffffff)`. `toneWeightFor` unchanged.

- [ ] **Step 1: Write the failing resolver test**

Create `packages/tui-kit/test/intent-resolver.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { retunedTextColor, tuiIntentResolver } from "../src/intent-resolver.ts";

describe("dark retune", () => {
  test("filled paints a white label in dark and keeps var(--bg) in light", () => {
    const r = tuiIntentResolver({ intent: "ok", variant: "filled" });
    expect(r.color).toBe("light-dark(var(--bg), #ffffff)");
  });

  test("outline and subtle take the hue text token in dark, the mixed tone in light", () => {
    expect(retunedTextColor("var(--color-green-500)", "outline", "ok")).toBe(
      "light-dark(color-mix(in srgb, var(--color-green-500) 85%, var(--fg)), var(--text-ok))",
    );
    expect(retunedTextColor("var(--color-purple-500)", "subtle", "purple")).toBe(
      "light-dark(var(--color-purple-500), var(--text-purple))",
    );
  });

  test("the tinted light variant takes the small hue text token in dark", () => {
    expect(retunedTextColor("var(--color-blue-500)", "light", "accent")).toBe(
      "light-dark(color-mix(in srgb, var(--color-blue-500) 80%, var(--fg)), var(--text-accent-small))",
    );
  });

  test("muted maps onto the neutral text ramp", () => {
    expect(retunedTextColor("var(--color-gray-muted)", "outline", "muted")).toBe(
      "light-dark(color-mix(in srgb, var(--color-gray-muted) 60%, var(--fg)), var(--text-2))",
    );
    expect(retunedTextColor("var(--color-gray-muted)", "light", "muted")).toBe(
      "light-dark(color-mix(in srgb, var(--color-gray-muted) 70%, var(--fg)), var(--text-4))",
    );
  });

  test("default is untouched", () => {
    expect(retunedTextColor("var(--color-blue-500)", "default", "accent")).toBe("var(--color-blue-500)");
  });
});
```

Run: `cd packages/tui-kit && bunx vitest run --project node test/intent-resolver.test.ts`
Expected: FAIL.

- [ ] **Step 2: Retune**

In `packages/tui-kit/src/intent-resolver.ts`, add after `OUTLINE_SUBTLE_TONE_WEIGHT`:

```ts
/**
 * Dark text tones. The dark fills are solved at the 3:1 non-text bar, so a
 * fill used as text reads under AA there; every text-bearing variant reads
 * the hue's solved text token instead. The tinted `light` variant lifts its
 * ground above the page, so it takes the 7:1 small token for headroom.
 */
const DARK_TEXT_TONE: Record<string, string> = {
  accent: "var(--text-accent)",
  ok: "var(--text-ok)",
  warn: "var(--text-warn)",
  bad: "var(--text-bad)",
  cyan: "var(--text-cyan)",
  purple: "var(--text-purple)",
  muted: "var(--text-2)",
};

const DARK_TINT_TEXT_TONE: Record<string, string> = {
  accent: "var(--text-accent-small)",
  ok: "var(--text-ok-small)",
  warn: "var(--text-warn-small)",
  bad: "var(--text-bad-small)",
  cyan: "var(--text-cyan-small)",
  purple: "var(--text-purple-small)",
  muted: "var(--text-4)",
};

function darkTextTone(variant: string, intent: string): string | undefined {
  if (variant === "light") return DARK_TINT_TEXT_TONE[intent];
  if (variant === "outline" || variant === "subtle") return DARK_TEXT_TONE[intent];
  return undefined;
}
```

Replace `retunedTextColor` with:

```ts
export function retunedTextColor(tone: string, variant: string, intent: string): string {
  const weight = toneWeightFor(variant, intent);
  const light = weight === undefined ? tone : `color-mix(in srgb, ${tone} ${weight}%, var(--fg))`;
  const dark = darkTextTone(variant, intent);
  return dark === undefined ? light : `light-dark(${light}, ${dark})`;
}
```

In `packages/tui-kit/src/recipes/Button/Button.tsx` line 89, the `default|bad` cell is pinned outside the resolver; change it to

```ts
        "--sb-button-bad-color": "light-dark(color-mix(in srgb, var(--red) 80%, var(--fg)), var(--text-bad))",
```

(with the new dark red it measures 3.77:1 on the panel as a mix; `--text-bad` is solved at 4.5). `Button.test.tsx`'s light probe still matches because the light branch is unchanged.

In `tuiIntentResolver`, change the `filled` branch's `color` to `"light-dark(var(--bg), #ffffff)"` and replace the tail

```ts
  const weight = toneWeightFor(variant, intent);
  if (weight === undefined) return result;

  return { ...result, color: retunedTextColor(tone, variant, intent) };
```

with

```ts
  const color = retunedTextColor(tone, variant, intent);
  return color === tone ? result : { ...result, color };
```

Update the header comment above `LIGHT_VARIANT_TONE_WEIGHT` so its last paragraph reads: "N per intent was chosen by measurement against the light palette (each variant's real background). Dark takes the solved text tokens below instead of a mix."

- [ ] **Step 3: Run the resolver test, then codegen**

Run: `cd packages/tui-kit && bunx vitest run --project node test/intent-resolver.test.ts && bun run codegen && git diff --stat src/generated/theme.css`
Expected: PASS; `theme.css` does not change. The resolver's strings are applied at render time as inline custom properties (`autoVars`), not baked into the generated stylesheet, so the codegen run is only a check that nothing else moved.

- [ ] **Step 4: Run the matrix in both schemes**

Run: `cd packages/tui-kit && bun run build && bunx vitest run --project browser src/recipes/Button/Button.matrix.test.tsx`
Expected: PASS in dark with no ledger entry; light unchanged. If a dark cell still fails, the message prints `fg`, `bg`, `backdrop` and `ratio`; the fix is in `intent-resolver.ts` (a wrong tone for that variant/intent) or, for `default|bad`, in `Button.tsx`, never a new ledger entry. If a light ledger cell now clears 4.5 (the message says `cleared MIN_CONTRAST; remove this cell's entry`), remove that entry: the ratchet allows removal.

- [ ] **Step 5: Run the rest of the browser tier and refresh dark baselines**

Run: `cd packages/tui-kit && bunx vitest run --project browser --exclude '**/*.visual.test.tsx' --exclude '**/*.parity.test.tsx'`
Expected: PASS. `Chip.test.tsx` and `Button.test.tsx` build their expected probes from `retunedTextColor`, so they follow the retune.

Then refresh every recipe's visual baselines, which are local-only (CI excludes `*.visual.test.tsx`) and all moved in dark with the new seeds, and some in Task 2 with the muted-text re-alias:

`cd packages/tui-kit && bunx vitest run --project browser visual -u`

Look at the regenerated `button-grid-dark` PNG before committing: labels on filled buttons are white, outline and subtle text is the brighter solved tone. Skim the other dark baselines for anything that is not a hue change (a layout shift is a defect, a colour shift is expected). `Button.parity.test.tsx` is also excluded from CI and its oracle predates the arcade palette; leave it alone and say so in the report.

- [ ] **Step 6: Regenerate deck, run the app suites, commit**

```bash
cd apps/deck && bun run build:board && cd ../..
bun run board:test && bun run chat:test && bun run console:test
scripts/repo-purity.sh
git add packages/tui-kit apps/deck/core/generated
git commit -m "tui-kit: dark buttons read the solved hue text tokens; filled labels white in dark"
```

Open one PR for Tasks 6 and 7 together.

---

## Part D: bound tui-kit provider (spec §9 step 3)

### Task 8: `TuiKitProvider`

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

### Task 9: Storybook wiring for both kits

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

### Task 10: Reference catalogue stories

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

const BAR = [7.0, 4.5, 5.5, 7.0] as const;
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

import { HUES } from '@mattstack/tokens';

import { Ratio, scheme, Swatch, TwoSchemes } from './catalogue';

function Palette() {
  return (
    <TwoSchemes
      render={name => {
        const t = scheme(name);
        const worst = t.surfaceRamp[name === 'light' ? 3 : 0];
        return (
          <>
            {HUES.map(hue => (
              <div key={hue} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                <Swatch hex={t.hue[hue]} label={`fill-${hue}`} textOn="#ffffff">
                  <span>
                    vs surfaces: <Ratio fg={t.hue[hue]} bg={worst} bar={3.0} />
                  </span>
                </Swatch>
                <div style={{ background: t.surface.card, color: t.hueText[hue], padding: 12, borderRadius: 6, display: 'grid', gap: 4 }}>
                  <strong>text-{hue}</strong>
                  <code>{t.hueText[hue]}</code>
                  <span>
                    Aa body <Ratio fg={t.hueText[hue]} bg={worst} bar={4.5} />
                  </span>
                </div>
                <div style={{ background: t.surface.card, color: t.hueTextSmall[hue], padding: 12, borderRadius: 6, fontSize: 11.9, display: 'grid', gap: 4 }}>
                  <strong>text-{hue}-small</strong>
                  <code>{t.hueTextSmall[hue]}</code>
                  <span>
                    Aa small <Ratio fg={t.hueTextSmall[hue]} bg={worst} bar={7.0} />
                  </span>
                </div>
              </div>
            ))}
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

export const FillBodySmall: StoryObj<typeof meta> = {};
```

The three light fills the spec keeps under 3.0 (`ok`, `warn`, `cyan`) render their ratio in red here on purpose; the story is the visible ledger.

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
Expected: clean. Then `bun run storybook` and open `Tokens/Palette`; the three ratios in red are exactly light `fill-ok`, `fill-warn`, `fill-cyan` and nothing else. Take a screenshot of each story in each scheme and attach the paths to the task report.

- [ ] **Step 8: Commit**

```bash
git add stories/ramps
git commit -m "storybook: tokens reference catalogue (surfaces, text, lines, palette, type)"
```

### Task 11: Specimen wall for both kits

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

### Task 12: Ramp contrast matrix with a fill ledger

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
    hue: "ok",
    scheme: "light",
    measuredRatio: 2.106,
    reason: "locked arcade hex; a light ok fill alone must not carry meaning",
  },
  {
    hue: "warn",
    scheme: "light",
    measuredRatio: 2.149,
    reason: "locked arcade hex; a light warn fill alone must not carry meaning",
  },
  {
    hue: "cyan",
    scheme: "light",
    measuredRatio: 2.156,
    reason: "locked arcade hex; a light cyan fill alone must not carry meaning",
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
const TEXT_BAR: Record<number, number> = { 1: 7.0, 2: 4.5, 3: 5.5, 4: 7.0 };
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
          if (s === (scheme === "light" ? 4 : 1)) {
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

The ledger's `measuredRatio` is the worst surface (light `surface-4`, dark `surface-1`), so the "cleared the bar, remove the entry" check runs only on that surface; the floor check runs on all four.

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

### Task 13: Classifier and the TSX rule

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

### Task 14: The CSS rule

**Files:**
- Create: `packages/ui/presets/eslint-local/token-namespaces-css.js` and `token-namespaces-css.d.ts` (same two-line shape as `token-namespaces-tsx.d.ts`)
- Modify: `packages/ui/presets/eslint-local/token-namespaces.test.ts`, `eslint.config.js`, root `package.json`

**Interfaces:**
- Consumes: `classifyTokenUse` from Task 13.
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
| §3 surfaces, inset/overlay snap | 1, 2, 3 |
| §4 two layers, semantic roles, `--page` | 1 (roles by index), 2 (aliases) |
| §5 text ramp, bars, margins at full precision | 1 (invariants), 12 (gate) |
| §6 type bars | 10 (Type story), 12 (bars per text step) |
| §7 palette, fill = seed, hue text tokens, light-fill decision default | 1, 2, 3, 12 (fill ledger) |
| §7.1 dark hue correction, ramps first | 5 then 6, 7 |
| §7.2 lines, per-scheme mapping, card scope | 1, 2 (`--border-on-card` = light-dark(line-1, line-2) by derivation) |
| §8.1 namespaces | 13, 14 |
| §8.2 bound provider | 8 |
| §9 step 0 aliases (`--muted-text` per scheme, `--text-muted-on-card`) | 1 (`textRole`) |
| §9 step 1 generator in tokens/scripts writing tokyo/src/ramps.ts, asserts | 4, 5 |
| §9 step 2 resolver retune dark-only, no dark ledger entries | 7 |
| §9 step 3 storybook decorator, tui-kit theme.css, build order | 9, 10, 11 |
| §9 step 4 gate on the vitest browser project, ledger shape widened | 12 |
| §9 step 5 lint before migration | 13, 14 (board at `warn`) |
| §9.1 measurement helpers | 12 uses `@soribashi/core/testing`; 10 uses tokens' math for pure hex values |

Not in this plan, by the spec's own sequencing: the apps-wide migration onto the new names (the 154 `--muted` classifications, the `--gate-*` block deletion, the light outline/subtle retune) follows after Task 14 lands.

Type consistency checked: `HUES`, `HueName`, `Ramp3`, `Ramp4`, `surfaceRole/textRole/lineRole` (Task 1) are what Tasks 2, 3, 5, 10 read; `TuiKitProvider` (Task 8) is what Tasks 9, 11, 12 import; `FILL_DEBT_BY_KEY` / `fillDebtKey` (Task 12) match their own use; `classifyTokenUse` (Task 13) is what Task 14 imports.
