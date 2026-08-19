# tui-kit: the mattstack TUI look as a soribashi library (Phase 2)

Date: 2026-08-19 (rev 2, post adversarial review)
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
   `createTheme` + codegen, the mechanical CSS gates, a workshop preview
   app — with three DECLARED divergences: (a) no shadcn registry
   (distribution-rung work; soribashi's derive/generate scripts can produce
   it later); (b) visual baselines are local-Mac, contravening soribashi's
   Linux-Docker baseline rule — accepted because this stack runs on one
   machine and mr-board's harness set the precedent; (c) compound recipes
   are hand-rolled ports, not Base UI compositions, so the authoring skill's
   Base-UI-specific guidance (render-prop stripping, Base-UI ARIA variance)
   does not bind — implementers read the skill verbatim but apply the
   builder contracts, not the Base UI mechanics.
3. **v1 scope**: the theme plus the entire ui/ layer as recipes, plus the two
   seams Phase 1 left uncut (a generic ContextMenu and a Chip primitive).
   Acceptance: mr-board renders pixel-identical on its capture harness with
   `src/client/ui/` deleted.
4. **Tokyo look everywhere**: gitq's board will restyle onto this theme (own
   cycle); tui-kit needs no multi-theme support in v1, only a vocabulary that
   doesn't preclude it (soribashi gives that for free).
5. **Dogfood loop**: every soribashi bug, gap, or paper cut encountered
   during implementation is filed as a ticket on the `soribashi` Linear team
   at the moment of encounter, with repro and the workaround taken. The kit
   never silently absorbs framework debt.

## Repo layout

```
~/Documents/GitHub/tui-kit/
  package.json            name "@mattstack/tui-kit"; main/types → ./src/index.ts;
                          react + react-dom as peerDependencies (soribashi's own
                          pattern — a regular dep would duplicate React in
                          consumers); subpath exports (see Consumption below);
                          bun workspace root with ["workshop"] as member
  soribashi.config.ts     theme → src/generated/theme.css; darkMode selector
                          ".dark"; watch globs
  SORIBASHI_COMMIT        the pinned known-good soribashi commit (file: deps
                          float with the sibling working tree; this records
                          what the kit was built against)
  types/css-modules.d.ts  `declare module "*.module.css"` — shipped by the kit,
                          added to consumers' tsconfig include
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
                          useRevealOnChange, useToasts (plain exports)
  workshop/               Vite preview app (soribashi's apps/workshop shape):
                          one page per recipe, dark toggle, tokens page.
                          Imports the kit via a Vite alias to ../src — never a
                          file: self-dep, which bun copies and goes stale
  test/no-hardcoded-values.test.ts   mechanical gate, ported from soribashi
  test/token-existence.test.ts       ported too: recipe tokenDependencies vs
                                     emitted custom properties (soribashi
                                     grew this gate after its STATUS.md was
                                     written; port both)
  docs/superpowers/specs/            this spec moves here once the repo exists
```

## Soribashi dependency wiring (verified, not a spike)

tui-kit depends on `@soribashi/core` (re-exports factory + theme). All three
packages are unpublished (`0.0.0, private`) with `workspace:*` interdeps.
**Probed and working on Bun 1.3.13**: `"@soribashi/core":
"file:../soribashi/packages/core"` plus `overrides` mapping
`@soribashi/theme` and `@soribashi/factory` to their sibling paths resolves
the `workspace:*` protocol. Two caveats the probe surfaced, both binding:

- Packages arriving **via overrides do not get their own dependencies
  installed** — tui-kit must declare `clsx` + `tailwind-merge` (factory's
  deps) and `zod` (theme's dep) as top-level dependencies. A first-failure
  here is NOT "spike failed, go vendor" — it's this caveat.
- Relative `file:` paths in overrides resolve against the installing
  package's directory; keep them `../soribashi/packages/*` and install only
  from the repo root.

Fallback if this arrangement rots (pre-agreed, no stall): vendor the three
packages' `src/` into `tui-kit/vendor/soribashi/` with a `sync-soribashi`
script — mr-board's vendored-resolvers pattern, and what soribashi's own
registry-smoke does. Either way, file the soribashi ticket: the unpublished
core and the overrides-transitives caveat are the first adopter's first
obstacles.

**Consumption by apps**: mr-board adds the `file:../tui-kit` dep. Bun.build
bundles the kit's TSX + CSS Modules (probe-proven: hashed class names,
separate CSS chunk); mr-board's server serves the emitted CSS chunk
alongside `style.css` via a new `<link>` in the shell.

- **Subpath exports**: the package exports map exposes `.` (full barrel),
  `./hooks` (pure modules — mr-board's bun tests import `layers.ts` and
  `scroll-lock.ts` today and must keep doing so without dragging
  `.module.css` through bun's test runtime), `./theme.css`, and
  `./canvas.css`.
- **Dev-loop staleness**: bun copies `file:` deps at install; kit edits are
  invisible to mr-board until reinstall. The adoption workflow is therefore:
  iterate inside the kit's workshop (Vite alias = live), and refresh
  mr-board with `bun install --force @mattstack/tui-kit` (or `bun link`
  during heavy iteration) before each capture run. The plan encodes this in
  every adoption task.

## Theme

**Values are carried VERBATIM.** Soribashi's codegen does no color-space
conversion — token strings pass through as-is (hex and `rgba()` are
explicitly classified as raw values and emitted unchanged). The kit theme
therefore declares mr-board's exact current values from `src/style.css`'s
two `:root` blocks (as tuned at merge, including the 2026-08-19 dark
widening), and **color parity is exact by construction**. There is no
hex→oklch rounding risk, no bounded-delta fallback, and no re-baseline: any
pixel diff during adoption is a bug. Converting the palette to `oklch()` is
a possible LATER deliberate aesthetic pass, never a codegen side effect.

**Vocabulary keeps the board's color words** — `accent, ok, warn, bad,
cyan, purple, muted` (today's `t-*` classes) — so migration is mechanical.
The intent-word → color-family mapping is made once, here: `ok`→green,
`warn`→amber, `bad`→red, `accent`→blue, `cyan`→cyan, `purple`→purple,
`muted`→the muted grays. "Maps 1:1" is true of VALUES; structurally the
flat `--green`-style variables become soribashi's nested family→shade
records plus semantic tokens (`dot-ok/warn/bad` as semantic tokens over the
families; NEW `--shadow-*` tokens; NEW spacing/radius/fontSize families —
see the tokenization pass below). Renaming hue-words to semantics
(`cyan`→`info`) stays deferred; the vocabulary is typed, so a later rename
is a compiler-guided sweep.

**The tokenization pass is its own work item, not "lifting".** Two forces
make it real design work: (a) `createTheme` without `extends` REQUIRES full
`radius`/`spacing`/`fontSize` families, which mr-board never had; (b) the
no-hardcoded-values gate flags every length/percent literal outside
`{0, 1px, 2px, 100%}` + unitless + time — and the lifted CSS is dense with
`0.7rem` paddings, `8px` radii, `0.8em` font sizes, `28px` control heights,
and `color-mix(... 55%, transparent)` washes whose percentages are flagged
literals. Approach: harvest the distinct literals from the ui/ CSS census,
derive named scales (spacing/radius/fontSize) that reproduce today's values
exactly, and give the translucent washes dedicated surface tokens (e.g.
`surface-wash`, `surface-veil` for the 55%/88% panel mixes). Every literal
resolves to exactly one sanctioned outlet: a token, a `var()` with literal
fallback (the scanner skips full var() expressions — a documented loophole,
used sparingly and always with a code comment), or an allowlist entry in the
kit's copy of the gate. Choosing the outlet is the recorded decision.

**Theme switching**: codegen's `darkMode.selector` is configured to
`.dark`, so the generated theme.css itself carries `color-scheme: light` on
the scope and `color-scheme: dark` under `.dark` — mr-board's existing
shell toggle keeps working with NO app-side shim. A future consumer wanting
a different switching mechanism re-runs codegen with its own selector.

**Compatibility aliases for board-domain CSS.** The kit's generated
theme.css emits soribashi's structured names (`--color-*`, `--surface-*`,
`--text-*`, `--border-*`, `--font-family-*`, `--spacing-*`), not mr-board's
short names — and mr-board's residual board-domain CSS references the short
names ~234 times (`--muted`×49, `--border`×42, `--accent`×34, `--fg`×29,
`--card`×21, …). Rather than a rename sweep through board CSS, the kit's
codegen config uses the supported CSS-variable additions mechanism to emit
an **alias block** (`--bg: var(--surface-…)`, `--muted: var(--text-…)`,
etc.) so every existing reference keeps resolving. The aliases are part of
the kit's public theme contract (gitq's board CSS gets the same vocabulary).

**`canvas.css`** carries the signature texture (graph-paper background,
font application, the `.tui` / `.tui-wide` measure) as an optional import —
not a recipe (no DOM), not forced on component-only consumers.

## Recipe set

Fourteen units; twelve recipes plus the hooks family as plain exports.

**Straight ports** (behavior as-is; styles lifted through the tokenization
pass): Icon (+ the ICONS dict), Segmented + LabeledSeg, CopyButton,
SelectBox, Markdown (react-markdown as a kit dependency), Modal (escape +
scroll-lock built in; `closeGlyph` prop), Panel (collapse persistence keeps
its localStorage default; key prefix configurable).

**API promotions while crossing the boundary:**

- `Toast`: ToastHost moves as-is, and `useToasts` — today app-side in
  mr-board's `board/hooks.ts` — is genericized into the kit's hooks.
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
   { flex: 1 }`). Resolution: a **tui-kit convention** (not soribashi's —
   soribashi stamps only the `data-variant/intent/size` axis attributes on
   roots): every recipe hand-stamps a stable `data-part` attribute on each
   addressable slot (custom data attributes are sanctioned by the authoring
   skill; only the axis attributes are forbidden to hand-emit). App-side
   overrides move to `[data-part=…]` selectors. The full cross-boundary
   selector list is enumerated at plan time by grepping mr-board's
   `style.css` for every class a recipe absorbs.
2. **Cascade layers invert tie-breaks.** Gate rule: every recipe stylesheet
   opens with `@layer soribashi.recipes { … }`. Post-migration, kit styles
   are layered while mr-board's residual `style.css` is unlayered — so any
   unlayered board rule beats any kit rule regardless of specificity. This
   is the desired direction for app overrides, but it is NOT
   cascade-neutral versus today's single file; the capture harness is the
   net, and adoption tasks treat any surprise winner as a finding, not
   noise.

**Stays app-side** (board domain, not kit): roster sidebar styles, selection
bar, comment-drawer cards, all `board/` components, RowMenu's note mode, the
Slack chips' brand colors. Input/textarea styling is a noted later candidate.

Exact builder choice per recipe (soribashi has four, each recipe exporting
its `recipeCategory`) is resolved at plan time against soribashi's
`authoring-a-recipe` skill, subject to the declared divergence 2(c) above.

## mr-board adoption & parity gate

Adoption happens in a fresh worktree (`~/Documents/GitHub/mr-board-wt-tui-adopt`),
Phase 1 discipline throughout (per-step commits, suite green each step,
revert over patch-forward). The migration:

1. Add the `file:../tui-kit` dep (+ the refresh-on-edit dev-loop rule above).
2. Replace `style.css`'s token block and body/canvas rules with imports of
   the kit's `theme.css` (aliases included) + `canvas.css`. No shim needed —
   the generated theme carries the `.dark` selector.
3. Swap every ui/ import to `@mattstack/tui-kit` (deep pure-module imports
   via `./hooks`); delete `src/client/ui/`.
4. Convert the nine badge components in `board/chips.tsx` to Chip
   configurations; rebuild `RowMenu` on `ContextMenu`; wrap `StatusDot`.
5. Move cross-boundary selectors to `[data-part=…]`.
6. Server shell gains the `<link>` for the Bun.build CSS chunk.

`style.css` shrinks to board-domain rules only (still referencing the short
token names, which the alias block keeps alive).

**Parity gate**: the existing capture harness, target **pixel-identical,
zero tolerance** — verbatim token values make this achievable by
construction, so any diff is a defect to fix, never a delta to accept.

## Testing

- **Kit gates**: per-recipe browser tests + visual baselines via soribashi's
  stack — vitest browser mode with the playwright provider and
  `vitest-browser-react` (named here so the plan doesn't invent it);
  local-Mac baselines per declared divergence 2(b); the no-hardcoded-values
  AND token-existence gates; codegen drift check (`git diff --exit-code`
  after regen); typecheck.
- **Integration gate**: mr-board's full suite + capture harness.
- **Workshop**: the preview app is where recipes get eyeballed in isolation
  during authoring (dark toggle + tokens page), and the live-editing surface
  during the adoption loop.

## Out of scope

- gitq board adoption (own brainstorm → spec cycle; v1 only guarantees the
  vocabulary and alias contract don't preclude it).
- The shadcn registry and any npm publishing (distribution-rung work).
- Renaming hue-intents to semantic names.
- oklch conversion of the palette (later deliberate aesthetic pass).
- Input/textarea recipes.
- The Modal/SideDrawer focus trap (ledgered mr-board follow-up; a natural
  kit improvement later).

## Risks / accepted tradeoffs

- **Soribashi is pre-v1 and paused (~2 weeks stale).** tui-kit rides the
  commit recorded in `SORIBASHI_COMMIT`; breakage or gaps become tickets
  plus local workarounds. Known soft spots that may bite: `defineCompound`
  doesn't call `autoVars` (compounds call it themselves); the
  overrides-transitives caveat above.
- **Two test stacks** (vitest in the kit, bun test in consumers) is
  deliberate: the kit follows soribashi's conventions to keep the dogfood
  honest; consumers keep their native stack.
- **Source-level consumption** means consumers typecheck kit code under
  their own tsconfig; the kit is written DOM-lib-clean, ships
  `types/css-modules.d.ts` for consumers' programs, and the mr-board
  adoption proves the arrangement.
- **file: staleness** in the dev loop is handled procedurally (workshop
  first, forced reinstall before captures) rather than structurally;
  revisit if it chafes.
