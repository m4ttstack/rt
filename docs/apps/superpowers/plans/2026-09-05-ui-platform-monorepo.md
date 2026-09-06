# UI Platform Monorepo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge tui-kit into the app-kit workspace and add an internal tokens package both kits generate from, so a brand change is one PR guarded by drift gates.

**Architecture:** Three phases. Phase 1 is mechanics with zero published behavior change: subtree-add tui-kit, bring up `packages/tokens` (literal data + invariant tests), and wire codegen so both kits' shipped values are generated from tokens, proven value-identical by diff gates. Phase 2 is the one behavior-changing release: smoothing fragments into both kits, text-token conformance, fg #222, the red text token. Phase 3 is consumer cleanup in the five app repos, gated on Matt's hand npm publish.

**Tech Stack:** Bun workspaces, TypeScript, vitest, soribashi codegen (tui-kit), git subtree.

**Spec:** `docs/superpowers/specs/2026-09-05-ui-platform-monorepo-design.md`

## Global Constraints

- The tokens package is `private: true` and never published; published kits must not import it at runtime. Values reach kits only through checked-in generated files.
- Phase 1 must be value-identical: after every Phase 1 task, `git diff` on any shipped kit file shows only mechanical restructuring, never a changed CSS value. The diff gates prove it.
- Phase 2 value changes (exhaustive): light `fg` #111 -> #222 in both kits; new red text token #c8214f (light) / #f7768e (dark); tui-kit `text.muted` re-points to the mutedText value; the smoothing fragment appears in both kits' stylesheets. Nothing else changes value.
- SORI-36 ordering: smoothing and text darkening ship in the same lockstep release (Phase 2 is one release).
- Never use em dashes in any authored text. Comments follow clean-code rules (no process references, no narration).
- Working tree: execute in an rt-provisioned worktree of app-kit (`rt worktree provision`), not the canonical checkout. Phase 3 tasks run in worktrees of their own repos.
- Publishing to npm is Matt's manual step. Nothing in this plan automates a publish; Phase 3 cannot start until Matt has published the Phase 2 lockstep versions.

## Canonical token data (used by Tasks 2-4; single source for this plan)

Every value below is verified against `packages/tokyo/src/tokyo-theme.css` and `tui-kit/src/theme.ts` as of 2026-09-05; the two agree on all shared values today.

| token | light | dark |
|---|---|---|
| hue.accent | #2e7de9 | #7aa2f7 |
| hue.ok | #587539 | #9ece6a |
| hue.bad | #f52a65 | #f7768e |
| hue.warn | #8c6c3e | #e0af68 |
| hue.purple | #7847bd | #bb9af7 |
| hue.cyan | #007197 | #7dcfff |
| text.fg | #111 (Phase 2: #222) | #e3e7f6 |
| text.muted (raw fill/dot value) | #8990b3 | #7e86ad |
| text.mutedText | #565d80 | #969ec2 |
| text.accentText | #1c5fbf | #7aa2f7 |
| text.redText (Phase 2 only) | #c8214f | #f7768e |
| surface.chrome | #f3f4f7 | #232a47 |
| surface.bg | #f7f8fa | #16161e |
| surface.panel | #fbfbfc | #232a47 |
| surface.card | #ffffff | #2c3352 |
| line.border | #c8cad6 | #3b4261 |
| line.soft | #d5d7e2 | #313853 |
| line.grid | rgba(52, 59, 88, 0.05) | rgba(122, 162, 247, 0.06) |
| dot.ok | #1f9d3a | #4ade5b |
| dot.warn | #e08a00 | #ffbb3d |
| dot.bad | #e5153f | #ff5c72 |
| wash (tokyo alpha) | 10% | 15% |

Fonts: mono `"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`; sans `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`; base size `13.5px`; line height `1.55`.

---

## Phase 1: mechanics, value-identical

### Task 1: Subtree-add tui-kit into the workspace

**Files:**
- Create: `packages/tui-kit/**` (via git subtree from `~/Documents/GitHub/tui-kit`, branch `main`)
- Modify: `package.json` (root: workspaces, scripts), `packages/tui-kit/package.json` (drop nested `workspaces`), root eslint config (ignore `packages/tui-kit`), `.github/workflows/ci.yml`
- Delete: `packages/tui-kit/.github/` (after porting its steps)

**Interfaces:**
- Produces: `@mattstack/tui-kit` as a workspace member; root scripts `tui-kit:build`, `tui-kit:test`, `tui-kit:gates` that later tasks and CI call.

- [ ] **Step 1: Subtree add**

```bash
cd <worktree-root>
git subtree add --prefix packages/tui-kit ~/Documents/GitHub/tui-kit main
```

- [ ] **Step 2: Workspace wiring**

In `packages/tui-kit/package.json` remove the `"workspaces": ["workshop"]` field. In root `package.json` add `"packages/tui-kit/workshop"` to `workspaces` (root already globs `packages/*`, which picks up tui-kit itself). Add root scripts:

```json
"tui-kit:build": "cd packages/tui-kit && bun run build",
"tui-kit:test": "cd packages/tui-kit && bun run test",
"tui-kit:gates": "cd packages/tui-kit && bun run gates"
```

If `bun install` chokes on the workshop member, fall back to removing `packages/tui-kit/workshop` from workspaces and leave workshop with its own install (its `dev:workshop` script already cds in); record which path was taken in the commit message.

- [ ] **Step 3: Install and verify member health**

```bash
bun install
bun run tui-kit:build && bun run tui-kit:test && bun run tui-kit:gates
```

Expected: all green, `git status` clean apart from lockfile and the edits above.

- [ ] **Step 4: Keep root gates green**

Add `packages/tui-kit` to the root eslint ignores (tui-kit has its own lint conventions). Run `bun run typecheck` (the `--filter '@mattstack/*'` now includes tui-kit; its own `typecheck` script must pass from the root), `bun run lint`, `bun run format:check` (add `packages/tui-kit` to `.prettierignore` if its formatting differs), `bun run test -- --run` (must not swallow tui-kit's vitest browser projects; if root vitest globs them, exclude `packages/tui-kit` in the root vitest config since `tui-kit:test` owns them).

- [ ] **Step 5: CI**

Port the job steps from `packages/tui-kit/.github/workflows/*.yml` into `.github/workflows/ci.yml` as three appended steps (`tui-kit:build`, `tui-kit:gates`, `tui-kit:test`, plus any playwright browser install its workflow performs before tests). Then `git rm -r packages/tui-kit/.github`.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "monorepo: absorb tui-kit as a workspace member"
```

### Task 2: tokens package with invariant tests

**Files:**
- Create: `packages/tokens/package.json`, `packages/tokens/src/values.ts`, `packages/tokens/src/color-math.ts`, `packages/tokens/vitest.config.ts`, `packages/tokens/test/invariants.test.ts`, `packages/tokens/tsconfig.json` (copy the shape of `packages/server/tsconfig.json`)
- Modify: root `package.json` (scripts), `.github/workflows/ci.yml`

**Interfaces:**
- Produces: `import { TOKENS } from '@mattstack/tokens'` for sibling-package tests and scripts only. Shape: `TOKENS.light` / `TOKENS.dark`, each `{ hue: {accent, ok, bad, warn, purple, cyan}, text: {fg, muted, mutedText, accentText}, surface: {chrome, bg, panel, card}, line: {border, soft, grid}, dot: {ok, warn, bad}, wash: string }`, plus `TOKENS.font = { mono, sans, baseSize, lineHeight }`. All string values, exactly the canonical table above (Phase 1 values: fg #111, no redText).
- Produces: `srgbLuminance(hex: string): number` and `contrastRatio(a: string, b: string): number` from `src/color-math.ts`.

- [ ] **Step 1: Package skeleton**

```json
{
  "name": "@mattstack/tokens",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "exports": { ".": "./src/values.ts" },
  "scripts": { "typecheck": "tsc -p tsconfig.json", "test": "vitest run" }
}
```

- [ ] **Step 2: Write the failing invariant tests first**

`test/invariants.test.ts`, real assertions:

```ts
import { describe, expect, it } from 'vitest';
import { contrastRatio, srgbLuminance } from '../src/color-math.ts';
import { TOKENS } from '../src/values.ts';

const SCHEMES = ['light', 'dark'] as const;

describe('surface ladder', () => {
  it.each(SCHEMES)('%s: bg < panel < card by luminance direction', scheme => {
    const s = TOKENS[scheme].surface;
    const [bg, panel, card] = [s.bg, s.panel, s.card].map(srgbLuminance);
    expect(bg).toBeLessThan(panel);
    expect(panel).toBeLessThan(card);
  });
});

describe('AA floors for text-role tokens', () => {
  const surfaces = ['chrome', 'bg', 'panel', 'card'] as const;
  it.each(SCHEMES)('%s: fg, mutedText, accentText clear 4.5:1 on every surface', scheme => {
    const t = TOKENS[scheme];
    for (const roleName of ['fg', 'mutedText', 'accentText'] as const) {
      for (const surface of surfaces) {
        const ratio = contrastRatio(t.text[roleName], t.surface[surface]);
        expect(ratio, `${scheme} ${roleName} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
```

`src/color-math.ts`:

```ts
export function srgbLuminance(hex: string): number {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const [r, g, b] = [0, 2, 4].map(i => {
    const c = parseInt(full.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [la, lb] = [srgbLuminance(a), srgbLuminance(b)];
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
```

- [ ] **Step 3: Run to verify failure** (`values.ts` absent)

```bash
cd packages/tokens && bun run test
```

Expected: FAIL, cannot resolve `../src/values.ts`.

- [ ] **Step 4: Write `src/values.ts`** with exactly the canonical table's Phase 1 values (fg `#111111`, no redText; note `#111` three-digit form must be written `#111111` so color-math and later emitters agree on one canonical spelling, and the tokyo emitter in Task 4 must then print the exact string the CSS file uses today, `#111`, via a per-token `cssText` override field: `{ value: '#111111', cssText: '#111' }` for that one token).

- [ ] **Step 5: Run tests to verify pass**

Expected: PASS (mutedText/accentText/fg all clear 4.5:1 today; raw muted/accent are fill tokens and carry no AA duty, which is the fill/text split the spec mandates).

- [ ] **Step 6: Wire root + CI, commit**

Root scripts `"tokens:test": "cd packages/tokens && bun run test"`; CI step after the existing test step. `git add -A && git commit -m "tokens: package skeleton, canonical values, ladder and AA invariants"`.

### Task 3: Codegen into tui-kit, value-identical

**Files:**
- Create: `packages/tokens/scripts/generate.ts`, `packages/tui-kit/src/generated/tokens.ts` (generated, checked in)
- Modify: `packages/tui-kit/src/theme.ts` (import generated values), root `package.json` (script `tokens:codegen`), `.github/workflows/ci.yml` (codegen drift gate)

**Interfaces:**
- Consumes: `TOKENS` from Task 2.
- Produces: `packages/tui-kit/src/generated/tokens.ts` exporting `GENERATED_LIGHT_COLORS` and `GENERATED_DARK_COLORS`, shaped exactly like `tuiTheme.tokens.colors` / `TUI_DARK_COLORS` in today's `theme.ts` (`blue/green/red/amber/purple/cyan: { "500" }`, `gray: { fg, muted }`, `surface: { bg, panel, card, chrome }`, `line: { border, soft, grid }`, `dot: { ok, warn, bad }`), plus `GENERATED_FONT_FAMILY` (`{ mono, sans }`) and `GENERATED_LINE_HEIGHT_BASE`.
- Produces: root script `bun run tokens:codegen` that later tasks extend.

- [ ] **Step 1: Write `generate.ts`** mapping TOKENS onto the tui-kit shape (hue.accent -> blue.500, hue.ok -> green.500, hue.bad -> red.500, hue.warn -> amber.500, text.fg -> gray.fg, text.muted -> gray.muted, surfaces/lines/dots one-to-one) and writing `src/generated/tokens.ts` with a `/* GENERATED by packages/tokens; do not edit. */` header. Print exact literal strings from the tokens data (use `cssText ?? value`).

- [ ] **Step 2: Re-point `theme.ts`**: replace the literal objects inside `tuiTheme.tokens.colors`, `TUI_DARK_COLORS`, `fontFamily`, and `lineHeight.base` with the generated imports. Keep every non-color scale (radius, spacing, fontSize, shadow) untouched.

- [ ] **Step 3: Prove value identity**

```bash
bun run tokens:codegen && bun run tui-kit:gates
```

Expected: gates PASS, and specifically `git diff --exit-code packages/tui-kit/src/generated/theme.css` shows the soribashi output byte-unchanged. If any byte differs, the emitter mapping is wrong; fix the emitter, never the CSS.

- [ ] **Step 4: Drift gate in CI**: add a step running `bun run tokens:codegen && git diff --exit-code packages/tui-kit/src/generated packages/tokyo/src` after install.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "tokens: generate tui-kit color and font values, value-identical"
```

### Task 4: Codegen into tokyo, value-identical

**Files:**
- Modify: `packages/tokens/scripts/generate.ts` (add tokyo emitter), `packages/tokyo/src/tokyo-theme.css` (marker comments around the two scheme blocks)
- Create: `packages/tokens/test/ramp-anchors.test.ts`

**Interfaces:**
- Consumes: `TOKENS`, `tokyoRamps` (via relative import `../../tokyo/src/ramps.ts`).
- Produces: the two `--tk-*` scheme blocks in `tokyo-theme.css` are regenerated between `/* BEGIN GENERATED: tokyo tokens light */` ... `/* END GENERATED */` markers (and the dark twin). Everything else in the file stays hand-authored.

- [ ] **Step 1: Insert markers** immediately inside `:root[data-mantine-color-scheme='light'] {` and the dark block, wrapping only the custom-property declarations (the explanatory comments above the blocks stay outside).

- [ ] **Step 2: Extend `generate.ts`** to render the declarations from TOKENS in the file's existing order (`--tk-chrome` through `--tk-wash`, mapping text.mutedText -> `--tk-muted-text`, text.accentText -> `--tk-accent-text`, hue.ok -> `--tk-green`, hue.bad -> `--tk-red`, hue.warn -> `--tk-amber`, wash -> `--tk-wash`) and splice them between the markers, preserving each block's existing inline comments by keeping them in the emitter template verbatim.

- [ ] **Step 3: Prove value identity**

```bash
bun run tokens:codegen && git diff --exit-code packages/tokyo/src/tokyo-theme.css
```

Expected: no diff. Tune the emitter until byte-identical.

- [ ] **Step 4: Ramp anchor test** (`test/ramp-anchors.test.ts`):

```ts
import { describe, expect, it } from 'vitest';
import { tokyoRamps } from '../../tokyo/src/ramps.ts';
import { TOKENS } from '../src/values.ts';

const ANCHORS = [
  ['accent', 'accentDay', 'accentNight'],
  ['ok', 'okDay', 'okNight'],
  ['bad', 'badDay', 'badNight'],
  ['warn', 'warnDay', 'warnNight'],
  ['purple', 'purpleDay', 'purpleNight'],
  ['cyan', 'cyanDay', 'cyanNight'],
] as const;

describe('tokyo ramps anchor on the canonical hues', () => {
  it.each(ANCHORS)('%s', (hue, day, night) => {
    expect(tokyoRamps[day][6]).toBe(TOKENS.light.hue[hue]);
    expect(tokyoRamps[night][4]).toBe(TOKENS.dark.hue[hue]);
  });
});
```

Run: expected PASS (shade 6 light / shade 4 dark are the documented primary shades in `ramps.ts`).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "tokens: generate tokyo scheme blocks between markers, anchor-test the ramps"
```

### Task 5: Consumption and font gates

**Files:**
- Create: `packages/tokens/test/consumption.test.ts`, `packages/tokens/test/font-identity.test.ts`, `packages/tokens/assets/jetbrains-mono.woff2` (copied from `packages/tokyo/src/fonts/jetbrains-mono.woff2`)

**Interfaces:**
- Consumes: generated files from Tasks 3-4; tui-kit's shipped CSS surfaces.

- [ ] **Step 1: Consumption test.** For tokyo: every `--tk-*` name defined in `tokyo-theme.css` must be referenced at least once beyond its definition, searching `packages/tokyo/src/**/*.css` plus `packages/ui/src/**/*.{ts,tsx,css}`. For tui-kit: every emitted CSS custom property in `src/generated/theme.css` must appear in `src/recipes/**/*.module.css`, `src/canvas.css`, or elsewhere in the generated file's own rules; names that are deliberately definition-only go in an explicit `WAIVED` list in the test file with a one-line reason each (seed it empty and let the first run's failures populate it deliberately). Real skeleton:

```ts
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const WAIVED_TUI: Record<string, string> = {};
const WAIVED_TOKYO: Record<string, string> = {};

function definedVars(css: string): string[] {
  return [...css.matchAll(/^\s*(--[a-z0-9-]+):/gim)].map(m => m[1]);
}
```

(then a walker over the named globs and one `it` per kit asserting each defined var is consumed or waived).

- [ ] **Step 2: Run, triage, waive deliberately.** Every failure is either a real dead token (delete it in the kit) or a justified definition-only name (waive with reason). `--font-sans` class defects surface here by design.

- [ ] **Step 3: Font copy + identity test**: extend `generate.ts` to copy `packages/tokens/assets/jetbrains-mono.woff2` into `packages/tokyo/src/fonts/` and `packages/tui-kit/assets/fonts/` (tokens is the source; the kit copies are generated), then a test reads the three woff2 files and asserts buffer equality.

- [ ] **Step 4: Run all tokens tests, expect PASS, commit**

```bash
git add -A && git commit -m "tokens: consumption and font byte-identity gates"
```

Phase 1 complete: publishable packages are byte-identical to their pre-monorepo releases.

---

## Phase 2: conformance, one release train

### Task 6: Smoothing fragments into both kits

**Files:**
- Create: `packages/tokens/src/fragments.ts`, `packages/tokens/test/fragment-sync.test.ts`
- Modify: `packages/tokens/scripts/generate.ts`, `packages/tui-kit/src/generated/theme.css` (generated), `packages/tui-kit/package.json` (codegen chain), `packages/tokyo/src/tokyo-theme.css` (generated appendix)

**Interfaces:**
- Produces: `renderFontSmoothing(): string` returning exactly:

```css
/* BEGIN GENERATED: base rules (font smoothing) */
body {
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
/* END GENERATED: base rules (font smoothing) */
```

- [ ] **Step 1: Fragment module + sync test.** `fragment-sync.test.ts` reads both kits' stylesheets, extracts between the BEGIN/END markers (same extraction approach as `expectLoadingBarInSync` in `packages/ui/src/test-utils`), and asserts byte-equality with `renderFontSmoothing()`. Run: FAIL (markers absent).

- [ ] **Step 2: Emit.** `generate.ts` appends the fragment to `packages/tokyo/src/tokyo-theme.css` (after the existing `body` rule; the kit's own body rule keeps background/type, the fragment carries only smoothing) and tui-kit's codegen chain gains the append: change tui-kit's `codegen` script to `soribashi build && bun run scripts/append-font-faces.ts && bun run ../tokens/scripts/append-fragments.ts` where `append-fragments.ts` is a thin caller of the tokens fragment renderer targeting `src/generated/theme.css`. The fragment lands in `theme.css` (the export every consumer loads), never `canvas.css`.

- [ ] **Step 3: Regenerate, run fragment-sync + gates, expect PASS.** The tui-kit theme.css diff now intentionally changes; this is Phase 2's first behavior change.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "tokens: font-smoothing fragment shipped by both kits (SORI-34, MANKIT-2)"
```

### Task 7: Value conformance (fg #222, red text, tui-kit text roles)

**Files:**
- Modify: `packages/tokens/src/values.ts`, `packages/tokens/test/invariants.test.ts` (redText joins the AA roles), `packages/tui-kit/src/theme.ts`, generated files via codegen, `packages/tokyo/src/tokyo-theme.css` (generated blocks pick up new values; hand-add the `--tk-red-text` consumption in the `--mantine-color-error`-style scheme block only if packages/ui adopts it now, else waive with reason)

**Interfaces:**
- Produces: `TOKENS.*.text.redText`; tui-kit semantic slots `text.mutedText`, `text.accentText`, `text.badText` emitting `--muted-text`, `--accent-text`, `--red-text` custom properties for consumers.

- [ ] **Step 1: Update tokens values**: light `fg` -> `#222222` (cssText `#222`), add `redText` `#c8214f` / `#f7768e`. Extend the AA test's role list to include `redText`. Run tokens tests: PASS required before anything regenerates.
- [ ] **Step 2: tui-kit text roles**: in `theme.ts`, add `gray: { mutedText }` (and dark twin) to the generated color consumption, re-point `semanticTokens.text.muted` from `colors.gray.muted` to the mutedText value, and add semantic text slots for accentText/redText. `colors.gray.muted` stays for dots, washes, and borders. Before choosing slot keys, check how soribashi kebab-cases a semantic key into its emitted custom-property name (read `@soribashi/core`'s emit code or an existing two-word key's output) and pick keys that emit exactly `--muted-text`, `--accent-text`, `--red-text`; if soribashi cannot produce those names, the alias contract in `theme.css` gains them as plain aliases instead, the way `--chrome` was added.
- [ ] **Step 3: Regenerate everything** (`bun run tokens:codegen`, tui-kit `codegen`); commit the changed generated files. The tokyo value-identity gate from Task 4 now asserts the NEW generated content matches the emitter (the byte-compare is against the emitter output, so it stays green by construction; the explicit value change is visible in the git diff of this commit, which is the review surface).
- [ ] **Step 4: Update the consumption waivers**: mutedText/accentText/redText must now be consumed in tui-kit (the semantic slots consume them); remove any Phase 1 waivers that no longer apply.
- [ ] **Step 5: Run the full root suite** (`typecheck`, `lint`, `test -- --run`, `tui-kit:gates`, `tui-kit:test`, `tokens:test`, `build-storybook`, `treeshake`, `probe:*`). All green.
- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "tokens: fg #222 estate-wide, red text token, tui-kit text-role conformance (SORI-36)"
```

### Task 8: Lockstep version alignment

**Files:**
- Create: `scripts/set-platform-version.ts`
- Modify: the four published `package.json` files, `packages/ui/package.json` peer range on `@mattstack/mantine-tokyo`, `README.md` (one paragraph: tui-kit lives here now; tokens is internal), `CLAUDE.md` (consumer repo notes are stale: chat has migrated; packages are on npm)

**Interfaces:**
- Produces: `bun scripts/set-platform-version.ts 0.3.0` sets `version` in packages/{ui,server,tokyo,tui-kit}/package.json and rewrites `@mattstack/mantine-tokyo` peer in packages/ui to `^0.3.0`.

- [ ] **Step 1: Write the script** (read each package.json, set version, rewrite the internal peer, print a summary table). Run it with `0.3.0`.
- [ ] **Step 1b: Peer floor hygiene**: in `packages/server/package.json`, widen the `@mattstack/rt-client` peer from `^0.14.0` to `>=0.14.0` (rt-client is on 0.16.0 and consumers pin it exactly; the caret guarantees mismatch warnings every minor). Bump the root devDep to `^0.16.0` while there.
- [ ] **Step 2: Docs pass** (README paragraph, CLAUDE.md staleness fixes).
- [ ] **Step 3: Full root suite green, commit**

```bash
git add -A && git commit -m "release: platform 0.3.0 lockstep versions and docs"
```

- [ ] **Step 4: HARD GATE: Matt publishes** the four packages by hand (`matt:npm-publish` skill covers the OTP). Phase 3 is blocked until the versions resolve on npm.

---

## Phase 3: consumer cleanup (each task in its own repo worktree, gated on the Phase 2 publish)

Each task: bump the `@mattstack/*` KIT deps to the platform version, delete the local copy the kit now ships, verify with that repo's own suite, commit. Never touch `@mattstack/rt-client` (board and console pin it exactly, `"0.16.0"` as of 2026-09-06, on purpose), `@mattstack/glance`, or `@mattstack/settings-kit`. Exact locations verified 2026-09-06 (re-grep before editing; files move; board's style.css gained a gate-card block around lines 690-760 with additional `var(--accent)`/`var(--muted)` text sites for Task 9's swap).

### Task 9: board

**Files:** `~/Documents/GitHub/board` worktree; `package.json`, `src/style.css`

- [ ] Bump `@mattstack/tui-kit` to the platform version; `bun install`.
- [ ] Delete the `:root` override block (`src/style.css` ~41-46: `--color-gray-fg`, `--color-gray-muted`, `--color-blue-500`, `--color-red-500` and its comment) and the local smoothing rule (~52-57).
- [ ] Text-role swap: for every declaration in `src/style.css` where `var(--muted)`, `var(--accent)`, or `var(--red)` is the value of a `color:` property on TEXT (not a background, border, fill, or dot), switch to `var(--muted-text)` / `var(--accent-text)` / `var(--red-text)`. Fill and dot usages keep the raw tokens. This is judgment work per declaration; the SORI-36 measurements (4.5:1 on chrome/bg/panel/card) are the acceptance bar, checked with the contrast math from tokens or a browser audit.
- [ ] `bun run typecheck && bun test && bun run capture:compare` (captures will move where text darkened; re-baseline deliberately with `capture:baseline` after eyeballing).
- [ ] Commit: `conform to platform 0.3.0: kit-shipped smoothing and text tokens; overrides deleted`.

### Task 10: deck

**Files:** `~/Documents/GitHub/deck` worktree; `package.json`, `core/board/board.css`

- [ ] Bump `@mattstack/tui-kit`; `bun install`.
- [ ] Delete the smoothing declarations and their comment from the `body` rule (`core/board/board.css` ~14-20), keeping the rule's `margin`/`background` lines.
- [ ] `bun run test` and `bun run capture:compare`; commit.

### Task 11: chat

**Files:** `~/Documents/GitHub/chat` worktree; `package.json`, `src/app/styles/type-scale.css`

- [ ] Bump `@mattstack/app-kit`, `@mattstack/mantine-tokyo` (and `@mattstack/app-server` if its version moved); `bun install`.
- [ ] Delete the smoothing pair and its delete-when-tokyo-ships-it comment (`type-scale.css` ~44-45).
- [ ] `bun run typecheck && bun run test -- --run && bun run lint`; commit.

### Task 12: console

**Files:** `~/Documents/GitHub/console` worktree; `package.json`, `index.html`

- [ ] Bump the three `@mattstack` kit packages; `bun install`.
- [ ] Remove the smoothing declarations from the inline `<style>` block (`index.html` ~84-85); if the block held only those, remove the block. The adjacent loading-bar region is byte-compared by `loading-bar-sync.test.ts`; do not touch it.
- [ ] `bun run typecheck && bun run test -- --run`; commit.

### Task 13: boxscore

**Files:** `~/Documents/GitHub/boxscore` worktree; `package.json`

- [ ] Bump the kit packages; `bun install`; `bun run typecheck && bun run test`; commit. (No local copies to delete.)

---

## Verification summary

- Phase 1 exit: root CI green including the new codegen drift gate, tui-kit suite green from the root, and a manual `npm pack --dry-run`-equivalent check that `packages/tokyo` and `packages/tui-kit` publish outputs are byte-identical to their latest npm releases apart from the generated-file headers.
- Phase 2 exit: full root suite green; the release diff shows exactly the Global Constraints value list and nothing else; Matt eyeballs light scheme in a real browser (headless renders greyscale, so captures cannot verify smoothing).
- Phase 3 exit: each consumer's own suite green; board re-baselined captures reviewed by eye.
