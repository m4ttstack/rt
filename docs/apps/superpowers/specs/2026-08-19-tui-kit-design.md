# tui-kit: the mattstack TUI look as a soribashi library (Phase 2)

Date: 2026-08-19
Status: approved in brainstorming

## Purpose

mr-board's look and feel — the Tokyo Day/Night palette, graph-paper canvas,
mono typography, framed panels, and the generic component layer Phase 1
carved into `src/client/ui/` — becomes a reusable library, `@mattstack/tui-kit`,
built on soribashi (Matt's component-authoring framework). tui-kit is its own
mattstack rung: adoptable alone, owned by no consumer app. mr-board is the
first consumer and the acceptance test; gitq's board is the second consumer
(its own later cycle). tui-kit is also soribashi's **first real adopter**, so
this project doubles as soribashi's adoption pressure-test.

Phase 1 (merged 2026-08-19, mr-board `56e5b5c`) prepared the seams: the ui/
layer is boundary-clean (no `BoardMR` props, no board/ imports), the pure
logic lives in DOM-free modules (`layers.ts`, `scroll-lock.ts`), and the
deterministic capture harness (`bun run capture` / `capture:compare`) exists
to prove the look survives extraction.

## Decisions (ratified in brainstorming)

1. **Own repo** at `~/Documents/GitHub/tui-kit`, consumed via the mattstack
   sibling pattern (`"@mattstack/tui-kit": "file:../tui-kit"`), like
   `@mattstack/rt-client`.
2. **Full soribashi reference-library conventions** — four-file recipes,
   `createTheme` + codegen, the no-hardcoded-values gate, a workshop preview
   app — **except** the shadcn registry, which is deferred to distribution-rung
   work (soribashi's derive/generate scripts can produce it from the recipes
   later; nothing in v1 blocks it).
3. **v1 scope**: the theme plus the entire ui/ layer as recipes, plus the two
   seams Phase 1 left uncut (a generic ContextMenu and a Chip primitive).
   Acceptance: mr-board renders pixel-parity on its capture harness with
   `src/client/ui/` deleted.
4. **Tokyo look everywhere**: gitq's board will restyle onto this theme (own
   cycle); tui-kit does not need multi-theme support in v1, only a vocabulary
   that doesn't preclude it (soribashi gives that for free).
5. **Dogfood loop**: every soribashi bug, gap, or paper cut encountered
   during implementation is filed as a ticket on the `soribashi` Linear team
   at the moment of encounter, with repro and the workaround taken. The kit
   never silently absorbs framework debt.

## Repo layout

```
~/Documents/GitHub/tui-kit/
  package.json            name "@mattstack/tui-kit"; main/types → ./src/index.ts
                          (source-consumed, no build step — soribashi's model)
  soribashi.config.ts     theme → src/generated/theme.css; watch globs
  src/
    theme.ts              defineVocabulary + createTheme: Tokyo Day/Night
    builders.ts           makeBuilders<typeof tuiTheme>() — typed literals
    generated/theme.css   codegen output, committed, drift-checked
    canvas.css            optional page canvas: grid background, fonts, .tui measure
    index.ts              public barrel: recipes + hooks + theme
    recipes/<Name>/       soribashi four-file convention:
                          <Name>.tsx, <Name>.module.css,
                          <Name>.test.tsx (browser), <Name>.visual.test.tsx
    hooks/                layers.ts, scroll-lock.ts, useEscapeClose,
                          useBodyScrollLock, useAutoGrowTextarea,
                          useRevealOnChange (plain exports, not recipes)
  workshop/               Vite preview app (soribashi's apps/workshop shape):
                          one page per recipe, dark toggle, tokens page
  test/no-hardcoded-values.test.ts   mechanical gate, ported from soribashi
  docs/superpowers/specs/            this spec moves here once the repo exists
```

## Soribashi dependency wiring

tui-kit depends on `@soribashi/core` (re-exports factory + theme). All three
packages are unpublished (`version 0.0.0, private`) with `workspace:*`
interdeps, so consumption is a solved-at-plan-time spike with a pre-agreed
fallback:

- **Spike**: `"@soribashi/core": "file:../soribashi/packages/core"` plus bun
  `overrides` mapping `@soribashi/theme` and `@soribashi/factory` to their
  sibling paths. If bun resolves the `workspace:*` protocol through the
  overrides, done.
- **Fallback** (no stall, no re-litigating): vendor the three packages'
  `src/` into `tui-kit/vendor/soribashi/` with a `sync-soribashi` script —
  the same pattern mr-board uses for vendored resolvers, and what soribashi's
  own registry-smoke test does.
- Either way, file the soribashi ticket: unpublished core is the first
  adopter's first obstacle (its STATUS.md already knows).

Consumers: mr-board adds the `file:../tui-kit` dep. Bun.build bundles the
kit's TSX + CSS Modules (probe-proven on Bun 1.3.13: hashed class names,
separate CSS chunk); mr-board's server serves the emitted CSS chunk alongside
`style.css` via a new `<link>` in the shell.

## Theme

**Vocabulary keeps the board's existing color words** — `accent, ok, warn,
bad, cyan, purple, muted` (today's `t-*` classes) — so migration is
mechanical. Renaming hue-words to semantics (`cyan` → `info`) is deferred;
the vocabulary is typed, so a later rename is a compiler-guided sweep.

**Tokens map 1:1 from mr-board's two `:root` blocks** as tuned at merge
(including the 2026-08-19 dark widening): surfaces `bg / panel / card`, lines
`border / border-soft / grid-line`, text `fg / muted`, six intent colors,
three `dot-*` status colors (semantic tokens over intents), shadow tokens
(`--shadow-*`, new — see the literals rule below), and typography
(`font-mono` JetBrains Mono stack, `font-sans` Inter stack, the 13.5px mono
base). Light values on the base theme, dark as the theme's dark set; codegen
emits `oklch()` with `light-dark()` pairs.

**Theme switching survives unchanged**: `light-dark()` keys off
`color-scheme`; mr-board keeps a two-line shim (`:root { color-scheme:
light }` / `:root.dark { color-scheme: dark }`). The kit carries no
class-name convention — each consumer picks its own switching mechanism.

**`canvas.css`** carries the signature texture (graph-paper background, font
application, the `.tui` / `.tui-wide` measure) as an optional import — not a
recipe (no DOM), not forced on component-only consumers.

## Recipe set

Fourteen units; twelve recipes plus the hooks family as plain exports.

**Straight ports** (behavior as-is; styles lifted from mr-board's
`style.css` into each recipe's `.module.css`):

- `Icon` (+ the ICONS dict)
- `Segmented` + `LabeledSeg`
- `CopyButton`
- `SelectBox`
- `Toast` (ToastHost + `useToasts`)
- `Markdown` (react-markdown as a kit dependency)
- `Modal` (escape + scroll-lock built in; `closeGlyph` prop)
- `Panel` (collapse persistence keeps its localStorage default; key prefix
  configurable)

**API promotions while crossing the boundary:**

- `SideDrawer`: replaces Phase 1's raw `overlayClassName/panelClassName`
  props with `side: "left" | "right"`.
- `StatusDot`: the kit ships the generic dot + CSS-tooltip primitive
  (`intent` + `tip`); mr-board keeps a thin wrapper mapping `BoardMR` →
  intent/tip.
- `ContextMenu` (uncut seam #1): the generic shell extracted from RowMenu —
  measured viewport clamping, outside-click/scroll/resize dismissal, escape
  layering, MenuItem / separator / label. RowMenu's alt-note mode stays
  app-side.
- `Chip` (uncut seam #2): the `.tui-review` / `.tui-flag` bordered-pill
  family as one primitive — intent color, icon slot, pulse variant.
  mr-board's nine badge components become thin Chip configurations.

**Parity mechanics (make-or-break, addressed by design):**

1. **Hashed class names break cross-boundary CSS.** mr-board has selectors
   reaching into ui/ internals (e.g. `.tui-drawer-controls .tui-seg button
   { flex: 1 }`). Recipes expose stable `data-part` attributes on their
   slots (soribashi's slot convention); app-side overrides move to those
   selectors. The full cross-boundary selector list is enumerated at plan
   time by grepping mr-board's `style.css` for every class a recipe absorbs.
2. **The no-hardcoded-values gate meets real literals.** Lifted CSS carries
   a few (`rgba(0,0,0,.3)`-family shadows and similar). Shadows become
   `--shadow-*` theme tokens; the gate's existing allowlist (0, 1px, 2px,
   100%, unitless, time values) covers the rest. Any literal that cannot map
   cleanly is a recorded design decision in the kit, never a gate exemption.

**Stays app-side** (board domain, not kit): roster sidebar styles, selection
bar, comment-drawer cards, all `board/` components, RowMenu's note mode, the
Slack chips' brand colors. Input/textarea styling is a noted later candidate.

Exact builder choice per recipe (soribashi has four, each recipe exporting
its `recipeCategory`) is resolved at plan time against soribashi's own
`authoring-a-recipe` skill, which implementers read verbatim.

## mr-board adoption & parity gate

Adoption happens in a fresh worktree (`~/Documents/GitHub/mr-board-wt-tui-adopt`),
Phase 1 discipline throughout (per-step commits, suite green each step,
revert over patch-forward). The migration:

1. Add the `file:../tui-kit` dep.
2. Replace `style.css`'s token block and body/canvas rules with imports of
   the kit's `theme.css` + `canvas.css`, plus the color-scheme shim.
3. Swap every ui/ import to `@mattstack/tui-kit`; delete `src/client/ui/`.
4. Convert the nine badge components in `board/chips.tsx` to Chip
   configurations; rebuild `RowMenu` on `ContextMenu`; wrap `StatusDot`.
5. Move cross-boundary selectors to `data-part`.
6. Server shell gains the `<link>` for the Bun.build CSS chunk.

`style.css` shrinks to board-domain rules only.

**Parity gate**: the existing capture harness, target pixel-identical.
Honest caveat: hex → `oklch()` codegen rounding can shift colors by a hair.
The first adoption task measures it; the preferred fix is raising codegen
precision (a soribashi ticket — better for every future adopter); the
fallback is a ONE-time re-baseline gated by bounded-delta verification
(every diff ≤ 2 channel units, bbox-verified as color-only, no geometry
diffs). No silent re-baseline.

## Testing

- **Kit gates**: per-recipe browser tests + visual baselines (local-Mac
  baselines, matching our harness reality; CI story deferred), the
  no-hardcoded-values test, codegen drift check (`git diff --exit-code`
  after regen), typecheck.
- **Integration gate**: mr-board's full suite + capture harness.
- **Workshop**: the preview app is where recipes get eyeballed in isolation
  during authoring (dark toggle + tokens page).

## Out of scope

- gitq board adoption (own brainstorm → spec cycle; v1 only guarantees the
  vocabulary doesn't preclude it).
- The shadcn registry and any npm publishing (distribution-rung work).
- Renaming hue-intents to semantic names.
- Input/textarea recipes.
- The Modal/SideDrawer focus trap (ledgered mr-board follow-up; a natural
  kit improvement later).

## Risks / accepted tradeoffs

- **Soribashi is pre-v1 and paused (~2 weeks stale).** tui-kit rides its
  current `main`; breakage or gaps become tickets plus local workarounds.
  Known soribashi soft spots that may bite: `defineCompound` doesn't call
  `autoVars`; no gate catches `var()` references to tokens no theme emits
  (the `--accent-primary` class of bug — tui-kit's visual tier plus
  mr-board's capture harness are the compensating nets).
- **Two test stacks** (vitest in the kit, bun test in consumers) is
  deliberate: the kit follows soribashi's conventions to keep the dogfood
  honest; consumers keep their native stack.
- **Source-level consumption** means consumers typecheck kit code under
  their own tsconfig. The kit is written DOM-lib-clean the way mr-board's
  client is, and the mr-board adoption proves the arrangement.
- **oklch precision** may force the bounded re-baseline path described above.
