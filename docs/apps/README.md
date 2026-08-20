# @mattstack/tui-kit

The mattstack TUI look, packaged as a [soribashi](https://github.com/) component library.
Currently source-consumed by mr-board; no published releases yet.

## What this is

A theme + recipe library (`createTheme`, hooks, and hand-rolled compound components)
built on the unpublished `soribashi` framework, consumed from a sibling checkout via
verified `file:` + `overrides` wiring (not workspace protocol — soribashi is not a
member of this repo's workspace).

**Kit v1's public surface is frozen (Milestone A complete):** every recipe listed
below, the hooks family, and `tuiTheme` are all re-exported from the package root
(`@mattstack/tui-kit`). Milestone B is mr-board's own adoption of this surface — see
`docs/superpowers/specs/2026-08-19-tui-kit-design.md` for the full design and the
`mr-board` SDD ledger for the task-by-task build/adoption record.

## Setup

Requires a sibling checkout at `../soribashi` (relative to this repo) that has
already been `bun install`ed.

```sh
bun run setup   # sh scripts/setup.sh — installs, twice (see script comment)
```

### The wiring, exactly

`package.json`'s `dependencies` declares FOUR soribashi packages directly, all as
`file:` pointers into the sibling `../soribashi` checkout — not two, even though
only `@soribashi/core` and `@soribashi/codegen` are imported directly anywhere in
this repo's source:

```json
"@soribashi/core": "file:../soribashi/packages/core",
"@soribashi/codegen": "file:../soribashi/packages/codegen",
"@soribashi/theme": "file:../soribashi/packages/theme",
"@soribashi/factory": "file:../soribashi/packages/factory"
```

plus an `overrides` block redirecting `@soribashi/theme` and `@soribashi/factory` to
those same `file:` paths, so that `core`'s and `codegen`'s own internal
`"workspace:*"` requests for them resolve too:

```json
"overrides": {
  "@soribashi/theme": "file:../soribashi/packages/theme",
  "@soribashi/factory": "file:../soribashi/packages/factory"
}
```

**Both halves are necessary.** `overrides` alone does not reach a nested
`workspace:*` dependency one level inside an already-overridden `file:` package
— confirmed empirically: with only `core`/`codegen` as direct dependencies,
`@soribashi/factory`'s own `"@soribashi/theme": "workspace:*"` never got linked, on
Bun 1.3.13, no matter how many times `bun install` was re-run. Declaring
`theme`/`factory` directly puts them in root `node_modules`, where `factory`'s
runtime walk-up module resolution finds them regardless of that unresolved nested
link.

`clsx`, `tailwind-merge`, and `zod` are ALSO declared as top-level `dependencies`
(ranges copied verbatim from `soribashi/packages/{factory,theme}/package.json`),
because overrides-delivered `file:` packages don't install their own transitive
deps — `bun install` never walks into `../soribashi/packages/factory/package.json`
to resolve what IT needs, so this repo has to name those three itself or the
recipes fail at runtime with an unresolved import.

`react-markdown` and `remark-gfm` are ordinary top-level dependencies (not part of
the soribashi wiring at all) — the Markdown recipe's only two non-soribashi
runtime dependencies, pinned to the same versions mr-board's own
`src/client/ui/Markdown.tsx` used.

**The double install (`scripts/setup.sh`).** Two `bun install` runs, and the
reason has shifted since the script was first written: now that direct
dependencies fix the wiring (see above), a single install is USUALLY enough — but
on a genuinely clean `node_modules` the first install occasionally hits a
transient `EEXIST: failed to link package` race (observed ~1/3 of clean runs),
because `@soribashi/theme` is linked via two paths (the direct dependency and the
override target) concurrently; that race exits `bun install` non-zero even though
`node_modules` ends up correct. The first install is allowed to fail for that
reason; the second install is the one whose exit status is trusted.
`scripts/setup.sh`'s own header comment carries the same explanation in full,
next to the code that acts on it — read it before touching either install line.

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
| `@mattstack/tui-kit/theme.css` | `src/generated/theme.css` | the generated CSS custom properties — import once, at an app entry |
| `@mattstack/tui-kit/canvas.css` | `src/canvas.css` | opt-in page canvas reset — see below |

### Recipes

Chip, ContextMenu, CopyButton, Icon, Markdown, Modal, Panel, Segmented (+
LabeledSeg), SelectBox, SideDrawer, StatusDot, ToastHost. Each is a
`Recipe.extend({...})`-first-class soribashi component; each ships a
`<name>Theme = Recipe.extend({})` convenience export for a `createTheme({
components: [...] })` call to start from.

## The alias contract (19 names)

`soribashi.config.ts`'s `cssVariablesResolver` emits 19 short, board-domain CSS
custom properties at `:root`, aliasing soribashi's own generated names
(`--surface-canvas`, `--color-blue-500`, ...) to the words mr-board's stylesheet
already uses ~234 times. This is the kit's STABLE public CSS surface — recipes and
app code alike reach for these, never the underlying generated names directly:

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

## The SORIBASHI_COMMIT pin

This repo pins against soribashi at the commit recorded in `SORIBASHI_COMMIT`
(currently `e5e1a217b347f789116fdfa05cf254b44a7f42cb`). Bump it manually when
picking up new soribashi changes — there is no automated sync, and bumping means:
update `SORIBASHI_COMMIT`, `git -C ../soribashi checkout <commit>` (or otherwise
bring the sibling checkout to that commit), `bun install` (the `file:` links
already point at the checkout, so no dependency-version edit is needed), then
`bun run gates` to catch anything the new soribashi build changed under this
kit's feet.

**The current pin includes every fix batch discovered while authoring this kit's
recipes**, landed upstream in soribashi across the build (SORI-6, -9, -10, -11,
-12, -13a, -15, -16, -18, -20, plus SORI-7's `@property` syntax fix, which is the
commit actually pinned). One known fix is NOT yet pulled: **SORI-14** (the
builders' hardcoded `Ref<HTMLElement>` render-ctx type, filed against Icon's svg
root — see `src/recipes/Icon/Icon.tsx`'s doc comment) landed in soribashi one
commit after the current pin and has not been picked up; every recipe with a
non-`HTMLElement` root (Icon's `<svg>`, Segmented's/Markdown's cast div/span)
still carries the local `ref={ref as Ref<...>}` workaround documented at its own
cast site. Bumping the pin to pick up SORI-14 is a reasonable next slice but is
not required for anything in this kit today — nothing here takes a recipe ref.

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
