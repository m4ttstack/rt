# Polish Port to tokens + tui-kit: Design

**Date:** 2026-09-10
**Ticket:** SORI-38
**Status:** Approved by Matt (full board adoption ratified 2026-09-10)

## Goal

The decision-queue design pass (2026-09-09, merged as PR #39) produced polish
that lives board-locally in `apps/board/src/style.css` under `--gate-*`
custom properties. Port the reusable parts into `packages/tokens` and
`packages/tui-kit` so no future surface redoes them, then move the board onto
the shared versions and delete its duplicated CSS.

Ground truth for every value in this spec: the gate + triage blocks of
`apps/board/src/style.css` on main (post-PR-#39). Nothing may be rounded,
re-derived, or "cleaned up" beyond the deltas listed in "Accepted visible
deltas".

## Ratified decisions

- **Full board adoption this round.** Gate buttons become kit `<Button>`,
  the context pane becomes the new `ScrollPane` recipe, board deletes the
  extracted CSS. (Matt, 2026-09-10, form answer.)
- The ratified board visuals are authoritative. Where the kit's current
  resolver output differs from the board's shipped values, the kit changes
  to match the board, not the other way around.
- Console/tokyo component adoption is out of scope; tokyo receives only the
  new `--tk-*` token emissions.

## Architecture recap (existing, unchanged)

`packages/tokens/src/values.ts` (`TOKENS`) is the single color source.
`packages/tokens/scripts/generate.ts` writes
`packages/tui-kit/src/generated/tokens.ts` and splices the `--tk-*` scheme
blocks in `packages/tokyo/src/tokyo-theme.css`. tui-kit's `codegen` script
(`soribashi build`, config `soribashi.config.ts`, theme `src/theme.ts`)
emits `src/generated/theme.css`. CI byte-compares the generated CSS
(`bun run gates` in tui-kit), and the no-hardcoded-values / token-existence /
matrix-guard tests police recipe CSS. This work rides that pipeline; no new
machinery.

## 1. Contrast roles (packages/tokens)

`ColorScheme` gains four leaves, with these exact values:

| Leaf | Light | Dark |
|---|---|---|
| `line.edgeOnCard` | `#c8cad6` | `#505879` |
| `line.controlEdgeOnCard` | `#c8cad6` | `#6b7499` |
| `text.mutedOnCard` | `#565d80` | `#aab3d8` |
| `surface.inset` | `#f7f8fa` | `#1c2136` |

(Board source: `--gate-edge`, `--gate-control-edge`, `--gate-muted`,
`--gate-key-bg` in `style.css`.)

Flow:

- `generate.ts` `buildTuiKitColors`: add the four leaves to the `line` /
  `gray` / `surface` groups it emits (`line.edgeOnCard`,
  `line.controlEdgeOnCard`, `gray.mutedOnCard`, `surface.inset`).
- `generate.ts` `buildTokyoDeclarations` + `renderTokyoSchemeBlock`: emit
  `--tk-border-on-card`, `--tk-control-edge`, `--tk-muted-on-card`,
  `--tk-inset` in both scheme blocks.
- tui-kit `theme.ts` `semanticTokens`:
  `border["on-card"] = "colors.line.edgeOnCard"`,
  `border["control-on-card"] = "colors.line.controlEdgeOnCard"`,
  `text["muted-on-card"] = "colors.gray.mutedOnCard"`,
  `surface.inset = "colors.surface.inset"`.
  Emitted vars: `--border-on-card`, `--border-control-on-card`,
  `--text-muted-on-card`, `--surface-inset`.

No new aliases in `soribashi.config.ts` for these; consumers use the
semantic names.

## 2. Button tiers (tui-kit)

### Vocabulary

`tuiVocabulary.variant` gains `"filled"` (the soribashi engine's
`singleShadeVariantColors` already has the branch; the kit vocabulary just
excludes it today). Final set:
`["default", "filled", "light", "outline", "subtle"]`.

### Resolver pins (`intent-resolver.ts`)

`tuiIntentResolver` keeps `singleShadeVariantColors` as the base and layers
a pinned-values table for the cells the board ratified. Pinned outputs
(exact strings):

| Cell | background | color | hover |
|---|---|---|---|
| `filled` × every intent | tone | `var(--bg)` | `color-mix(in srgb, <tone> 88%, var(--fg))` |
| `light` × `muted` | `color-mix(in srgb, var(--fg) 8%, transparent)` | `var(--fg)` | `color-mix(in srgb, var(--fg) 13%, transparent)` |
| `light` × `accent` | `color-mix(in srgb, var(--accent) 14%, transparent)` | `var(--accent-text)` | `color-mix(in srgb, var(--accent) 22%, transparent)` |
| `subtle` × `muted` | transparent (base) | `var(--fg)` | `color-mix(in srgb, var(--fg) 6%, transparent)` |

All other cells keep the existing base + retune-table output. Border stays
`transparent` for all four pinned rows (the base already does this for
light/subtle; verify filled).

`filled`'s `color: var(--bg)` applies to every intent, not only `warn`:
one consistent rule, and it is exactly what the board ships for the one
filled button that exists. The Button contrast matrix grades the new cells;
a cell that fails a floor gets a measured retune weight the way
`LIGHT_VARIANT_TONE_WEIGHT` entries were chosen, or a
`known-contrast-debt.ts` entry if design wants the raw value kept. The
`warn`-filled cell must keep `var(--bg)` text (ratified).

### Geometry (`Button.module.css`)

The vocabulary's `size="lg"` currently emits no rule (falls through to the
md base). Define it as the gate geometry:

```css
.root[data-size="lg"] {
  font-size: var(--font-size-rem80);
  padding: var(--spacing-px5) var(--spacing-px12);
}
```

Radius stays the base `var(--radius-md)` (6px), matching
`--gate-radius-btn`. Add `font-weight: 600` scoped to
`.root[data-variant="filled"]` (board: `.tui-gate-submit`). No other base
rule changes; existing sizes and consumers are untouched.

## 3. ScrollPane recipe (tui-kit, new)

New recipe `src/recipes/ScrollPane/`, lifted verbatim from
`.tui-triage-context` / `.tui-triage-context-label` /
`.tui-gate-context-body`. A bounded scroll pane with a pinned header band.

- **Parts:** `root`, `head`, `body`.
- **Props:** `title: ReactNode` (rendered in `head`), `maxHeight?: string`
  (default `none`; board passes `46vh`), `children` (rendered in `body`).
  `maxHeight` flows as a CSS var (e.g. `--sb-scrollpane-max`) via the
  recipe's `vars`, mirroring how other recipes pass per-instance values.
- **Root:** flex column; `max-height: var(--sb-scrollpane-max)`;
  `min-height: 0` and `overflow: hidden` (the flex automatic-minimum-size
  trap defeats a bare max-height; this pairing is the fix and gets a
  comment stating that constraint); `border: 1px solid var(--border-soft)`;
  `border-radius: var(--radius-xl)`; `background: var(--card)`;
  `padding: var(--spacing-rem100) var(--spacing-xxl) var(--spacing-xxl)`.
- **Head (the card-head band):** pinned (flex-shrink 0), bleeds through the
  root padding with negative margins
  (`margin: -1rem -1.1rem 0.55rem; padding: 0.6rem 1.1rem` in token form:
  `rem100`/`xxl`/`rem55`, `md`/`xxl`), background
  `var(--surface-wash-fg-4-card)` (new wash token, below),
  `border-bottom: 1px solid var(--border-soft)`, top corners
  `calc(var(--radius-xl) - 1px)`, type `var(--font-sans)` 600
  `var(--type-title)`, color `var(--accent-text)`.
- **Body:** `min-height: 0; overflow-y: auto;
  margin-right: calc(-1 * var(--spacing-xxl));
  padding-right: var(--spacing-xxl); scrollbar-width: thin;
  scrollbar-color: var(--border-on-card) transparent;` so the thin bar hugs
  the frame border instead of the inner padding (comment states that
  constraint).

New wash token in `theme.ts` `semanticTokens.surface`:
`"wash-fg-4-card": "color-mix(in srgb, var(--fg) 4%, var(--card))"`
(emits `--surface-wash-fg-4-card`).

Manifest/gates: `MATRIX_CLASSIFICATION` gains
`ScrollPane: { exempt: "structural: fixed --card/--border-soft/--accent-text pairs, no intent axis" }`.
Unit test (renders title + children, maxHeight var applied) plus a
light/dark visual baseline with overflowing fixed content, following the
existing recipe test conventions.

## 4. Type roles + scale gaps

- `theme.ts` `fontSize` gains `rem62: "0.62rem"`; `spacing` gains
  `rem95: "0.95rem"`. These are the only two gate values missing from the
  scale (census check during implementation confirms before adding).
- `soribashi.config.ts` aliases gain the role names:

```
--type-display: var(--font-size-rem100)
--type-title:   var(--font-size-rem90)
--type-body:    var(--font-size-lg)
--type-meta:    var(--font-size-rem78)
--type-small:   var(--font-size-sm)
--type-micro:   var(--font-size-rem62)
```

(`lg` = 0.85rem, `sm` = 0.7rem; the six roles mirror the board's
`--gate-font-*` ladder exactly.)

## 5. Board adoption (apps/board)

### Buttons become kit `<Button size="lg">`

| Board class | Kit props | Notes |
|---|---|---|
| `.tui-gate-submit` | `variant="filled" intent="warn"` | busy/disabled behavior via kit props |
| `.tui-gate-nav` | `variant="light" intent="muted"` | previous/nav buttons |
| head actions (skip; `.tui-gate-ghost` inside `.tui-triage-head-actions`) | `variant="light" intent="muted"` | |
| `.tui-triage-act-focus` | `variant="light" intent="accent"` | focus pane |
| `.tui-gate-focus`, `.tui-gate-ghost` (elsewhere: reset, write-in cancel, etc.) | `variant="subtle" intent="muted"` | |
| `.tui-dq-open` (header entry) | `variant="light" intent="accent"` | see deltas |

The extracted button rules (`.tui-gate-submit`, `.tui-gate-nav`,
`.tui-gate-focus`, `.tui-gate-ghost`, `.tui-triage-head-actions` button
overrides, `.tui-dq-open`) are deleted from `style.css`. Non-button form
controls (`.tui-gate-choice`, `.tui-gate-note`, dots, pips, chips) stay
board CSS.

### Context pane becomes `<ScrollPane>`

`DecisionQueueModal.tsx` renders
`<ScrollPane title="Decision context" maxHeight="46vh">` around the context
body; `.tui-triage-context`, `.tui-triage-context-label`, and the
`.tui-gate-context-body` scroll rules are deleted. The question-card head
band (`.tui-gate-question-head`) stays board CSS but its background
re-points at `var(--surface-wash-fg-4-card)`.

### `--gate-*` layer re-points

The `--gate-*` block stays as the board's local indirection, but every
right-hand side becomes a kit token:

- `--gate-edge: var(--border-on-card)`,
  `--gate-control-edge: var(--border-control-on-card)`,
  `--gate-muted: var(--text-muted-on-card)`,
  `--gate-key-bg: var(--surface-inset)` (the four `light-dark()` literals
  are deleted).
- `--gate-font-*` roles point at `var(--type-*)`.
- Gap/pad/radius entries point at the matching `--spacing-*` /
  `--radius-*` tokens (`0.95rem` = `rem95`, `0.8rem` = `rem80`,
  `10px` = `px10`, `1rem 1.1rem 1.1rem` = `rem100 xxl xxl`,
  `8px 10px` = `px8 px10`, radii 10/8/6 = `xl`/`lg`/`md`).
- `--gate-btn-font` / `--gate-btn-pad` are deleted with the button CSS
  (buttons are kit-rendered; nothing else may keep reading them).

### Tests and stories

- Storybook is the parity surface: the existing DecisionQueueModal (9) and
  GateRowChips (4) stories re-verified light + dark after the swap.
- DOM tests (`decision-queue-dom.test.tsx`) updated where selectors change
  (kit Button renders its own classes; keep selecting by role/text where
  possible).
- `gate-row-chips` and `decision-queue` pure tests unaffected.

## Accepted visible deltas

Unifications Matt's ratified direction implies, called out because pixels
change:

1. `.tui-gate-nav` rest text: was `--gate-muted`, becomes full `--fg`
   (the "buttons should read as buttons at rest" ruling, applied to the
   last holdout).
2. `.tui-dq-open` font: 0.78rem becomes 0.8rem (size `lg` geometry; same
   tier as the focus-pane button it visually matches).
3. Button transition/active/focus-visible behavior: kit Button's shared
   rules (transform on active, accent focus ring) replace the board
   buttons' amber `outline` focus rings. One kit-wide focus treatment wins;
   if review judges the accent ring wrong inside the amber-accented gate
   card, that becomes a follow-up ruling, not a silent board override.

Anything else that shifts in Storybook is a defect, not a delta.

## Testing / gates (definition of done)

- `packages/tokens`: its test suite green; `generate.ts` run committed
  (tui-kit `generated/tokens.ts`, tokyo `tokyo-theme.css` splices).
- `packages/tui-kit`: `bun run gates` green (codegen byte-compare,
  no-hardcoded-values, token-existence, node projects), full `vitest run`
  including matrix guard and visual baselines (new/regenerated screenshots
  committed), `bun run build`.
- `apps/board`: `bun run board:typecheck`, `board:test`, `board:build`
  after `bun run tui-kit:build` (CI ordering).
- Repo purity: `scripts/repo-purity.sh` green (public repo).
- Storybook light+dark eyeball on the modal stories before hand-back.

## Out of scope

- Console/tokyo component adoption of tiers or ScrollPane (tokens flow
  there automatically; RT-116 and console decision-queue remain separate).
- Publishing (nothing in this repo publishes; versions are tree-internal).
- The nine deferred decision-queue minors from PR #39.
