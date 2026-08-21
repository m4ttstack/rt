# @mattstack/tui-kit

The mattstack TUI look, packaged as a [soribashi](https://github.com/m4ttheweric/soribashi)
component library. Currently source-consumed by mr-board; no published releases of the
kit itself yet.

## What this is

A theme + recipe library (`createTheme`, hooks, and hand-rolled compound components)
built on the `soribashi` framework, consumed from the registry as an ordinary semver
dependency (`@soribashi/core`).

**Kit v1's public surface is frozen (Milestone A complete):** every recipe listed
below, the hooks family, and `tuiTheme` are all re-exported from the package root
(`@mattstack/tui-kit`). Milestone B is mr-board's own adoption of this surface — see
`docs/superpowers/specs/2026-08-19-tui-kit-design.md` for the full design and the
`mr-board` SDD ledger for the task-by-task build/adoption record.

## Setup

```sh
bun install
```

That is the whole story. `@soribashi/core` is an ordinary registry dependency, so
there is no sibling checkout to clone, no install ordering to respect, and no
`overrides` block to keep in sync. (`bun run setup` is an alias for the same
command, kept so the script name in older docs still works.)

### The wiring, exactly

**This section is about THIS repo's own dependencies — for people hacking on the
kit.** An app that merely *consumes* the kit needs even less: see
"[Wiring an adopter app](#wiring-an-adopter-app)" below.

`package.json` declares ONE soribashi package:

```json
"@soribashi/core": "^0.1.0"
```

`@soribashi/core` is the whole framework in a single package — the theme model,
the component factory, and the `soribashi` codegen CLI. It exposes two entry
points and ships the CLI as a bin:

| specifier | what it is | used here by |
| --- | --- | --- |
| `@soribashi/core` | theme model + component factory (`makeBuilders`, `createTheme`, `registerTheme`, `SoribashiProvider`, the `IntentResolver` types) | every recipe, `src/theme.ts`, `src/builders.ts`, `src/provider.ts`, `src/intent-resolver.ts` |
| `@soribashi/core/codegen` | the codegen types (`CssVariablesResolver`) | `soribashi.config.ts` |
| `soribashi` (bin) | the CSS codegen CLI, run by `bun run codegen` | `package.json`'s `codegen`/`gates` scripts |

Because core brings its own `clsx`, `tailwind-merge`, and `zod`, this repo does
NOT declare them. Nothing in `src/` imports any of the three directly; they were
only ever named here because `file:`-delivered packages don't install their own
transitive dependencies. Registry packages do.

`react-markdown` and `remark-gfm` are ordinary top-level dependencies (not part
of the soribashi wiring at all) — the Markdown recipe's only two non-soribashi
runtime dependencies, pinned to the same versions mr-board's own
`src/client/ui/Markdown.tsx` used.

**Version policy.** The `^0.1.0` range IS the pin — bumping soribashi means
editing that range and running `bun install`, with `bun.lock` recording the
exact resolved version. There is no separate commit-pin file to keep honest
(there used to be: see the appendix). After any bump, run `bun run gates`: the
codegen drift check re-runs the PUBLISHED `soribashi build` against
`soribashi.config.ts` and fails if `src/generated/theme.css` would change, which
is the cheapest possible detector for a soribashi release moving the CSS out
from under this kit.

One consequence of consuming a published package worth knowing: core's `.`
export resolves to **compiled `dist/`**, not TypeScript source. That retires a
whole class of friction the `file:` era had — the factory's own
`@ts-expect-error` suppressions are no longer re-checked under this repo's
tsconfig, so the `TS2578: Unused '@ts-expect-error' directive` errors that once
forced `types: ["node"]` can no longer occur from inside `node_modules`. (The
`types: ["node"]` setting stays for its own independent reasons — `scripts/`
and `test/` genuinely use node APIs.) The browser test tier is what confirms
the compiled factory behaves identically to the source one.

`workshop/` carries its own real `package.json` (a Vite React app, `workspaces:
["workshop"]` at the root) — see "Workshop" below.

## Public surface

`@mattstack/tui-kit` (the package root, `src/index.ts`) re-exports every recipe,
the hooks family, and `tuiTheme` — this is the finalized barrel (controller ruling
R9). The subpath exports keep working unchanged and are not superseded by the
barrel; reach for one directly when you want a narrower import:

| subpath | resolves to | when to use it directly |
| --- | --- | --- |
| `@mattstack/tui-kit` | `src/index.ts` | recipes + hooks + `tuiTheme`, the common case |
| `@mattstack/tui-kit/hooks` | `src/hooks/index.ts` | only the hooks, no recipe module graph |
| `@mattstack/tui-kit/theme` | `src/theme.ts` | only `tuiTheme`, e.g. feeding a `createTheme({ extends })` call |
| `@mattstack/tui-kit/provider` | `src/provider.ts` | `registerTheme` + `SoribashiProvider` for an app entry, without the recipe module graph |
| `@mattstack/tui-kit/theme.css` | `src/generated/theme.css` | the generated CSS custom properties — import once, at an app entry |
| `@mattstack/tui-kit/canvas.css` | `src/canvas.css` | opt-in page canvas reset — see below |

### Wiring an adopter app

**One dependency, and nothing else: an adopter declares `@mattstack/tui-kit` and
no `@soribashi/*` package at all.**

```jsonc
// the adopter's package.json — this is the whole soribashi story
"dependencies": {
  "@mattstack/tui-kit": "file:../tui-kit"
}
```

No `overrides` block. Adopters used to need a two-line one, because installing
the kit made bun walk into this repo's `package.json`, find `@soribashi/*`
`file:` dependencies, and fail to resolve their internal `"workspace:*"`
requirements (`error: @soribashi/theme@workspace:* failed to resolve`). Now that
this repo depends on a single registry package, there is no `workspace:*` left
anywhere in the graph to rescue — an adopter that still carries that block can
delete it, and one that never had it will not miss it.

```tsx
// the adopter's app entry
import { registerTheme, SoribashiProvider } from "@mattstack/tui-kit/provider";
import { tuiTheme } from "@mattstack/tui-kit/theme";
import "@mattstack/tui-kit/theme.css";
import "@mattstack/tui-kit/canvas.css";   // optional, see below

registerTheme(tuiTheme);                   // module scope, before render

createRoot(el).render(
  <SoribashiProvider theme={tuiTheme}>
    <App />
  </SoribashiProvider>,
);
```

Both halves are mandatory and neither substitutes for the other:
`registerTheme()` is what the `makeBuilders()`-produced components read to
resolve tokens/vocabulary/intent, `<SoribashiProvider>` is what `useTheme()`
reads inside the tree. `workshop/src/main.tsx` is the live example.

**Import them from the kit, never from `@soribashi/core` directly.** This is
still true with soribashi on the registry, and it is the more important of the
two archaeological bugs to remember: adding `@soribashi/core` to an adopter's
own `package.json` produces wiring that installs, type-checks, boots — and is
silently wrong.

The reason is that **bundlers key module identity by resolved path**, and a
registry package does not change that. An adopter's own `@soribashi/core`
resolves through the adopter's `node_modules`; a file inside this kit has
its leaf symlink realpathed to the kit's checkout first, so the same specifier
resolves from `tui-kit/node_modules/`. Same package, same published version,
byte-identical files (usually hardlinked to one inode) — but two paths, so two
module records in the bundle: two `SoribashiContext` objects, two vocabulary
registries, two `createTheme` implementations. `registerTheme()` writes one
registry while the recipes read the other, and a recipe's `useTheme()` finds no
Provider above it and falls back to the DEFAULT theme. No error, no warning,
just wrong colours. Measured on mr-board before this export existed: 2x
`provider/context.ts`, 2x `vocabulary-registry.ts`, 2x `create-theme.ts` in one
bundle.

Importing through the kit collapses that to one identity by construction —
these symbols travel the same resolved path as `tuiTheme` and every recipe.
If you ever suspect a double instance, group your bundle's emitted module-path
comments by package root; do not trust `node_modules` inspection or
`Bun.resolveSync`, neither of which reflects what the bundler actually does.

`@mattstack/tui-kit` (the barrel) re-exports the same two names, for an app that
is already importing recipes from it. The subpath exists because an app entry
usually wants only the wiring, and the barrel drags every recipe's module graph
— and every `.module.css` — along with it.

A `file:`-era hazard that the registry migration RETIRED: soribashi's factory
used to ship its types as TypeScript source, so its `@ts-expect-error`
suppressions were re-checked under the *consumer's* tsconfig, and any consumer
declaring `import.meta.env` (any `types: ["bun"]` project) saw two `TS2578:
Unused '@ts-expect-error' directive` errors from inside `node_modules`.
`@soribashi/core` ships compiled `.d.ts` files, so a consumer's tsconfig no
longer type-checks soribashi's own source and the error class is gone.

**The `types/css-modules.d.ts` include.** Every recipe imports its own
`.module.css` (`import styles from "./Chip.module.css"`), which `tsc` can only
type-check if *some* `.d.ts` in the program declares what a `*.module.css`
import resolves to. This kit ships that declaration at the
`./types/css-modules.d.ts` export precisely so an adopter never has to author
it for source it doesn't own — but because it's an ambient module
declaration, not a value or type any file imports, it has to be pulled in via
`include`, not `import`. Add it as one more entry in the adopter's tsconfig
`include` array, alongside the app's own source glob:

```jsonc
// the adopter's tsconfig.json (mr-board's src/client/tsconfig.json, verbatim)
"include": [
  "./**/*",
  "../../node_modules/@mattstack/tui-kit/types/css-modules.d.ts"
]
```

Skip it and the FIRST `tsc` run through this kit's source fails with `Cannot
find module './Chip.module.css' or its corresponding type declarations` — not
a bug in the adopter's own code, just a program that was never told what a
`.module.css` specifier means. The relative path to `node_modules` depends on
where the adopter's tsconfig actually sits; mr-board's is two directories
below its `node_modules`, hence `../../`.

### Recipes

Chip, ContextMenu, CopyButton, Icon, Markdown, Modal, Panel, Segmented (+
LabeledSeg), SelectBox, SideDrawer, StatusDot, ToastHost. Each is a
`Recipe.extend({...})`-first-class soribashi component; each ships a
`<name>Theme = Recipe.extend({})` convenience export for a `createTheme({
components: [...] })` call to start from.

### Button variants

Button's `variant` axis is `default` / `light` / `outline` / `subtle`, Mantine-derived (`light` ≈ Mantine's `light`, `subtle` ≈ Mantine's `subtle`; `default` is the neutral bordered-surface button, with no Mantine equivalent by that name).

Variant colors are resolver-computed — never hand-write variant color CSS. `Button.module.css` consumes `--button-bg`/`-color`/`-border`/`-hover` (and `-hover-color` where a variant needs it), sourced from soribashi's intent resolver via `autoVars`; see soribashi's `authoring-a-recipe` skill's "Variant colors" section for the mechanism.

`src/a11y/known-contrast-debt.ts` ratchets a fixed list of pre-existing Button (intent, variant, scheme) cells that measure below WCAG AA under the human-approved Tokyo Day/Night look — known debt pending a design retune, not something a recipe change is expected to silently fix or worsen.

### Hooks

Nine, all DOM-free at their core (each pairs a small React hook with a pure,
independently-testable function): `pushLayer`, `handleEscape`,
`acquireScrollLock`, `releaseScrollLock`, `useRevealOnChange`,
`useEscapeClose`, `useAutoGrowTextarea`, `useBodyScrollLock`, `useToasts`.

## The alias contract (19 names, 18 resolver-injected)

`soribashi.config.ts`'s `cssVariablesResolver` injects 18 short, board-domain
CSS custom properties at `:root`, aliasing soribashi's own generated names
(`--surface-canvas`, `--color-blue-500`, ...) to the words mr-board's stylesheet
already uses ~234 times. The table below lists 19 names because `--border-soft`
belongs to the same board-domain vocabulary and every recipe reaches for it the
same way, but it is NOT one of the resolver's injections — `border.soft` already
emits `--border-soft` directly as its real semantic-token name (see the table's
own note), so the resolver deliberately does not re-declare it (re-declaring it
LATER in the same `:root` block, which is where resolver additions land, would
overwrite the real declaration with a self-reference and resolve to nothing).
This is the kit's STABLE public CSS surface either way — recipes and app code
alike reach for every name below, never the underlying generated names directly:

| alias | resolves to |
| --- | --- |
| `--bg` | `var(--surface-canvas)` |
| `--panel` | `var(--surface-panel)` |
| `--card` | `var(--surface-card)` |
| `--fg` | `var(--text-primary)` |
| `--muted` | `var(--text-muted)` |
| `--border` | `var(--border-default)` |
| `--accent` | `var(--color-blue-500)` |
| `--green` | `var(--color-green-500)` |
| `--red` | `var(--color-red-500)` |
| `--amber` | `var(--color-amber-500)` |
| `--purple` | `var(--color-purple-500)` |
| `--cyan` | `var(--color-cyan-500)` |
| `--grid-line` | `var(--color-line-grid)` |
| `--dot-ok` | `var(--color-dot-ok)` |
| `--dot-warn` | `var(--color-dot-warn)` |
| `--dot-bad` | `var(--color-dot-bad)` |
| `--font-mono` | `var(--font-family-mono)` |
| `--font-sans` | `var(--font-family-sans)` |
| `--border-soft` | (already the real emitted name — `border.soft` emits `--border-soft` directly; not a resolver addition) |

**Do not rename or remove any of these.** They are not a convenience layer over
"the real names" — the theme itself depends on them: every wash token in
`src/theme.ts` (`--surface-wash-*`, 16 of them) is a raw `color-mix()` string that
mixes `var(--panel)`, `var(--accent)`, `var(--fg)`, `var(--bg)`, `var(--cyan)`,
`var(--amber)`, and `var(--border)` BY NAME. Drop or rename one and every wash
mixing it resolves to nothing — invalid CSS, emitted silently, no codegen error.
`test/theme.test.ts`'s referential-closure test is the guard.

## The `data-part` convention

Hashed CSS-module class names cannot be selected from mr-board's own residual
`style.css` across the package boundary, so every recipe stamps a stable
`data-part` attribute on its addressable elements as the cross-boundary selector
hook. Two rules, binding on every recipe (controller ruling R7):

- **Self-identifying values, not bare slot keys.** The root slot's value is the
  lowercased recipe name (`chip`, `panel`); every other slot is
  `<recipe>-<slot key>` (`chip-icon`, `panel-title`). A value has to work standing
  alone — `[data-part="root"]` would match every recipe's root and force an app
  rule to always qualify by an ancestor; `[data-part="panel-title"]` is
  unambiguous on its own. The root's value is the direct drop-in replacement for
  the board class the recipe absorbed (`.tui-panel` → `[data-part="panel"]`).
- **The spread position is part of the convention.** `data-part` is stamped in the
  NON-OVERRIDABLE TAIL of every recipe's render — after `{...rest}`, alongside
  `getStyles(...)`. It is a contract between the kit and mr-board's stylesheet,
  not a consumer-facing prop: a `<Chip data-part="whatever" />` that won the
  spread would silently sever every app-side `[data-part="chip"]` rule, with no
  error on either side of the boundary. Every recipe's browser test carries an "a
  consumer-supplied data-part does not win" case pinning this.

Every recipe's PARTS, verbatim (single-slot recipes keep their one value
module-private rather than exporting a record — Icon, CopyButton, SelectBox,
Markdown):

| recipe | parts |
| --- | --- |
| Chip | `{ root: "chip", icon: "chip-icon" }` |
| ContextMenu | `{ root: "contextmenu", item: "contextmenu-item", label: "contextmenu-label", separator: "contextmenu-separator", hint: "contextmenu-hint" }` |
| CopyButton | `"copybutton"` (single slot) |
| Icon | `"icon"` (single slot) |
| Markdown | `"markdown"` (single slot — everything ReactMarkdown renders inside it is unaddressed, styled via plain descendant selectors) |
| Modal | `{ root: "modal", overlay: "modal-overlay", head: "modal-head", title: "modal-title", close: "modal-close" }` |
| Panel | `{ root: "panel", title: "panel-title", caret: "panel-caret", count: "panel-count", body: "panel-body" }` |
| Segmented / LabeledSeg | `{ root: "segmented", option: "segmented-option" }` (one CSS shape, shared by both recipes) |
| SelectBox | `"selectbox"` (single slot) |
| SideDrawer | `{ root: "sidedrawer", overlay: "sidedrawer-overlay" }` |
| StatusDot | `{ root: "statusdot", dot: "statusdot-dot" }` |
| ToastHost | `{ root: "toasthost", toast: "toasthost-toast" }` |

## `canvas.css` (optional)

`@mattstack/tui-kit/canvas.css` is the page-level ground: a `* { box-sizing:
border-box; }` reset, `body`'s base type/background/graph-paper grid, and the
`.tui`/`.tui-wide` column-measure containers — an exact reproduction of
mr-board's own page canvas.

**No recipe requires it.** Every recipe's own stylesheet is self-contained
(`@layer soribashi.recipes`, fully token-backed); `canvas.css` styles `body`
directly and the handful of layout containers, which is squarely app-shell
territory, not component territory. Import it from an app entry point (never
`@import` it from a raw-served stylesheet — it is a module CSS-adjacent asset
meant to go through a bundler) only when you want the whole board-identity page
background and type scale; a consumer building their own page shell around the
recipes never needs it.

## The soribashi version, and the ref casts it made eligible for removal

The version policy lives in
"[The wiring, exactly](#the-wiring-exactly)": the `^0.1.0` range in
`package.json` is the pin, and `bun.lock` records the exact resolved version.
There is no longer a `SORIBASHI_COMMIT` file — it existed because `file:` deps
consumed a sibling checkout's *working tree* rather than a published version,
so the only honest record of what the recipes were built against was a commit
SHA written down by hand. A semver dependency records that itself.

**`0.1.0` includes every fix batch discovered while authoring this kit's
recipes** (SORI-6, -9, -10, -11, -12, -13a, -15, -16, -18, -20, SORI-7's
`@property` syntax fix, plus **SORI-14** — every builder hardcoding
`Ref<HTMLElement>` on its render ctx). SORI-14 shows up as TWO DIFFERENT
symptoms in this kit's recipes, not one — worth distinguishing rather than
lumping together:

- **A genuine bidirectional type mismatch (Icon's `<svg>` root).**
  `SVGSVGElement` is not assignable to or from `HTMLElement` (it is missing
  `accessKey`, `autocapitalize`, and 26 more members — see
  `src/recipes/Icon/Icon.tsx`'s doc comment for the exact compiler error), so
  the cast is load-bearing in both directions: inside the recipe AND for any
  future consumer who wants to pass their own `useRef<SVGSVGElement>` to
  `<Icon ref={...} />`.
  Icon is the only recipe with a non-`HTMLElement` root today, so it is the
  only one with this symptom.
- **A narrowing cast, not a mismatch (Segmented's `<span>`, Markdown's
  `<div>`).** `HTMLSpanElement`/`HTMLDivElement` are both real SUBTYPES of
  `HTMLElement` (they extend it, adding nothing incompatible) — the cast here
  exists only because TypeScript's contravariant checking of `Ref`'s function-
  signature parameter rejects narrowing `Ref<HTMLElement>` to `Ref<HTMLSpanElement>`
  even though it is safe (every `HTMLSpanElement` genuinely IS an `HTMLElement`).
  This is a real friction (an unnecessary cast at every such recipe's render
  call) but not the same defect class as Icon's: nothing is actually
  incompatible, and a future consumer's own `useRef<HTMLDivElement>` faces the
  identical narrowing annoyance, not an impossible assignment.

Both symptoms trace to the same root cause (the render ctx's `ref` type should
be generic over the recipe's actual root element, defaulting to `HTMLElement`,
the way the polymorphic builder already threads `TDefaultAs`) and SORI-14 fixes
both at once — the distinction above is about how each recipe experiences the
bug today, not about needing two separate upstream fixes. **SORI-14 is in
`0.1.0`**, but every recipe's `ref={ref as Ref<...>}` cast is still in place —
shipping the fix upstream does not make the casts unnecessary, it only makes
them ELIGIBLE for removal now that the generic ref type exists. Dropping them
is a future cleanup, deliberately not done here; each cast site still carries
its own workaround comment until that pass happens.

## Adoption notes

Two mr-board call sites need MORE than a mechanical "delete the board class,
render the recipe" swap. Both are about the Markdown recipe specifically,
recorded here because Milestone B's adoption task reads this README, not the
recipe's own source, as its entry point.

**`.tui-review-body .tui-md` (style.css:822) must SURVIVE, rewritten, not be
deleted.** `.tui-review-body .tui-md { max-width: 820px; margin: 0 auto;
padding-bottom: 1.5rem; }` is a CONTEXTUAL rule keyed on an ancestor
(`.tui-review-body`, the review modal's scrolling body) — it is not part of
`.tui-md`'s own typography and was never lifted into the Markdown recipe
(a recipe has no ancestor to key off). It reads exactly like one of the
`.tui-md` rules the adoption task is told it may delete once the recipe
absorbs them, but deleting it silently drops the review modal's 820px reading
measure and center alignment. It survives adoption rewritten onto the
recipe's `data-part`:

```css
.tui-review-body [data-part="markdown"] {
  max-width: 820px;
  margin: 0 auto;
  padding-bottom: 1.5rem;
}
```

See `src/recipes/Markdown/Markdown.module.css`'s header comment for the same
warning at the point a recipe-reader is most likely to see it.

**CommentsDrawer.tsx needs `unstyled`, or it silently changes comment-body
typography.** `CommentsDrawer.tsx` renders `<Markdown linkTargetBlank>`
directly inside `<div className="tui-cd-note-body">` — a SEPARATE,
board-owned prose block that was never `.tui-md`. Adopting the recipe there
as-is is NOT a no-op: `.root`'s own `font-family`/`font-size`/`line-height`
sit directly on the element ReactMarkdown mounts into (which wins over
`.tui-cd-note-body`'s inherited font regardless of layer ordering — a
property set on the element itself always beats one inherited from an
ancestor), and the recipe's layered `h1`-`h6`/`pre`/`table`/... rules apply
with no unlayered `.tui-cd-note-body` competitor there to lose to. The result
is comment bodies picking up `.tui-md` typography they never had — a real,
pixel-gate-visible change, not a refactor.

The Styles API's own `unstyled` prop (every builder reads it off props
automatically, before `render` runs) suppresses `.root`'s CSS-module class
entirely, leaving `.tui-cd-note-body`'s own rules to apply exactly as they do
today; `data-part="markdown"` is still stamped either way (it is hand-stamped
independently of the class resolution `unstyled` suppresses). The adoption
task at this call site is a real decision, not a mechanical default:

```tsx
<Markdown unstyled linkTargetBlank>{note.body}</Markdown>
```

**`unstyled` is the choice that PRESERVES PARITY** with mr-board's current
rendering. Adopting without it — plain `<Markdown linkTargetBlank>{note.body}</Markdown>`
— is a deliberate opt-in to `.tui-md` typography inside comment bodies, and
should be made knowingly, not by omission. See
`src/recipes/Markdown/Markdown.tsx`'s own doc comment and
`Markdown.test.tsx`'s "unstyled suppresses the recipe's own stylesheet" case
for the pinned, verified mechanism.

## Workshop

`workshop/` is a small Vite + React app that renders every recipe live, in both
colour schemes, for manual/visual verification — the loop every recipe task in
this kit's build used before committing.

```sh
bun run dev:workshop   # cd workshop && bunx vite
```

Then open the printed local URL. The sidebar's **Dark** button flips the `.dark`
class on `<html>` — soribashi's whole dark-mode mechanism (`light-dark()` +
`color-scheme`, `src/theme.ts`'s `darkMode: { selector: ".dark" }`) — so every
page's colours follow it with no page-local toggle needed. `tokens` is the
landing page (a full token audit); every recipe gets its own page after it,
alphabetically.

`workshop/vite.config.ts` aliases `@mattstack/tui-kit` straight to the live
`../src` tree (never an installed copy), so every workshop page imports from the
BARREL (`@mattstack/tui-kit`) exactly the way a real consumer would — a deep
`../../src/recipes/...` import in a workshop page would quietly pass even if the
barrel forgot the export, which defeats the point of using the workshop as a
surface check.

## Status

Milestone A (kit build) is complete: every recipe above, the hooks family, and
`tuiTheme` are shipped and the public surface (this README) is frozen. Milestone
B — mr-board's own adoption of this kit, recipe by recipe, deleting the
board-side CSS/markup each recipe absorbed — is tracked in the `mr-board` SDD
ledger, not in this repo.

## Appendix: the `file:` era (historical)

Before `@soribashi/core` was published, this repo consumed soribashi from a
sibling `../soribashi` checkout as four separate `file:` packages
(`core`, `codegen`, `theme`, `factory`) plus a two-line `overrides` block. None
of that is needed now, and the mechanics are recorded here only because the two
bugs behind them are worth recognising if similar wiring ever reappears.

**Bug 1 — `overrides` do not reach a nested `workspace:*`.** `core`'s and
`codegen`'s own dependencies on `theme`/`factory` were declared
`"workspace:*"`, which means nothing outside soribashi's own workspace.
`overrides` alone did not fix them: with only `core`/`codegen` as direct
dependencies, `@soribashi/factory`'s own `"@soribashi/theme": "workspace:*"`
never got linked into factory's install location, on Bun 1.3.13, no matter how
many times `bun install` was re-run. The workaround was to ALSO declare
`theme` and `factory` as direct dependencies, putting them in root
`node_modules` where factory's runtime walk-up resolution found them regardless
of the unresolved nested link. Two overlapping link paths for the same package
then produced a transient `EEXIST: failed to link package` race on roughly one
in three clean installs, which is why `scripts/setup.sh` ran `bun install`
twice and trusted only the second exit status. A registry package declares
ordinary semver dependencies, so none of this arises: the current clean install
is a single `bun install` with no overrides and no race.

**Bug 2 — two module identities in one bundle.** Recorded in full under
"[Wiring an adopter app](#wiring-an-adopter-app)", because unlike Bug 1 it is
NOT retired by publishing: bundlers still key module identity by resolved path,
so an adopter that declares its own `@soribashi/core` alongside the kit still
gets two `SoribashiContext` objects and silently wrong colours. Import the
wiring from `@mattstack/tui-kit/provider`.
