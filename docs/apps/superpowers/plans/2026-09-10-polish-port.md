# Polish Port to tokens + tui-kit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the decision-queue polish (contrast roles, button tiers, scroll pane, type roles) from `apps/board/src/style.css` into `packages/tokens` + `packages/tui-kit`, then move the board onto the shared versions and delete its duplicated CSS.

**Architecture:** Colors originate in `packages/tokens/src/values.ts` and flow through `packages/tokens/scripts/generate.ts` into tui-kit's `src/generated/tokens.ts` and tokyo's `--tk-*` splice blocks; tui-kit's `codegen` script (`soribashi build` off `src/theme.ts` + `soribashi.config.ts`) emits `src/generated/theme.css`. Button colors resolve at runtime via `src/intent-resolver.ts`. This plan adds leaves/roles at each layer, one new recipe (ScrollPane), then swaps the board's gate buttons and context pane onto the kit.

**Tech Stack:** Bun workspaces, TypeScript, React 19, `@soribashi/core` (defineComponent/theme/codegen), vitest (node + browser-playwright projects with screenshot baselines), bun:test (board).

**Spec:** `docs/superpowers/specs/2026-09-10-polish-port-design.md` (read it first; it pins every value and the three accepted visible deltas).

## Global Constraints

- Values are verbatim from the spec tables; nothing may be rounded, re-derived, or "cleaned up".
- Never edit generated files by hand: `packages/tui-kit/src/generated/*` and the tokyo `--tk-*` splice blocks change only via `bun run --cwd packages/tokens generate` (i.e. `bun packages/tokens/scripts/generate.ts`) and `bun run codegen` (tui-kit). Committing regenerated output alongside its source change is required (CI byte-compares).
- Public repo: `scripts/repo-purity.sh` must stay green; no personal paths, tokens, or internal URLs in any committed file.
- No em dashes or en dashes in any authored text (code comments, commit messages, docs). Use "..." or parentheses.
- Comments state constraints only; never task numbers, review findings, or decision history in source. Decision records go in reports.
- No new dependencies; catalog rules in root `package.json` are untouched.
- Never run `git stash`. Never run `bun install` scoped to a workspace member.
- This session's worktree Bash guard refuses compound commands (`&&`, heredocs, `git -C`, loops): one plain command per Bash call. It applies to subagents too.
- tui-kit exports `dist/`, so `bun run tui-kit:build` (root) must run before any board typecheck/test/build.
- Screenshot baselines regenerate only where a task says so; an unexplained changed screenshot is a defect.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/tokens/src/values.ts` | +4 `ColorScheme` leaves (the contrast roles) |
| `packages/tokens/scripts/generate.ts` | emit the new leaves to tui-kit consts + tokyo `--tk-*` |
| `packages/tokens/test/invariants.test.ts` | contrast/luminance invariants for the new roles |
| `packages/tui-kit/src/theme.ts` | semantic tokens (on-card roles, inset, fg-4-card wash), `fontSize.rem62`, `spacing.rem95`, `lineHeight.snug`, variant vocabulary +`filled` |
| `packages/tui-kit/soribashi.config.ts` | `--type-*` role aliases |
| `packages/tui-kit/src/intent-resolver.ts` | filled patch + pinned tier cells |
| `packages/tui-kit/src/recipes/Button/Button.module.css` | `size="lg"` geometry, filled weight |
| `packages/tui-kit/src/recipes/ScrollPane/*` | new recipe (root/head/body) |
| `packages/tui-kit/src/a11y/matrix-classification.ts` | ScrollPane exempt entry |
| `packages/tui-kit/src/index.ts` | ScrollPane exports |
| `packages/tui-kit/test/theme.test.ts` | emitted-vars assertion for the new roles/aliases |
| `apps/board/src/client/board/GateForm.tsx` | nav/reset/focus/submit buttons onto kit Button |
| `apps/board/src/client/board/DecisionQueueModal.tsx` | head actions onto kit Button; context pane onto ScrollPane |
| `apps/board/src/client/board/Board.tsx` | header entry button onto kit Button |
| `apps/board/src/style.css` | delete extracted rules; re-point `--gate-*` |
| `apps/board/src/client/board/__tests__/decision-queue-dom.test.tsx` | selector updates |

---

### Task 1: Contrast roles in packages/tokens (+ generated emissions)

**Files:**
- Modify: `packages/tokens/src/values.ts`
- Modify: `packages/tokens/scripts/generate.ts`
- Test: `packages/tokens/test/invariants.test.ts`
- Generated (commit, do not hand-edit): `packages/tui-kit/src/generated/tokens.ts`, `packages/tokyo/src/tokyo-theme.css`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `ColorScheme.line.edgeOnCard/.controlEdgeOnCard`, `ColorScheme.text.mutedOnCard`, `ColorScheme.surface.inset`; generated `GENERATED_LIGHT_COLORS`/`GENERATED_DARK_COLORS` gain `line.edgeOnCard`, `line.controlEdgeOnCard`, `gray.mutedOnCard`, `surface.inset`; tokyo gains `--tk-border-on-card`, `--tk-control-edge`, `--tk-muted-on-card`, `--tk-inset` in both scheme blocks.

- [ ] **Step 1: Write the failing invariants**

Append to `packages/tokens/test/invariants.test.ts` (imports of `contrastRatio`, `srgbLuminance`, `TOKENS`, `SCHEMES` already exist at the top of the file):

```ts
describe('on-card contrast roles', () => {
  it.each(SCHEMES)('%s: mutedOnCard clears 4.5:1 on card', scheme => {
    const t = TOKENS[scheme];
    expect(
      contrastRatio(t.text.mutedOnCard, t.surface.card)
    ).toBeGreaterThanOrEqual(4.5);
  });

  it.each(SCHEMES)(
    '%s: edgeOnCard at least as strong as border against card',
    scheme => {
      const t = TOKENS[scheme];
      expect(
        contrastRatio(t.line.edgeOnCard, t.surface.card)
      ).toBeGreaterThanOrEqual(contrastRatio(t.line.border, t.surface.card));
    }
  );

  it.each(SCHEMES)(
    '%s: controlEdgeOnCard at least as strong as edgeOnCard against card',
    scheme => {
      const t = TOKENS[scheme];
      expect(
        contrastRatio(t.line.controlEdgeOnCard, t.surface.card)
      ).toBeGreaterThanOrEqual(
        contrastRatio(t.line.edgeOnCard, t.surface.card)
      );
    }
  );

  it.each(SCHEMES)('%s: inset sits below card in luminance', scheme => {
    const t = TOKENS[scheme];
    expect(srgbLuminance(t.surface.inset)).toBeLessThan(
      srgbLuminance(t.surface.card)
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun run --cwd packages/tokens test` (or `bunx vitest run` from `packages/tokens`)
Expected: FAIL to compile ("Property 'mutedOnCard' does not exist" or similar).

- [ ] **Step 3: Add the leaves to `values.ts`**

In `ColorScheme`: `text` gains `mutedOnCard: string;`, `surface` gains `inset: string;`, `line` gains `edgeOnCard: string;` and `controlEdgeOnCard: string;`.

In `TOKENS.light`: `text.mutedOnCard: '#565d80'`, `surface.inset: '#f7f8fa'`, `line.edgeOnCard: '#c8cad6'`, `line.controlEdgeOnCard: '#c8cad6'`.

In `TOKENS.dark`: `text.mutedOnCard: '#aab3d8'`, `surface.inset: '#1c2136'`, `line.edgeOnCard: '#505879'`, `line.controlEdgeOnCard: '#6b7499'`.

Each new leaf gets one comment stating its constraint, e.g. on the group: `// On-card contrast roles: --border/--muted-text sit too close to --card in dark; these are the stronger pairings gate surfaces read.`

- [ ] **Step 4: Extend `generate.ts`**

`buildTuiKitColors`: `gray` gains `mutedOnCard: at('text.mutedOnCard', t.text.mutedOnCard)`, `surface` gains `inset: at('surface.inset', t.surface.inset)`, `line` gains `edgeOnCard: at('line.edgeOnCard', t.line.edgeOnCard)` and `controlEdgeOnCard: at('line.controlEdgeOnCard', t.line.controlEdgeOnCard)`.

`buildTokyoDeclarations`: add `borderOnCard`, `controlEdge`, `mutedOnCard`, `inset` (same `at()` pattern). `renderTokyoSchemeBlock`: emit `--tk-border-on-card` and `--tk-control-edge` immediately after the `--tk-border-soft` line, `--tk-muted-on-card` immediately after the `--tk-muted-text` line, `--tk-inset` immediately after the `--tk-card` line.

- [ ] **Step 5: Regenerate**

Run: `bun packages/tokens/scripts/generate.ts` from the repo root (single plain command).
Then inspect `git diff` of `packages/tui-kit/src/generated/tokens.ts` and `packages/tokyo/src/tokyo-theme.css`: only the new leaves/lines appear.

- [ ] **Step 6: Run the tokens suite**

Run: `bunx vitest run` from `packages/tokens`.
Expected: PASS. If `consumption.test.ts` or `fragment-sync.test.ts` asserts a fixed leaf list, extend that list with the four new leaves (they exist to keep TOKENS and the generated outputs in lockstep; the generator change is the behavior, the test extension records it).

- [ ] **Step 7: Commit**

`git add` the five touched files, then commit: `tokens: on-card contrast roles (edgeOnCard, controlEdgeOnCard, mutedOnCard, inset)`

---

### Task 2: tui-kit theme surface (semantic roles, wash, type roles, scale gaps)

**Files:**
- Modify: `packages/tui-kit/src/theme.ts`
- Modify: `packages/tui-kit/soribashi.config.ts`
- Test: `packages/tui-kit/test/theme.test.ts`
- Generated (commit): `packages/tui-kit/src/generated/theme.css`

**Interfaces:**
- Consumes: Task 1's generated color leaves (`colors.line.edgeOnCard`, `colors.line.controlEdgeOnCard`, `colors.gray.mutedOnCard`, `colors.surface.inset`).
- Produces (emitted CSS vars later tasks reference): `--border-on-card`, `--border-control-on-card`, `--text-muted-on-card`, `--surface-inset`, `--surface-wash-fg-4-card`, `--type-display`, `--type-title`, `--type-body`, `--type-meta`, `--type-small`, `--type-micro`, `--font-size-rem62`, `--spacing-rem95`, `--line-height-snug`.

- [ ] **Step 1: Write the failing emitted-vars test**

Append to `packages/tui-kit/test/theme.test.ts`, following its existing pattern for reading `src/generated/theme.css` (the referential-closure test in the same file already reads it; reuse that mechanism):

```ts
test("polish-port roles and aliases are emitted", () => {
  const css = generatedThemeCss; // the same string the closure test reads
  for (const decl of [
    "--border-on-card:",
    "--border-control-on-card:",
    "--text-muted-on-card:",
    "--surface-inset:",
    "--surface-wash-fg-4-card:",
    "--type-display:",
    "--type-title:",
    "--type-body:",
    "--type-meta:",
    "--type-small:",
    "--type-micro:",
    "--font-size-rem62:",
    "--spacing-rem95:",
    "--line-height-snug:",
  ]) {
    expect(css).toContain(decl);
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bunx vitest run --project node test/theme.test.ts` from `packages/tui-kit`.
Expected: FAIL (none of the declarations exist yet).

- [ ] **Step 3: Extend `theme.ts`**

- `semanticTokens.border` gains: `"on-card": "colors.line.edgeOnCard"`, `"control-on-card": "colors.line.controlEdgeOnCard"`.
- `semanticTokens.text` gains: `"muted-on-card": "colors.gray.mutedOnCard"`.
- `semanticTokens.surface` gains: `inset: "colors.surface.inset"` and `"wash-fg-4-card": "color-mix(in srgb, var(--fg) 4%, var(--card))"` (raw string, same mechanism as the existing washes; it mixes alias names on purpose, see the config file's alias note).
- `tokens.fontSize` gains `rem62: "0.62rem"`; `tokens.spacing` gains `rem95: "0.95rem"`; `tokens.lineHeight` gains `snug: "1.4"` (the gate head band's line height; a literal in recipe CSS would trip the no-hardcoded-values gate).

- [ ] **Step 4: Add the type-role aliases in `soribashi.config.ts`**

In the `aliases` resolver's `root` object, after the font aliases:

```ts
// Type roles: the six-size ladder the decision-queue surfaces read
// (display > title > body > meta > small > micro). Aliases, not new
// sizes: each points at the canonical fontSize rung.
"--type-display": "var(--font-size-rem100)",
"--type-title": "var(--font-size-rem90)",
"--type-body": "var(--font-size-lg)",
"--type-meta": "var(--font-size-rem78)",
"--type-small": "var(--font-size-sm)",
"--type-micro": "var(--font-size-rem62)",
```

- [ ] **Step 5: Regenerate and verify**

Run: `bun run codegen` from `packages/tui-kit`.
Then: `bunx vitest run --project node test/theme.test.ts` ... Expected: PASS (referential closure included; a failure there means an alias/wash references a var that is not emitted).

- [ ] **Step 6: Run the node gates**

Run: `bun run gates` from `packages/tui-kit` (includes the codegen byte-compare against the committed theme.css; commit in the next step makes it green if it flags the diff, so run it once more after committing if it failed only on the diff check).
Expected: hardcoded-values, token-existence, node tests PASS.

- [ ] **Step 7: Commit**

Commit `theme.ts`, `soribashi.config.ts`, `test/theme.test.ts`, `src/generated/theme.css`: `tui-kit: on-card semantic roles, fg-4-card wash, type-role aliases, rem62/rem95/snug rungs`

---

### Task 3: Button filled variant, pinned tier cells, lg geometry

**Files:**
- Modify: `packages/tui-kit/src/theme.ts` (vocabulary only)
- Modify: `packages/tui-kit/src/intent-resolver.ts`
- Modify: `packages/tui-kit/src/recipes/Button/Button.module.css`
- Modify: `packages/tui-kit/src/a11y/known-contrast-debt.ts` (only if the matrix reports failing filled cells)
- Tests: `packages/tui-kit/src/recipes/Button/Button.parity.test.tsx` (update changed-cell expectations), `Button.matrix.test.tsx` (no edits; it enumerates `tuiVocabulary.variant.values`), Button visual baselines (regenerate)

**Interfaces:**
- Consumes: Task 2's emitted vars (none directly; resolver strings reference `--bg`, `--fg`, `--accent`, `--accent-text`, which exist).
- Produces: `<Button variant="filled" ...>` and `size="lg"`; resolver output for the four pinned cells exactly as the spec's section 2 table. Task 5 relies on: `filled`x`warn` = amber ground/`--bg` text/600 weight; `light`x`muted` = fg 8%/`--fg`/hover 13%; `light`x`accent` = accent 14%/`--accent-text`/hover 22%; `subtle`x`muted` = transparent/`--fg`/hover fg 6%; `size="lg"` = 0.8rem font, 5px 12px padding.

- [ ] **Step 1: Add `"filled"` to the vocabulary**

In `theme.ts`: `variant: defineVocabulary(["default", "filled", "light", "outline", "subtle"] as const)`. Update the comment above it (it currently claims the set is "canonical minus transparent/link"; it is now also plus filled, restored because the gate surfaces ship a solid tier).

- [ ] **Step 2: Run the matrix test to see the new cells fail or pass honestly**

Run: `bunx vitest run --project browser src/recipes/Button/Button.matrix.test.tsx` from `packages/tui-kit`.
Expected: filled cells render (engine has the branch) but text is `--sb-intent-foreground`-fallback white; note which cells fail AA. This is the RED baseline for the resolver patch.

- [ ] **Step 3: Patch the resolver**

Replace the tail of `tuiIntentResolver` in `intent-resolver.ts` so the flow is base, then filled patch, then pinned cells, then the retune weight:

```ts
/**
 * The gate surfaces' ratified cells, pinned verbatim (spec:
 * docs/superpowers/specs/2026-09-10-polish-port-design.md). Pins take
 * precedence over the tone-weight retune: these cells' whole quartet is
 * design-fixed, not a derived value with a corrected text tone.
 */
const PINNED_CELLS: Record<string, Partial<IntentResolverResult>> = {
  "light|muted": {
    background: "color-mix(in srgb, var(--fg) 8%, transparent)",
    color: "var(--fg)",
    hover: "color-mix(in srgb, var(--fg) 13%, transparent)",
    border: "transparent",
  },
  "light|accent": {
    background: "color-mix(in srgb, var(--accent) 14%, transparent)",
    color: "var(--accent-text)",
    hover: "color-mix(in srgb, var(--accent) 22%, transparent)",
    border: "transparent",
  },
  "subtle|muted": {
    color: "var(--fg)",
    hover: "color-mix(in srgb, var(--fg) 6%, transparent)",
    border: "transparent",
  },
};

export const tuiIntentResolver: IntentResolver = ({ intent, variant }) => {
  const family = FAMILY[intent] ?? "blue";
  const tone =
    family === "gray" ? "var(--color-gray-muted)" : `var(--color-${family}-500)`;

  let result = singleShadeVariantColors(tone, variant) satisfies IntentResolverResult;

  // filled paints scheme-inverting text: --bg flips near-white/near-black
  // per scheme, so one rule clears both grounds where a literal white
  // could not. Hover mixes the tone toward --fg (88%), the shipped value.
  if (variant === "filled") {
    result = {
      ...result,
      color: "var(--bg)",
      hover: `color-mix(in srgb, ${tone} 88%, var(--fg))`,
      border: "transparent",
    };
  }

  const pinned = PINNED_CELLS[`${variant}|${intent}`];
  if (pinned) return { ...result, ...pinned };

  const weight = toneWeightFor(variant, intent);
  if (weight === undefined) return result;

  return { ...result, color: retunedTextColor(tone, variant, intent) };
};
```

Check `IntentResolverResult`'s actual field names in `@soribashi/core`'s types before writing (`background`/`color`/`hover`/`border` per the existing base usage); if `border` is not a field, drop those keys and verify the base already yields transparent borders for light/subtle/filled.

- [ ] **Step 4: Button geometry + filled weight**

Append to `Button.module.css` inside the `@layer` block, after the `sm` rule:

```css
.root[data-size="lg"] {
  font-size: var(--font-size-rem80);
  padding: var(--spacing-px5) var(--spacing-px12);
}

.root[data-variant="filled"] {
  font-weight: 600;
}
```

- [ ] **Step 5: Update the parity oracle**

Run: `bunx vitest run src/recipes/Button/Button.parity.test.tsx` from `packages/tui-kit`.
The three changed cells (light|muted, light|accent, subtle|muted) fail against the old shipped values. Update those expectations to the pinned strings above. Do not touch any other cell's expectation; any other failure is a resolver bug, not an oracle update.

- [ ] **Step 6: Matrix + debt ledger**

Run the matrix test again. For each still-failing `filled` cell, add a `known-contrast-debt.ts` entry in that file's existing format with the measured ratio from the failure message and the reason string `filled text is var(--bg) by design (gate solid tier); tone too mid-luminance for AA at rest`. The `warn`-filled cell keeps `var(--bg)` regardless (ratified). If `light|accent` or `subtle|muted` newly fail, that is a defect in the pin values transcription, not new debt.

- [ ] **Step 7: Regenerate Button visual baselines**

Run: `bunx vitest run --project browser --update src/recipes/Button` from `packages/tui-kit`.
Inspect the changed screenshots: only tiles for the three retuned cells and the new filled column/lg size may differ.

- [ ] **Step 8: Full kit suite + gates**

Run: `bunx vitest run` from `packages/tui-kit`, then `bun run gates`.
Expected: PASS (matrix ratchet green against the ledger).

- [ ] **Step 9: Commit**

Commit: `tui-kit: filled Button variant, pinned gate tier cells, lg geometry`

---

### Task 4: ScrollPane recipe

**Files:**
- Create: `packages/tui-kit/src/recipes/ScrollPane/ScrollPane.tsx`
- Create: `packages/tui-kit/src/recipes/ScrollPane/ScrollPane.module.css`
- Create: `packages/tui-kit/src/recipes/ScrollPane/ScrollPane.test.tsx`
- Create: `packages/tui-kit/src/recipes/ScrollPane/ScrollPane.visual.test.tsx`
- Modify: `packages/tui-kit/src/index.ts`, `packages/tui-kit/src/a11y/matrix-classification.ts`

**Interfaces:**
- Consumes: Task 2's `--surface-wash-fg-4-card`, `--type-title`, `--line-height-snug`, `--border-on-card`.
- Produces: `ScrollPane` component: props `{ title: ReactNode; maxHeight?: string; children?: ReactNode }` plus standard section HTML attributes; parts `scrollpane`/`scrollpane-head`/`scrollpane-body`; exports `ScrollPane`, `SCROLLPANE_PARTS`, `scrollPaneTheme`, types `ScrollPaneOwnProps`, `ScrollPaneProps`.

- [ ] **Step 1: Write the failing unit test**

`ScrollPane.test.tsx`, using the same render harness as the sibling `Panel/Panel.test.tsx` (copy its imports and setup verbatim; only the assertions below are new):

```tsx
test("renders title in the head band and children in the scrolling body", () => {
  // render <ScrollPane title="Decision context">body text</ScrollPane>
  // via the harness, then:
  const head = container.querySelector('[data-part="scrollpane-head"]');
  const body = container.querySelector('[data-part="scrollpane-body"]');
  expect(head?.textContent).toBe("Decision context");
  expect(body?.textContent).toBe("body text");
});

test("maxHeight flows to the root as the pane cap var", () => {
  // render <ScrollPane title="t" maxHeight="46vh" /> then:
  const root = container.querySelector('[data-part="scrollpane"]');
  expect(root?.getAttribute("style")).toContain("--sb-scrollpane-max: 46vh");
});

test("omitted maxHeight leaves the pane uncapped", () => {
  const root = container.querySelector('[data-part="scrollpane"]');
  expect(root?.getAttribute("style")).toContain("--sb-scrollpane-max: none");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bunx vitest run src/recipes/ScrollPane` from `packages/tui-kit`.
Expected: FAIL (module does not exist).

- [ ] **Step 3: Implement `ScrollPane.tsx`**

```tsx
import type { ComponentProps, HTMLAttributes, ReactNode } from "react";
import { defineComponent } from "../../builders.ts";
import classes from "./ScrollPane.module.css";

/** Authoring category (1 = pure styled primitive). Read off this module by
    scripts/derive.ts to build the kit's manifest; not dead code. */
export const recipeCategory = 1 as const;

const SCROLLPANE_SELECTORS = ["root", "head", "body"] as const;

export const SCROLLPANE_PARTS = {
  root: "scrollpane",
  head: "scrollpane-head",
  body: "scrollpane-body",
} as const;

export interface ScrollPaneOwnProps {
  /** Pinned header content, rendered in the band above the scrolling body. */
  title: ReactNode;
  /** CSS max-height for the whole pane (e.g. "46vh"). Omitted = uncapped. */
  maxHeight?: string;
  children?: ReactNode;
}

type ScrollPaneProps_ = ScrollPaneOwnProps &
  Omit<HTMLAttributes<HTMLElement>, "ref" | "children" | "title">;

export const ScrollPane = defineComponent<
  ScrollPaneProps_,
  typeof SCROLLPANE_SELECTORS,
  readonly [],
  readonly []
>({
  name: "ScrollPane",
  selectors: SCROLLPANE_SELECTORS,
  classes,
  vars: (_theme, props) => ({
    root: {
      "--sb-scrollpane-max":
        (props as { maxHeight?: string }).maxHeight ?? "none",
    },
  }),
  render: ({ props, getStyles, ref }) => {
    const {
      title,
      maxHeight: _maxHeight,
      children,
      classNames: _classNames,
      styles: _styles,
      vars: _vars,
      attributes: _attributes,
      unstyled: _unstyled,
      ...rest
    } = props;

    return (
      <section
        ref={ref}
        {...rest}
        {...getStyles("root")}
        data-part={SCROLLPANE_PARTS.root}
      >
        <div {...getStyles("head")} data-part={SCROLLPANE_PARTS.head}>
          {title}
        </div>
        <div {...getStyles("body")} data-part={SCROLLPANE_PARTS.body}>
          {children}
        </div>
      </section>
    );
  },
});

export type ScrollPaneProps = ComponentProps<typeof ScrollPane>;

export const scrollPaneTheme = ScrollPane.extend({});
```

Adjust the `defineComponent` generic arity/`vars` signature to match what `Panel.tsx` and `Button.tsx` actually compile with (Panel is the no-vocabulary reference).

- [ ] **Step 4: Implement `ScrollPane.module.css`**

```css
/* ScrollPane: bounded scroll pane with a pinned header band, lifted from
   mr-board's decision-queue context pane. */
@layer soribashi.recipes {
  .root {
    display: flex;
    flex-direction: column;
    /* A bare max-height loses to the flex automatic minimum size when the
       pane sits in a flex column; min-height: 0 plus overflow: hidden make
       the cap real and push the scrolling into .body. */
    max-height: var(--sb-scrollpane-max);
    min-height: 0;
    overflow: hidden;
    box-sizing: border-box;
    border: 1px solid var(--border-soft);
    border-radius: var(--radius-xl);
    background: var(--card);
    padding: var(--spacing-rem100) var(--spacing-xxl) var(--spacing-xxl);
    font-family: var(--font-sans);
  }

  .head {
    flex-shrink: 0;
    /* The band bleeds through the root padding to the frame, then restores
       it inside; a shade under the card ground, sealed with a soft rule. */
    margin: calc(-1 * var(--spacing-rem100)) calc(-1 * var(--spacing-xxl))
      var(--spacing-rem55);
    padding: var(--spacing-md) var(--spacing-xxl);
    font-size: var(--type-title);
    font-weight: 600;
    line-height: var(--line-height-snug);
    color: var(--accent-text);
    background: var(--surface-wash-fg-4-card);
    border-bottom: 1px solid var(--border-soft);
    border-radius: calc(var(--radius-xl) - 1px) calc(var(--radius-xl) - 1px)
      0 0;
  }

  .body {
    min-height: 0;
    overflow-y: auto;
    /* The scroll edge is the pane border, not the inner padding: bleed
       through the right padding and restore it inside so the thin bar hugs
       the frame with no visible gutter. */
    margin-right: calc(-1 * var(--spacing-xxl));
    padding-right: var(--spacing-xxl);
    scrollbar-width: thin;
    scrollbar-color: var(--border-on-card) transparent;
  }
}
```

- [ ] **Step 5: Register the recipe**

- `src/index.ts`: insert alphabetically:

```ts
export {
  ScrollPane,
  SCROLLPANE_PARTS,
  scrollPaneTheme,
} from "./recipes/ScrollPane/ScrollPane.tsx";
export type {
  ScrollPaneOwnProps,
  ScrollPaneProps,
} from "./recipes/ScrollPane/ScrollPane.tsx";
```

- `src/a11y/matrix-classification.ts`: add alphabetically:

```ts
ScrollPane: {
  exempt:
    "structural: fixed --card/--border-soft/--accent-text pairs, no intent axis",
},
```

- [ ] **Step 6: Run unit test to verify it passes**

Run: `bunx vitest run src/recipes/ScrollPane` ... Expected: PASS.

- [ ] **Step 7: Write the visual baseline**

`ScrollPane.visual.test.tsx`, modeled on `Alert/Alert.visual.test.tsx` (same harness, light + dark captures). Render one capped pane with overflowing content so the scrollbar and band both appear:

```tsx
<ScrollPane title="Decision context" maxHeight="12rem" style={{ width: "24rem" }}>
  {Array.from({ length: 20 }, (_, i) => (
    <p key={i}>context line {i + 1} with enough words to wrap once or twice</p>
  ))}
</ScrollPane>
```

Run with `--update` once to create `__screenshots__`, then run without `--update` to verify stability.

- [ ] **Step 8: Kit suite + gates**

Run: `bunx vitest run` from `packages/tui-kit` (matrix guard now requires the classification entry from Step 5), then `bun run gates`.
Expected: PASS.

- [ ] **Step 9: Commit**

Commit: `tui-kit: ScrollPane recipe (pinned head band, border-hugging scrollbar)`

---

### Task 5: Board adoption

**Files:**
- Modify: `apps/board/src/client/board/GateForm.tsx`
- Modify: `apps/board/src/client/board/DecisionQueueModal.tsx`
- Modify: `apps/board/src/client/board/Board.tsx` (line ~942, `.tui-dq-open`)
- Modify: `apps/board/src/style.css`
- Test: `apps/board/src/client/board/__tests__/decision-queue-dom.test.tsx`

**Interfaces:**
- Consumes: Task 3's Button cells and `size="lg"`; Task 4's `ScrollPane` (props `title`, `maxHeight`); Task 2's emitted vars for the `--gate-*` re-point.
- Produces: nothing downstream; this is the leaf task.

Run `bun run tui-kit:build` at the repo root FIRST (board consumes `dist/`).

- [ ] **Step 1: Swap GateForm buttons onto kit Button**

Add `import { Button, Chip } from '@mattstack/tui-kit';` (Chip is already imported; extend that import). Then:

- `Questionnaire.Previous` (line ~376): drop `className`, keep `disabled={busy}`, add `render={props => <Button {...props} variant="light" intent="muted" size="lg" />}`. Children stay `previous`.
- reset button (~382): `<Button type="reset" variant="subtle" intent="muted" size="lg" disabled={busy} onClick={resetAll}>reset</Button>`.
- both focus-pane buttons (~401, ~411): `<Button variant="subtle" intent="muted" size="lg" ...>` keeping each one's existing `disabled`/`title`/`onClick` exactly.
- `Questionnaire.Next` and `Questionnaire.Submit` (~424, ~435): drop `className`; change each `render` to `(props, state) => <Button {...props} variant="filled" intent="warn" size="lg" disabled={busy || state.status !== 'answered'} />`.

Note on the render-prop composition: Button spreads incoming props onto the native button before `getStyles`, so Questionnaire's handlers/aria pass through and Button's own className wins; do not forward a className.

- [ ] **Step 2: Swap DecisionQueueModal buttons and context pane**

Extend the kit import (`Button`, `ScrollPane` alongside `Chip, Markdown, Modal`). Then:

- focus-pane head actions (lines ~76, ~86, class `tui-gate-ghost tui-triage-act-focus`): `<Button variant="light" intent="accent" size="lg" ...>` keeping handlers/titles.
- skip head action (~100, class `tui-gate-ghost tui-triage-act-skip`): `<Button variant="light" intent="muted" size="lg" ...>`.
- answered-face continue (~183) and complete-face close (~263), class `tui-gate-submit`: `<Button variant="filled" intent="warn" size="lg" ...>`.
- context pane (lines 205-209): replace

```tsx
<div className="tui-triage-context">
  <div className="tui-triage-context-label">Decision context</div>
  <div className="tui-gate-context-body">...</div>
</div>
```

with

```tsx
<ScrollPane title="Decision context" maxHeight="46vh">
  ...same children the tui-gate-context-body div held...
</ScrollPane>
```

- [ ] **Step 3: Swap the header entry button in Board.tsx**

`.tui-dq-open` (~942) becomes `<Button variant="light" intent="accent" size="lg" ...>` with the same onClick/text. Keep the `hidden`-at-zero logic untouched.

- [ ] **Step 4: style.css deletions and re-point**

Delete these rules entirely: `.tui-dq-open` (both rules), `.tui-gate-nav` (all three), `.tui-gate-submit` (all three), `.tui-gate-focus`/`.tui-gate-ghost` (the shared block and `:hover`/`:disabled`), `.tui-triage-head-actions .tui-gate-ghost` (+ hover), `.tui-triage-head-actions .tui-triage-act-focus` (+ hover), `.tui-triage-context`, `.tui-triage-context-label`, `.tui-triage-context .tui-gate-context-body`.

Keep and re-target the markdown spacing rules at ~1987-1996: `.tui-gate-context-body ...` becomes `[data-part='scrollpane-body'] ...` (scope them under `.tui-triage-modal` to stay modal-local).

Re-point the `--gate-*` block (lines ~1382-1408):

```css
--gate-edge: var(--border-on-card);
--gate-control-edge: var(--border-control-on-card);
--gate-muted: var(--text-muted-on-card);
--gate-key-bg: var(--surface-inset);
--gate-font-display: var(--type-display);
--gate-font-title: var(--type-title);
--gate-font-body: var(--type-body);
--gate-font-meta: var(--type-meta);
--gate-font-small: var(--type-small);
--gate-font-micro: var(--type-micro);
--gate-gap: var(--spacing-rem95);
--gate-gap-inner: var(--spacing-rem80);
--gate-gap-row: var(--spacing-px10);
--gate-pad-card: var(--spacing-rem100) var(--spacing-xxl) var(--spacing-xxl);
--gate-pad-chrome: var(--spacing-px8) var(--spacing-px10);
--gate-radius-card: var(--radius-xl);
--gate-radius-control: var(--radius-lg);
--gate-radius-btn: var(--radius-md);
```

Delete `--gate-btn-font` and `--gate-btn-pad` and verify nothing still reads them (`grep -n "gate-btn" apps/board/src/style.css` must return nothing).

Re-point `.tui-gate-question-head`'s background to `var(--surface-wash-fg-4-card)` (currently the literal `color-mix(in srgb, var(--fg) 4%, var(--card))`).

- [ ] **Step 5: Update the DOM test**

In `decision-queue-dom.test.tsx`, `.tui-dq-open` no longer exists. Replace both `container.querySelector('.tui-dq-open')` sites with a text lookup:

```ts
const openButton = [...container.querySelectorAll('button')].find(b =>
  b.textContent?.trim().startsWith('decision queue')
);
```

The `findByText(dialog, 'button', 'skip gate')` and close/`aria-label` lookups are text/aria based and survive.

- [ ] **Step 6: Board gates**

Run in order (separate Bash calls): `bun run tui-kit:build` (root, if any kit change landed since the last build), `bun run board:typecheck`, `bun run board:test`, `bun run board:build`.
Expected: all PASS.

- [ ] **Step 7: Commit**

Commit: `board: gate buttons onto kit Button tiers, context pane onto ScrollPane, --gate-* re-pointed at kit tokens`

---

### Task 6: Whole-branch gauntlet + visual verification

**Files:** none created; verification only (plus any one-line fixes it forces, committed individually).

- [ ] **Step 1: Package suites**

Separate Bash calls, in order: `bunx vitest run` from `packages/tokens`; `bun run gates` from `packages/tui-kit`; `bunx vitest run` from `packages/tui-kit`; `bun run tui-kit:build` at root; `bun run board:typecheck`; `bun run board:test`; `bun run board:build`.
Expected: all green.

- [ ] **Step 2: Repo purity**

Run: `sh scripts/repo-purity.sh` at root. Expected: green.

- [ ] **Step 3: Storybook eyeball set**

Start the board Storybook in this worktree on port 6007 (`bunx storybook dev -p 6007 --no-open` from `apps/board`, backgrounded). Capture the DecisionQueueModal stories (all 9) and GateRowChips stories (4) in light AND dark via the fast-browser driver to a scratch directory, and list the capture paths in the task report. What to look for: the three accepted deltas from the spec (previous-button rest text, header-button font, focus rings) and NOTHING else changed against the shipped look.

- [ ] **Step 4: Report**

No commit unless a fix was needed. Summarize test counts, debt-ledger entries added (if any), and the capture paths.
