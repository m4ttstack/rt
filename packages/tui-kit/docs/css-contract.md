# The CSS contract

Two stable surfaces an app is expected to reach for: the short custom-property
aliases, and the `data-part` attributes. Both are public API. Changing either
one breaks consumers silently, with no build error on either side.

## The alias contract

`soribashi.config.ts`'s `cssVariablesResolver` injects short, board-domain CSS
custom properties at `:root`, aliasing the framework's own generated names
(`--surface-canvas`, `--color-blue-500`, ...) to the words an app's stylesheet
already uses. Components and app code alike reach for the names below, never
the underlying generated names directly.

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
| `--font-numeric` | `tabular-nums` (a literal: `font-variant-numeric` has no theme token family to alias) |
| `--terminal-bg` | the night palette's `surface.bg`, aliased directly |
| `--terminal-fg` | the night palette's `gray.fg`, aliased directly |
| `--terminal-border` | the night palette's `line.border`, aliased directly |
| `--border-soft` | already the real emitted name: `border.soft` emits `--border-soft` directly, so it is not a resolver addition |

The three `--terminal-*` values are scheme-invariant on purpose. They alias the
night palette object rather than going through `--surface-*` / `--text-*`,
because every scheme-varying token collapses its `light-dark()` once at `:root`,
so a `var()` chain can never pin a leaf element dark while the page is in day
scheme. Terminal and log boxes stay night-dark in both schemes.

`--border-soft` is a deliberate absence from the resolver, and so is anything
else whose alias name would collide with an emitted semantic name. Resolver
additions are appended later in the same `:root` block, so re-declaring
`--border-soft` as `var(--border-soft)` would overwrite the real declaration
with a self-reference and resolve to nothing.

### Do not rename or remove any of these

They are not a convenience layer over "the real names". The theme itself depends
on them: all 16 wash tokens in `src/theme.ts` (`--surface-wash-*`) are raw
`color-mix()` strings that mix `var(--panel)`, `var(--accent)`, `var(--fg)`,
`var(--bg)`, `var(--cyan)`, `var(--amber)` and `var(--border)` by name. Drop or
rename one and every wash mixing it resolves to nothing: invalid CSS, emitted
silently, with no codegen error, because a raw string is passed through
unvalidated by design. `test/theme.test.ts`'s referential-closure test is the
guard; it fails the moment a `var()` in the generated file has no matching
declaration.

## The `data-part` convention

Hashed CSS-module class names cannot be selected from an app's own stylesheet
across the package boundary, so every component stamps a stable `data-part`
attribute on its addressable elements as the cross-boundary selector hook. Two
rules, binding on every component:

- **Self-identifying values, not bare slot keys.** The root slot's value is the
  lowercased component name (`chip`, `panel`); every other slot is
  `<component>-<slot key>` (`chip-icon`, `panel-title`). A value has to work
  standing alone. `[data-part="root"]` would match every component's root and
  force an app rule to always qualify by an ancestor, while
  `[data-part="panel-title"]` is unambiguous on its own. The root's value is a
  direct drop-in replacement for the app class the component absorbed
  (`.tui-panel` becomes `[data-part="panel"]`).
- **The spread position is part of the convention.** `data-part` is stamped in
  the non-overridable tail of every component's render, after `{...rest}` and
  alongside `getStyles(...)`. It is a contract between the kit and the app's
  stylesheet, not a consumer-facing prop: a `<Chip data-part="whatever" />` that
  won the spread would silently sever every app-side `[data-part="chip"]` rule,
  with no error on either side of the boundary. Every component's browser test
  carries a "consumer-supplied data-part does not win" case pinning this.

### Every component's parts

Single-slot components keep their one value module-private rather than exporting
a record.

| component | parts |
| --- | --- |
| Alert | `{ root: "alert", command: "alert-command" }` |
| Badge | `{ root: "badge" }` |
| Button | `{ root: "button" }` |
| Chip | `{ root: "chip", icon: "chip-icon" }` |
| ConfirmDialog | `{ root: "confirmdialog", body: "confirmdialog-body", foot: "confirmdialog-foot" }` |
| ContextMenu | `{ root: "contextmenu", item: "contextmenu-item", label: "contextmenu-label", separator: "contextmenu-separator", hint: "contextmenu-hint" }` |
| CopyButton | `"copybutton"` (single slot) |
| Drawer | `{ root: "drawer", nav: "drawer-nav", back: "drawer-back", title: "drawer-title", navAction: "drawer-navaction", close: "drawer-close", header: "drawer-header", content: "drawer-content" }` |
| Field (TextField / TextArea / RadioGroup) | `{ root: "field", label: "field-label", input: "field-input", error: "field-error", option: "field-option" }` |
| Icon | `"icon"` (single slot) |
| ListGroup | `{ root: "listgroup", list: "listgroup-list", footer: "listgroup-footer", nav: "listgroup-nav", toggle: "listgroup-toggle", action: "listgroup-action", fact: "listgroup-fact", input: "listgroup-input", label: "listgroup-label", value: "listgroup-value", chevron: "listgroup-chevron" }` |
| Markdown | `"markdown"` (single slot: everything ReactMarkdown renders inside it is unaddressed, styled via plain descendant selectors) |
| Modal | `{ root: "modal", overlay: "modal-overlay", head: "modal-head", title: "modal-title", close: "modal-close" }` |
| Panel | `{ root: "panel", title: "panel-title", caret: "panel-caret", count: "panel-count", body: "panel-body" }` |
| Segmented / LabeledSeg | `{ root: "segmented", option: "segmented-option" }` (one CSS shape, shared by both) |
| SelectBox | `"selectbox"` (single slot) |
| SideDrawer | `{ root: "sidedrawer", overlay: "sidedrawer-overlay" }` |
| Spinner | `{ root: "spinner" }` |
| StatusDot | `{ root: "statusdot", dot: "statusdot-dot", card: "statusdot-card" }` |
| Switch | `{ root: "switch", control: "switch-control", label: "switch-label" }` |
| Table | `{ root: "table", table: "table-table", head: "table-head", headcell: "table-headcell", body: "table-body", row: "table-row", cell: "table-cell" }` |
| ToastHost | `{ root: "toasthost", toast: "toasthost-toast" }` |
| Tooltip | `{ root: "tooltip", card: "tooltip-card" }` |

`DRAWER_PARTS.root` is the one value never stamped on a DOM node. Query
`[data-part="sidedrawer"]` for Drawer's panel instead.

## Button variant colours

Button's `variant` axis is `default` / `light` / `outline` / `subtle`,
Mantine-derived: `light` is close to Mantine's `light` and `subtle` to Mantine's
`subtle`, while `default` is the neutral bordered-surface button with no Mantine
equivalent by that name.

Variant colours are resolver-computed. Never hand-write variant colour CSS.
`Button.module.css` consumes `--button-bg` / `-color` / `-border` / `-hover`
(and `-hover-color` where a variant needs it), sourced from the intent resolver
via `autoVars`. See soribashi's `authoring-a-recipe` skill, "Variant colors",
for the mechanism.

`src/a11y/known-contrast-debt.ts` is a ratchet for Button `(intent, variant,
scheme)` rest-state cells that measure below the WCAG AA 4.5:1 floor under the
Tokyo Day/Night look. It is currently empty: every cell clears the floor via the
intent resolver's per-intent `color` retune. The ratchet contract, enforced by
`Button.matrix.test.tsx`, is that an entry may only be removed or improved,
never silently worsened and never used to admit a new below-floor cell.
