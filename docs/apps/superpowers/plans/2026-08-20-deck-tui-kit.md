# Deck → tui-kit Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild deck's board and gateway pages as React apps on @mattstack/tui-kit, growing the kit by eight recipes proven by deck as its third consumer.

**Architecture:** Two acts in one plan. Act 1 (tasks 1–9, repo `~/Documents/GitHub/tui-kit`) adds Spinner, Button, Badge, Switch, the Field family, Alert, Table, and ConfirmDialog plus 11 Icon glyphs, each with workshop demo and visual baselines. Act 2 (tasks 10–19, repo `~/Documents/GitHub/local-apps`) replaces the Alpine/Oat board with a React client whose built bundle is committed and embedded in the compiled binary, converts the gateway pages to request-time `renderToStaticMarkup`, and lands fixture mode, Playwright DOM tests, and a pixel-capture harness with fresh Tokyo baselines.

**Tech Stack:** React 19, @mattstack/tui-kit (file:../tui-kit), @soribashi/core (transitively), Bun.build, bun:test, vitest browser (kit), Playwright + pixelmatch (deck).

**Spec:** `docs/superpowers/specs/2026-08-20-deck-tui-kit-design.md` (this repo). Read it before any task; it is the binding authority.

## Global Constraints

- **No kit vocabulary growth**: recipes express themselves in the existing `tuiVocabulary` (`size` xs–xl, `intent` accent/ok/warn/bad/cyan/purple/muted, `variant` outline/subtle/ghost). Recipe-local scalar props (like StatusDot's three-value `intent`) are allowed where the spec says so.
- **No server/API changes** in local-apps beyond the files this plan names: UI asset serving, the fixture guard, and `gateway-pages`. The `/api/v1/*` contract is frozen.
- **`@soribashi/core` is never a direct dependency of local-apps.** Provider and theme come from `@mattstack/tui-kit` / `@mattstack/tui-kit/provider`.
- **Every client bundle build uses the react-singleton onResolve plugin** (Task 11 defines it; reference `mr-board/src/server.ts:371-378`).
- **Built client artifacts are committed** (`core/generated/`); `core/board-assets.ts` embeds them via static imports (`with { type: "text" }`). Both boot paths must keep working: `bun run src/main.ts serve` from checkout and `bun run build` → `dist/deck`.
- **Accessibility semantics are parity-frozen**: every `aria-label`, `title`, `role="switch"`, `role="alert"`, `role="dialog"` and the `accessSummary` sentence from the old board carry over verbatim.
- **Timings are parity-frozen**: 5000ms poll, 30000ms restart timeout, 45000ms proxy wait, 120000ms heal-recent window.
- **Clean-code comments rule** (`~/.claude/rules/clean-code-comments.md`) binds all code in both repos: constraint comments only; no decision-history, reviewer-facing, or narration comments. Decision records go in the task report file, never in source.
- **Kit gates must stay green after every kit task**: `bun run gates`, `bun run typecheck`, `bun run test` in tui-kit.
- **local-apps suite must stay green after every deck task**: `bun test` (287 tests today; only `core/board-assets.test.ts` and gateway-page markup assertions may change, each retired assertion mapping to an Oat/Alpine-era specific).
- Kit recipe conventions are law: read `soribashi`'s authoring-a-recipe skill notes via the neighbouring recipes — every new recipe follows the shapes in `src/recipes/StatusDot/` (simple), `src/recipes/Chip/` (variants), `src/recipes/Modal/` (overlay): `recipeCategory` export, `<NAME>_SELECTORS`, `<NAME>_PARTS` (root = lowercased recipe name, other slots `<recipe>-<slot>`), `classes` from a module.css wrapped in `@layer soribashi.recipes`, non-overridable tail order (`{...rest}` → `getStyles` → `data-part`), Styles-API key destructuring (`classNames`/`styles`/`vars`/`attributes`/`unstyled` stripped from rest), `<name>Theme = X.extend({})`, alphabetical export block in `src/index.ts`, workshop page registered in `workshop/src/App.tsx`, visual test following `StatusDot.visual.test.tsx` (no-motion style, `renderWithTheme`, light + dark captures).
- CSS token discipline: recipe CSS uses only emitted tokens/aliases (`--bg --panel --card --fg --muted --border --border-soft --accent --green --red --amber --purple --cyan --dot-ok --dot-warn --dot-bad --font-mono --font-sans`, `--spacing-*`, `--radius-*`, `--font-size-*`, `--shadow-*` — see `src/generated/theme.css`) or recipe-local `--sb-*` custom properties injected from the TSX `vars` resolver. The `no-hardcoded-values` and `token-existence` gates enforce this.

## File Map

**tui-kit (Act 1):**
| Path | Responsibility |
|---|---|
| `src/recipes/Spinner/Spinner.{tsx,module.css,test.tsx,visual.test.tsx}` | inline busy indicator |
| `src/recipes/Icon/Icon.tsx` | +11 glyph entries in `ICONS` |
| `src/recipes/Button/Button.{tsx,module.css,test.tsx,visual.test.tsx}` | the workhorse control |
| `src/recipes/Badge/Badge.{tsx,module.css,test.tsx,visual.test.tsx}` | filled status pill |
| `src/recipes/Switch/Switch.{tsx,module.css,test.tsx,visual.test.tsx}` | controlled role=switch |
| `src/recipes/Field/Field.{tsx,module.css,test.tsx,visual.test.tsx}` | TextField, TextArea, RadioGroup |
| `src/recipes/Alert/Alert.{tsx,module.css,test.tsx,visual.test.tsx}` | role=alert callout |
| `src/recipes/Table/Table.{tsx,module.css,test.tsx,visual.test.tsx}` | structural data table |
| `src/recipes/ConfirmDialog/ConfirmDialog.{tsx,module.css,test.tsx,visual.test.tsx}` | destructive-action confirm over Modal |
| `workshop/src/pages/{Spinners,Buttons,Badges,Switches,Fields,Alerts,Tables,ConfirmDialogs}.tsx` | one demo page per recipe |
| `src/index.ts`, `workshop/src/App.tsx` | export + page registration, one block per task |

**local-apps (Act 2):**
| Path | Responsibility |
|---|---|
| `core/board/logic.ts` + `logic.test.ts` | pure ported board.js logic |
| `core/board/api.ts` | typed fetch wrappers for the frozen endpoints |
| `core/board/useBoardState.ts` | the one state hook: poll, reconcile, notices, actions |
| `core/board/main.tsx` | entry: provider, theme css, scheme watcher, mount |
| `core/board/Board.tsx` | page shell: header, subline, notice, sections |
| `core/board/AppsTable.tsx` | table + row + cells |
| `core/board/TunnelSection.tsx` | cloudflare tunnel table |
| `core/board/modals.tsx` | AddAppModal, EditAppModal, RemoveConfirm |
| `core/board/AccessModal.tsx` | the access dialog |
| `core/board/board.css` | deck-domain CSS on `[data-part]` + `.deck-*` |
| `scripts/build-board.ts` | Bun.build → `core/generated/` (committed) |
| `core/generated/board.{js,css}` | committed build artifacts |
| `core/board-assets.ts` | slim shell + generated imports (vendor map deleted) |
| `core/gateway-pages.tsx` | React `renderToStaticMarkup` pages + generated token CSS |
| `scripts/build-gateway-css.ts` | derives day/night token CSS from tuiTheme |
| `core/generated/gateway.css` | committed token CSS for gateway pages |
| `src/api/server.ts` | route edits: `/board.css`, drop `/vendor/*`, fixture guard |
| `test/fixture/status.json` | canned status payload |
| `test/dom/*.spec.ts` | Playwright DOM tests |
| `tests → test/capture.ts`, `test/compare.ts`, `test/baselines/` | pixel harness |

---

# Act 1 — tui-kit

Every Act 1 task runs in `~/Documents/GitHub/tui-kit` and ends with:
`bun run typecheck && bun run test && bun run gates` all green, plus a commit.
Visual baselines: the first `vitest run --project browser` for a new test
writes the baseline into `__screenshots__/`; commit it and re-run to verify
stability. Inspect each new demo in the workshop (`bun run dev:workshop`)
before committing baselines.

### Task 1: Spinner recipe

**Files:**
- Create: `src/recipes/Spinner/Spinner.tsx`, `Spinner.module.css`, `Spinner.test.tsx`, `Spinner.visual.test.tsx`
- Create: `workshop/src/pages/Spinners.tsx`
- Modify: `src/index.ts`, `workshop/src/App.tsx`

**Interfaces:**
- Consumes: `defineComponent` from `../../builders.ts` (see `StatusDot.tsx` for the exact five-generic-param shape).
- Produces: `Spinner`, `SPINNER_PARTS = { root: "spinner" }`, `spinnerTheme`, `SpinnerOwnProps { size?: "xs" | "sm" }`, `SpinnerProps`. Task 3's Button embeds `<Spinner size="xs" />`.

- [ ] **Step 1: Write the node test**

`Spinner.test.tsx`, following the structure of `src/recipes/StatusDot/StatusDot.test.tsx` (same imports/utilities that file uses — read it first). Behaviors to assert:

```tsx
// renders a span with data-part="spinner" and aria-hidden
// default size stamps data-size="sm"; size="xs" stamps data-size="xs"
// className passes through and merges (root slot)
// no vocabulary-axis props: passing intent must be a type error (@ts-expect-error)
```

- [ ] **Step 2: Run it, verify it fails** — `bunx vitest run src/recipes/Spinner/Spinner.test.tsx` → module not found.

- [ ] **Step 3: Implement**

`Spinner.tsx`:

```tsx
import type { ComponentProps, HTMLAttributes } from "react";
import { defineComponent } from "../../builders.ts";
import classes from "./Spinner.module.css";

/** Authoring category (1 = pure styled primitive). Read off this module by
    scripts/derive.ts to build the kit's manifest; not dead code. */
export const recipeCategory = 1 as const;

const SPINNER_SELECTORS = ["root"] as const;

export const SPINNER_PARTS = { root: "spinner" } as const;

/** Two-value recipe scalar, not the theme's `size` vocabulary axis: a spinner
    has exactly the sizes its hosts (inline text, Button) need. */
const SPINNER_SIZES: Record<NonNullable<SpinnerOwnProps["size"]>, string> = {
  xs: "0.85em",
  sm: "1em",
};

export interface SpinnerOwnProps {
  size?: "xs" | "sm";
}

type SpinnerProps_ = SpinnerOwnProps & Omit<HTMLAttributes<HTMLSpanElement>, "ref">;

export const Spinner = defineComponent<
  SpinnerProps_,
  typeof SPINNER_SELECTORS,
  readonly [],
  readonly [],
  HTMLSpanElement
>({
  name: "Spinner",
  selectors: SPINNER_SELECTORS,
  classes,
  vars: (_theme, props) => ({
    root: { "--sb-spinner-size": SPINNER_SIZES[(props as SpinnerOwnProps).size ?? "sm"] },
  }),
  render: ({ props, getStyles, ref }) => {
    const {
      size,
      classNames: _classNames,
      styles: _styles,
      vars: _vars,
      attributes: _attributes,
      unstyled: _unstyled,
      ...rest
    } = props;

    return (
      <span
        ref={ref}
        aria-hidden
        {...rest}
        {...getStyles("root")}
        data-part={SPINNER_PARTS.root}
        data-size={size ?? "sm"}
      />
    );
  },
});

export type SpinnerProps = ComponentProps<typeof Spinner>;

export const spinnerTheme = Spinner.extend({});
```

`Spinner.module.css`:

```css
/* Spinner — inline busy ring. `aria-hidden` by contract: the busy CONTEXT
   (Button, Badge) owns the accessible state via aria-busy. */
@layer soribashi.recipes {
  .root {
    display: inline-block;
    width: var(--sb-spinner-size);
    height: var(--sb-spinner-size);
    flex-shrink: 0;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: var(--radius-round);
    animation: sb-spinner-spin 0.8s linear infinite;
    vertical-align: middle;
  }

  @keyframes sb-spinner-spin {
    to { transform: rotate(360deg); }
  }
}
```

- [ ] **Step 4: Run the node test, verify it passes.**

- [ ] **Step 5: Visual test**

`Spinner.visual.test.tsx` — follow `StatusDot.visual.test.tsx` exactly (no-motion style install, `renderFixture` helper, `page.viewport`, `document.fonts.ready`). The no-motion style must also freeze `animation: none !important` (the ring spins). Captures: both sizes side by side, light (`spinner-sizes-light`) and dark (`spinner-sizes-dark`).

- [ ] **Step 6: Workshop page**

`workshop/src/pages/Spinners.tsx` — export `function Spinners()`, mirroring `StatusDots.tsx`'s layout conventions: both sizes at rest, one inline-with-text row, one inside a disabled look-alike control. Register in `workshop/src/App.tsx` `PAGES` (alphabetical, after `selectboxes`). Eyeball via `bun run dev:workshop`.

- [ ] **Step 7: Exports** — add to `src/index.ts` in alphabetical position:

```ts
export { Spinner, SPINNER_PARTS, spinnerTheme } from "./recipes/Spinner/Spinner.tsx";
export type { SpinnerOwnProps, SpinnerProps } from "./recipes/Spinner/Spinner.tsx";
```

- [ ] **Step 8: Full gate run** — `bun run typecheck && bun run test && bun run gates` → green. Commit: `feat: Spinner recipe`.

### Task 2: Icon glyphs for deck

**Files:**
- Modify: `src/recipes/Icon/Icon.tsx` (the `ICONS` record), `src/recipes/Icon/Icon.test.tsx` (if it enumerates keys), `workshop/src/pages/Icons.tsx`

**Interfaces:**
- Produces: `ICONS.plus`, `ICONS["external-link"]`, `ICONS["triangle-alert"]`, `ICONS["circle-check"]`, `ICONS["file-warning"]`, `ICONS["refresh-cw"]`, `ICONS.pencil`, `ICONS["trash-2"]`, `ICONS["lock-keyhole"]`, `ICONS["user-round-check"]`, `ICONS["rotate-ccw"]` — each a pre-rendered `<Icon d="…" />` ReactNode, the shape existing entries have. Act 2 consumes them by these exact keys.

- [ ] **Step 1: Extract path data.** Source of truth: the lucide package at `~/Documents/GitHub/local-apps/node_modules/lucide/dist/esm/icons/<name>.js` (lucide 1.27.0 — each module exports the icon's element list). For each of the 11 glyphs, convert the element list to a single SVG path `d` string: `<path d>` verbatim; `<line x1 y1 x2 y2>` → `M{x1} {y1}L{x2} {y2}`; `<polyline points>` → `M` + `L` per point; `<circle>` → keep as a separate concern — if a glyph needs a circle, render it via a fragment-style entry with two `<Icon>`-compatible subpaths merged using SVG arc commands only when trivially expressible, otherwise compose the `d` with `M (cx-r) cy a r r 0 1 0 (2r) 0 a r r 0 1 0 (-2r) 0`. `<rect x y w h rx>` → rounded-rect path commands. Keep numbers verbatim from lucide.
- [ ] **Step 2: Add entries** to `ICONS` in `Icon.tsx`, same formatting as existing entries, keys exactly as listed in Interfaces (quoted where hyphenated).
- [ ] **Step 3: Workshop check.** Add the new keys to `workshop/src/pages/Icons.tsx`'s glyph grid (it renders `ICONS` entries — if it iterates `Object.keys(ICONS)` no change is needed; verify). Run `bun run dev:workshop` and visually compare each glyph against lucide.dev's rendering. A distorted conversion is a failure — fix the path math.
- [ ] **Step 4: Node test.** If `Icon.test.tsx` asserts the ICONS key set, extend it; otherwise add one test asserting all 11 new keys exist and are non-null.
- [ ] **Step 5: Visual test.** Extend `Icon.visual.test.tsx` (or its existing grid capture) with a capture of the 11 new glyphs — `icon-deck-glyphs` baseline, light only (stroke = currentColor; scheme adds nothing).
- [ ] **Step 6:** `bun run typecheck && bun run test && bun run gates` → green. Commit: `feat: deck glyph set in ICONS`.

### Task 3: Button recipe

**Files:**
- Create: `src/recipes/Button/Button.tsx`, `Button.module.css`, `Button.test.tsx`, `Button.visual.test.tsx`
- Create: `workshop/src/pages/Buttons.tsx`
- Modify: `src/index.ts`, `workshop/src/App.tsx`

**Interfaces:**
- Consumes: `Spinner` from Task 1; `definePolymorphicComponent` is NOT used — Button is always a `<button>`; `defineComponent` with `HTMLButtonElement`. `autoVars` from `@soribashi/core` with vocabulary axes, following `Chip.tsx`.
- Produces: `Button`, `BUTTON_PARTS = { root: "button" }`, `buttonTheme`, `ButtonOwnProps`, `ButtonProps`. Act 2 uses: `<Button size="sm" variant="outline">`, `<Button size="sm" variant="ghost" iconOnly aria-label="…">`, `<Button intent="bad" …>`, `<Button busy>…</Button>`, `<Button type="submit">`.

- [ ] **Step 1: Write the node test.** Follow `Chip.test.tsx`'s structure. Behaviors:

```tsx
// renders <button type="button"> by default; type="submit" passes through
// data-part="button"; data-variant/data-intent stamped by getStyles
// size="sm" stamps data-size="sm" (vocabulary axis via getStyles)
// busy: disabled=true, aria-busy="true", contains a [data-part="spinner"] child
// disabled passes through
// iconOnly stamps data-icon-only; dev warning (console.warn spy) when iconOnly
//   set without aria-label
// @ts-expect-error variant="filled" (not in kit vocabulary)
```

- [ ] **Step 2: Run, verify failure.**

- [ ] **Step 3: Implement**

`Button.tsx` — model on `Chip.tsx`'s axis handling (defaults for BOTH axes, hand-merged `autoVars`), on `defineComponent` like StatusDot for the non-polymorphic shape:

```tsx
import { autoVars } from "@soribashi/core";
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";
import { defineComponent } from "../../builders.ts";
import { Spinner } from "../Spinner/Spinner.tsx";
import classes from "./Button.module.css";

/** Authoring category (1 = pure styled primitive). Read off this module by
    scripts/derive.ts to build the kit's manifest; not dead code. */
export const recipeCategory = 1 as const;

const BUTTON_SELECTORS = ["root"] as const;

export const BUTTON_PARTS = { root: "button" } as const;

/** `as const` is load-bearing — see Chip.tsx's CHIP_VARIANTS note. */
const BUTTON_VARIANTS = ["outline", "subtle", "ghost"] as const;

const BUTTON_VOCABULARY_AXES = ["intent", "variant", "size"] as const;

export interface ButtonOwnProps {
  children?: ReactNode;
  /** Busy renders an embedded Spinner, disables the button, and sets
      aria-busy. The children stay rendered: callers swap label text
      themselves ("restarting…"), matching the board's pattern. */
  busy?: boolean;
  /** Square padding box for a glyph-only button. Requires `aria-label`. */
  iconOnly?: boolean;
}

type ButtonProps_ = ButtonOwnProps & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "ref">;

export const Button = defineComponent<
  ButtonProps_,
  typeof BUTTON_SELECTORS,
  typeof BUTTON_VARIANTS,
  typeof BUTTON_VOCABULARY_AXES,
  HTMLButtonElement
>({
  name: "Button",
  selectors: BUTTON_SELECTORS,
  vocabularyAxes: BUTTON_VOCABULARY_AXES,
  variants: BUTTON_VARIANTS,
  classes,
  // Every axis needs a default: autoVars returns {} unless the axes it reads
  // are all set — see Chip.tsx.
  defaults: { intent: "accent", variant: "outline", size: "md" },
  vars: (theme, props) => ({
    root: {
      ...(autoVars(theme, "Button", props as Record<string, unknown>, true).root ?? {}),
    },
  }),
  render: ({ props, getStyles, ref }) => {
    const {
      children,
      busy,
      iconOnly,
      disabled,
      type,
      intent: _intent,
      variant: _variant,
      size: _size,
      classNames: _classNames,
      styles: _styles,
      vars: _vars,
      attributes: _attributes,
      unstyled: _unstyled,
      ...rest
    } = props;

    if (process.env.NODE_ENV !== "production" && iconOnly && !rest["aria-label"]) {
      console.warn("tui-kit Button: iconOnly requires an aria-label");
    }

    return (
      <button
        ref={ref}
        type={type ?? "button"}
        disabled={disabled || busy || undefined}
        {...rest}
        {...getStyles("root")}
        data-part={BUTTON_PARTS.root}
        data-icon-only={iconOnly || undefined}
        aria-busy={busy || undefined}
      >
        {busy && <Spinner size="xs" />}
        {children}
      </button>
    );
  },
});

export type ButtonProps = ComponentProps<typeof Button>;

export const buttonTheme = Button.extend({});
```

`Button.module.css` — the Tokyo control look. Colour story comes from the autoVars-injected intent vars plus aliases; geometry from scale tokens:

```css
/* Button — the kit's workhorse control. Colour rides the autoVars-injected
   `--button-*` intent/variant vars; a variant with no injected value falls
   back to the alias palette below. */
@layer soribashi.recipes {
  .root {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--spacing-xs);
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
    line-height: var(--line-height-base);
    color: var(--fg);
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: var(--spacing-xs) var(--spacing-md);
    cursor: pointer;
    transition: border-color 0.12s ease, background 0.12s ease, color 0.12s ease;
  }

  .root:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
  }

  .root:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: 1px;
  }

  .root:disabled {
    opacity: 0.55;
    cursor: default;
  }

  .root[data-size="sm"] {
    font-size: var(--font-size-xs);
    padding: var(--spacing-xxs) var(--spacing-sm);
  }

  .root[data-variant="subtle"] {
    border-color: transparent;
    background: color-mix(in srgb, var(--fg) 5%, transparent);
  }

  .root[data-variant="ghost"] {
    border-color: transparent;
    background: transparent;
  }

  .root[data-intent="bad"] {
    color: var(--red);
  }

  .root[data-intent="bad"]:hover:not(:disabled) {
    border-color: var(--red);
    color: var(--red);
  }

  .root[data-icon-only] {
    padding: var(--spacing-xxs);
    aspect-ratio: 1;
  }
}
```

If the `no-hardcoded-values` gate rejects the `color-mix` percentage or the `0.12s`/`0.55`/`1px` literals, route each through a recipe-local `--sb-button-*` var injected from a `BUTTON_SCALARS` record in the `vars` resolver (the StatusDot `--sd-tooltip-offset` pattern) — do not weaken the gate.

- [ ] **Step 4: Node test green.**
- [ ] **Step 5: Visual test.** Captures (light + dark): a grid of variant × intent(accent, bad) at both sizes; one busy button; one iconOnly button with `ICONS["refresh-cw"]`; one disabled. Freeze the Spinner animation in the no-motion style.
- [ ] **Step 6: Workshop page** `Buttons.tsx`: the same grid plus a click counter proving interactivity. Register in `PAGES`.
- [ ] **Step 7: Exports** (alphabetical): `Button`, `BUTTON_PARTS`, `buttonTheme`, types.
- [ ] **Step 8:** typecheck + test + gates green. Commit: `feat: Button recipe`.

### Task 4: Badge recipe

**Files:**
- Create: `src/recipes/Badge/Badge.tsx`, `Badge.module.css`, `Badge.test.tsx`, `Badge.visual.test.tsx`
- Create: `workshop/src/pages/Badges.tsx`
- Modify: `src/index.ts`, `workshop/src/App.tsx`

**Interfaces:**
- Consumes: `defineComponent`.
- Produces: `Badge`, `BADGE_PARTS = { root: "badge" }`, `badgeTheme`, `BadgeOwnProps { intent?: "ok" | "warn" | "bad" | "muted" }`, `BadgeProps`. Act 2 uses `<Badge intent="ok" title="HTTP 200">200 34ms</Badge>`, `<Badge intent="warn"><Spinner size="xs" /> restarting…</Badge>`, `<Badge intent="bad"><Icon…/> …</Badge>`.

- [ ] **Step 1: Node test.** Behaviors:

```tsx
// span with data-part="badge"; children render
// default intent "muted" stamps data-intent="muted"; each intent stamps its value
// title passes through
// className merges on root
```

- [ ] **Step 2: Run, verify failure.**
- [ ] **Step 3: Implement.** Follow the StatusDot direct-token pattern (no vocabulary axes — the intent → colour join is the recipe's own, bypassing the resolver so the pill palette keeps its own contrast budget):

```tsx
import type { ComponentProps, HTMLAttributes, ReactNode } from "react";
import { defineComponent } from "../../builders.ts";
import classes from "./Badge.module.css";

/** Authoring category (1 = pure styled primitive). Read off this module by
    scripts/derive.ts to build the kit's manifest; not dead code. */
export const recipeCategory = 1 as const;

const BADGE_SELECTORS = ["root"] as const;

export const BADGE_PARTS = { root: "badge" } as const;

/** Four-value recipe scalar mapped straight to family tokens, deliberately
    bypassing autoVars — same rationale as StatusDot's STATUSDOT_TONES. */
const BADGE_TONES: Record<NonNullable<BadgeOwnProps["intent"]>, string> = {
  ok: "var(--green)",
  warn: "var(--amber)",
  bad: "var(--red)",
  muted: "var(--muted)",
};

export interface BadgeOwnProps {
  intent?: "ok" | "warn" | "bad" | "muted";
  children?: ReactNode;
}

type BadgeProps_ = BadgeOwnProps & Omit<HTMLAttributes<HTMLSpanElement>, "ref">;

export const Badge = defineComponent<
  BadgeProps_,
  typeof BADGE_SELECTORS,
  readonly [],
  readonly [],
  HTMLSpanElement
>({
  name: "Badge",
  selectors: BADGE_SELECTORS,
  classes,
  vars: (_theme, props) => ({
    root: { "--sb-badge-color": BADGE_TONES[(props as BadgeOwnProps).intent ?? "muted"] },
  }),
  render: ({ props, getStyles, ref }) => {
    const {
      intent,
      children,
      classNames: _classNames,
      styles: _styles,
      vars: _vars,
      attributes: _attributes,
      unstyled: _unstyled,
      ...rest
    } = props;

    return (
      <span
        ref={ref}
        {...rest}
        {...getStyles("root")}
        data-part={BADGE_PARTS.root}
        data-intent={intent ?? "muted"}
      >
        {children}
      </span>
    );
  },
});

export type BadgeProps = ComponentProps<typeof Badge>;

export const badgeTheme = Badge.extend({});
```

`Badge.module.css`:

```css
/* Badge — filled status pill, the loud sibling of Chip. Tint and border are
   mixes of the single injected tone var, so the four intents share one rule. */
@layer soribashi.recipes {
  .root {
    display: inline-flex;
    align-items: center;
    gap: var(--spacing-xxs);
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
    line-height: var(--line-height-base);
    color: var(--sb-badge-color);
    background: color-mix(in srgb, var(--sb-badge-color) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--sb-badge-color) 40%, transparent);
    border-radius: var(--radius-round);
    padding: 0 var(--spacing-sm);
    white-space: nowrap;
  }
}
```

(Same gate escape hatch as Button if percentages are rejected: promote them to `--sb-badge-*` vars.)

- [ ] **Step 4: Node test green.**
- [ ] **Step 5: Visual test.** Light + dark grid of all four intents, one with an `ICONS["triangle-alert"]` glyph, one with a Spinner (frozen).
- [ ] **Step 6: Workshop page** `Badges.tsx` with the same grid plus the deck health shapes (`200 34ms`, `unreachable`, `restarting…`). Register.
- [ ] **Step 7: Exports** alphabetical.
- [ ] **Step 8:** typecheck + test + gates green. Commit: `feat: Badge recipe`.

### Task 5: Switch recipe

**Files:**
- Create: `src/recipes/Switch/Switch.tsx`, `Switch.module.css`, `Switch.test.tsx`, `Switch.visual.test.tsx`
- Create: `workshop/src/pages/Switches.tsx`
- Modify: `src/index.ts`, `workshop/src/App.tsx`

**Interfaces:**
- Consumes: `defineComponent`.
- Produces: `Switch`, `SWITCH_PARTS = { root: "switch", control: "switch-control", label: "switch-label" }`, `switchTheme`, `SwitchOwnProps`, `SwitchProps`. Act 2 uses `<Switch checked={row.published} onChange={…} aria-label="…" title="…" />` and `<Switch checked={x} onChange={…} label="Password protected" />`.

- [ ] **Step 1: Node test.** Behaviors:

```tsx
// renders <label data-part="switch"> wrapping <input type="checkbox" role="switch">
// checked reflects the prop; clicking fires onChange with the click event
// controlled only: re-render with same checked → input stays at prop value
// label renders in [data-part="switch-label"]; aria-label passes to the input
// title lands on the wrapping label (hover target), not the input
// disabled disables the input
```

- [ ] **Step 2: Run, verify failure.**
- [ ] **Step 3: Implement.**

```tsx
import type { ChangeEvent, ComponentProps, LabelHTMLAttributes, ReactNode } from "react";
import { defineComponent } from "../../builders.ts";
import classes from "./Switch.module.css";

/** Authoring category (1 = pure styled primitive). Read off this module by
    scripts/derive.ts to build the kit's manifest; not dead code. */
export const recipeCategory = 1 as const;

const SWITCH_SELECTORS = ["root", "control", "label"] as const;

export const SWITCH_PARTS = {
  root: "switch",
  control: "switch-control",
  label: "switch-label",
} as const;

export interface SwitchOwnProps {
  /** Controlled only: the input's checked always reflects this prop, so a
      failed action's unchanged state snaps the control back on re-render —
      the invariant the old board hand-wrote with ev.target.checked. */
  checked: boolean;
  onChange: (ev: ChangeEvent<HTMLInputElement>) => void;
  /** Visible label text; label-less call sites pass `aria-label` instead. */
  label?: ReactNode;
  disabled?: boolean;
  /** The input's accessible name when there is no visible label. */
  "aria-label"?: string;
}

type SwitchProps_ = SwitchOwnProps &
  Omit<LabelHTMLAttributes<HTMLLabelElement>, "ref" | "onChange" | "aria-label">;

export const Switch = defineComponent<
  SwitchProps_,
  typeof SWITCH_SELECTORS,
  readonly [],
  readonly [],
  HTMLLabelElement
>({
  name: "Switch",
  selectors: SWITCH_SELECTORS,
  classes,
  render: ({ props, getStyles, ref }) => {
    const {
      checked,
      onChange,
      label,
      disabled,
      "aria-label": ariaLabel,
      classNames: _classNames,
      styles: _styles,
      vars: _vars,
      attributes: _attributes,
      unstyled: _unstyled,
      ...rest
    } = props;

    return (
      <label ref={ref} {...rest} {...getStyles("root")} data-part={SWITCH_PARTS.root}>
        <input
          type="checkbox"
          role="switch"
          checked={checked}
          onChange={onChange}
          disabled={disabled}
          aria-label={ariaLabel}
          {...getStyles("control")}
          data-part={SWITCH_PARTS.control}
        />
        {label != null && (
          <span {...getStyles("label")} data-part={SWITCH_PARTS.label}>
            {label}
          </span>
        )}
      </label>
    );
  },
});

export type SwitchProps = ComponentProps<typeof Switch>;

export const switchTheme = Switch.extend({});
```

`Switch.module.css` — track + thumb drawn on the input itself (`appearance: none`):

```css
/* Switch — role=switch track/thumb drawn on the checkbox input itself, so the
   accessible element and the visual control are one node. */
@layer soribashi.recipes {
  .root {
    display: inline-flex;
    align-items: center;
    gap: var(--spacing-sm);
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
    color: var(--fg);
    cursor: pointer;
  }

  .control {
    appearance: none;
    margin: 0;
    width: var(--spacing-rem180);
    height: var(--spacing-rem100);
    border: 1px solid var(--border);
    border-radius: var(--radius-round);
    background: color-mix(in srgb, var(--fg) 8%, transparent);
    position: relative;
    cursor: pointer;
    transition: background 0.12s ease, border-color 0.12s ease;
  }

  .control::after {
    content: "";
    position: absolute;
    top: 50%;
    left: var(--spacing-px2);
    transform: translateY(-50%);
    width: var(--spacing-rem75);
    height: var(--spacing-rem75);
    border-radius: var(--radius-round);
    background: var(--muted);
    transition: left 0.12s ease, background 0.12s ease;
  }

  .control:checked {
    background: color-mix(in srgb, var(--accent) 16%, transparent);
    border-color: var(--accent);
  }

  .control:checked::after {
    left: calc(100% - var(--spacing-rem75) - var(--spacing-px2));
    background: var(--accent);
  }

  .control:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: 1px;
  }

  .control:disabled {
    opacity: 0.55;
    cursor: default;
  }
}
```

- [ ] **Step 4: Node test green.**
- [ ] **Step 5: Visual test.** Light + dark: off, on, disabled-off, disabled-on, one labeled. Freeze transitions.
- [ ] **Step 6: Workshop page** `Switches.tsx` with live toggling state. Register.
- [ ] **Step 7: Exports** alphabetical.
- [ ] **Step 8:** typecheck + test + gates green. Commit: `feat: Switch recipe`.

### Task 6: Field family (TextField, TextArea, RadioGroup)

**Files:**
- Create: `src/recipes/Field/Field.tsx`, `Field.module.css`, `Field.test.tsx`, `Field.visual.test.tsx`
- Create: `workshop/src/pages/Fields.tsx`
- Modify: `src/index.ts`, `workshop/src/App.tsx`

**Interfaces:**
- Consumes: `defineComponent`.
- Produces from one module: `TextField`, `TextArea`, `RadioGroup`, `FIELD_PARTS = { root: "field", label: "field-label", input: "field-input", error: "field-error", option: "field-option" }`, `textFieldTheme`, `textAreaTheme`, `radioGroupTheme`, own-prop and full-prop types for each. Act 2 uses:
  - `<TextField label="Name" value={v} onChange={…} placeholder="myapp" required pattern="[a-z0-9][a-z0-9.-]*" title="…" />`
  - `<TextField type="password" aria-label="new password" placeholder="new password" … />` (aria-only label)
  - `<TextField inputMode="numeric" … />`
  - `<TextArea label="Allowed emails" rows={4} value={v} onChange={…} placeholder={…} />`
  - `<RadioGroup name="oauth-mode" value={mode} onChange={…} options={[{value:"domains",label:"Anyone at these domains"},{value:"emails",label:"These people"}]} />`
  - `error` prop on TextField renders the string under the input with `role="alert"`.
- `inputRef` prop on TextField (autofocus targets: the add modal focuses its name field, the port editor focuses itself).

- [ ] **Step 1: Node test.** Behaviors:

```tsx
// TextField: <label data-part="field"> wraps [data-part="field-label"] span (when
//   label given) + <input data-part="field-input">; aria-label passes to input
//   when no visible label; value/onChange controlled; pattern/required/
//   placeholder/inputMode pass through; error renders [data-part="field-error"]
//   with role="alert"; no error → no error node; inputRef reaches the input.
// TextArea: same chrome, <textarea rows>.
// RadioGroup: one <label data-part="field-option"> per option, each wrapping
//   <input type="radio" name value>; checked follows `value`; change fires
//   onChange with the option value (string).
```

- [ ] **Step 2: Run, verify failure.**
- [ ] **Step 3: Implement.** Three `defineComponent` recipes sharing `classes` and `FIELD_PARTS` in one file. Shapes:

```tsx
export interface TextFieldOwnProps {
  label?: ReactNode;
  value: string;
  onChange: (ev: ChangeEvent<HTMLInputElement>) => void;
  error?: string | null;
  inputRef?: Ref<HTMLInputElement>;
  type?: "text" | "password";
}
// TextFieldProps_ = TextFieldOwnProps & Omit<InputHTMLAttributes<HTMLInputElement>,
//   "ref" | "value" | "onChange" | "type">   — root element is the <label>, so
// defineComponent's element type is HTMLLabelElement and input-facing attrs
// (placeholder, pattern, required, inputMode, autoComplete, aria-label, onKeyDown,
// onBlur) are forwarded to the input, while className/style land on the root.
```

Forwarding rule (write it exactly this way): destructure the Styles-API keys and the own props; everything left in `rest` goes to the **input**, not the root — a Field call site's `placeholder`, `pattern`, `onKeyDown`, `onBlur`, `aria-label` all target the control. The root label takes only `getStyles("root")` + `data-part`. `TextArea` mirrors this with `HTMLTextAreaElement` and a `rows?: number` own prop. `RadioGroup`:

```tsx
export interface RadioGroupOwnProps {
  name: string;
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: ReactNode }>;
}
// renders <div role="radiogroup" data-part="field"> containing one
// <label data-part="field-option"><input type="radio" …/><span>{label}</span></label>
// per option; onChange called with option.value from the radio's change event.
```

`Field.module.css` — label typography (muted, small), input chrome (panel bg, border, radius-md, focus accent), error in `--red` at `--font-size-xs`, option rows as `display: flex; gap: var(--spacing-sm); align-items: center`. Same token discipline and gate escape hatch as prior tasks. TextArea adds `resize: vertical`.

- [ ] **Step 4: Node test green.**
- [ ] **Step 5: Visual test.** Light + dark: labeled TextField at rest + focused (`.focus()` before capture), password TextField, TextField with error, TextArea, RadioGroup with second option selected.
- [ ] **Step 6: Workshop page** `Fields.tsx`: a small working form using all three. Register.
- [ ] **Step 7: Exports** alphabetical (one block for the Field family).
- [ ] **Step 8:** typecheck + test + gates green. Commit: `feat: Field family recipes`.

### Task 7: Alert recipe

**Files:**
- Create: `src/recipes/Alert/Alert.tsx`, `Alert.module.css`, `Alert.test.tsx`, `Alert.visual.test.tsx`
- Create: `workshop/src/pages/Alerts.tsx`
- Modify: `src/index.ts`, `workshop/src/App.tsx`

**Interfaces:**
- Consumes: `defineComponent`.
- Produces: `Alert`, `ALERT_PARTS = { root: "alert", command: "alert-command" }`, `alertTheme`, `AlertOwnProps { intent?: "ok" | "bad"; command?: string }`, `AlertProps`. Act 2 uses `<Alert intent="bad" command={installCommand}>{message}</Alert>` for the proxy notice and `<Alert intent="bad">{formError}</Alert>` in modals.

- [ ] **Step 1: Node test.**

```tsx
// div with role="alert", data-part="alert", data-intent stamped ("bad" default? no —
//   default "bad" would be wrong: default is REQUIRED-EXPLICIT; make intent
//   non-optional? Decision: intent required (both call sites always know), no default.
// children render; command renders a <pre data-part="alert-command"> when given,
//   absent otherwise.
```

Adjust `AlertOwnProps` accordingly: `intent: "ok" | "bad"` (required).

- [ ] **Step 2: Run, verify failure.**
- [ ] **Step 3: Implement.** StatusDot-pattern tone map: `ok → var(--green)`, `bad → var(--red)` into `--sb-alert-color`; css: flex column, `gap var(--spacing-xs)`, tinted background (`color-mix … 10%`), left border 2px solid the tone, `padding var(--spacing-sm) var(--spacing-lg)`, radius-md; `.command` in `--font-mono` at `--font-size-xs`, panel background, `padding var(--spacing-sm)`, `overflow-x: auto`, `white-space: pre-wrap`. Component body mirrors Badge with an extra conditional `<pre>`.
- [ ] **Step 4: Node test green.**
- [ ] **Step 5: Visual test.** Light + dark: ok alert, bad alert, bad alert with command block.
- [ ] **Step 6: Workshop page** `Alerts.tsx` with the deck proxy-notice copy as demo content. Register.
- [ ] **Step 7: Exports** alphabetical.
- [ ] **Step 8:** typecheck + test + gates green. Commit: `feat: Alert recipe`.

### Task 8: Table recipe

**Files:**
- Create: `src/recipes/Table/Table.tsx`, `Table.module.css`, `Table.test.tsx`, `Table.visual.test.tsx`
- Create: `workshop/src/pages/Tables.tsx`
- Modify: `src/index.ts`, `workshop/src/App.tsx`

**Interfaces:**
- Consumes: `defineComponent`.
- Produces: `Table` plus attached subcomponents `Table.Head`, `Table.HeadCell`, `Table.Body`, `Table.Row`, `Table.Cell`; `TABLE_PARTS = { root: "table", table: "table-table", head: "table-head", headcell: "table-headcell", body: "table-body", row: "table-row", cell: "table-cell" }`; `tableTheme`; `TableOwnProps`, `TableProps`, `TableCellOwnProps { align?: "start" | "end" }`. Act 2 renders:

```tsx
<Table>
  <Table.Head>
    <Table.HeadCell>site</Table.HeadCell>…
  </Table.Head>
  <Table.Body>
    <Table.Row>
      <Table.Cell>…</Table.Cell>
      <Table.Cell align="end">…</Table.Cell>
    </Table.Row>
  </Table.Body>
</Table>
```

- [ ] **Step 1: Node test.**

```tsx
// Table renders <div data-part="table"><table data-part="table-table">…
// Head renders <thead data-part="table-head"><tr>; HeadCell a <th data-part="table-headcell">
// Body/Row/Cell render tbody/tr/td with their parts
// Cell align="end" stamps data-align="end"; default stamps nothing
// className on Table merges on the root div
```

- [ ] **Step 2: Run, verify failure.**
- [ ] **Step 3: Implement.** The root `Table` is the only `defineComponent` recipe (it owns the theme surface); the subcomponents are hand-rolled plain components in the same file that render semantic elements with `data-part` attributes and module classes directly (`classes.head`, `classes.row`, …) — the Styles-API per-slot override surface lives on the root, and app-side styling reaches the inner parts via `[data-part]`, the kit's stated cross-boundary contract. Attach them after definition:

```tsx
const TableRoot = defineComponent<…>({ name: "Table", selectors: TABLE_SELECTORS, classes, render: ({ props, getStyles, ref }) => {
  const { children, classNames: _c, styles: _s, vars: _v, attributes: _a, unstyled: _u, ...rest } = props;
  return (
    <div ref={ref} {...rest} {...getStyles("root")} data-part={TABLE_PARTS.root}>
      <table {...getStyles("table")} data-part={TABLE_PARTS.table}>{children}</table>
    </div>
  );
}});

function Head({ children }: { children?: ReactNode }) {
  return (
    <thead className={classes.head} data-part={TABLE_PARTS.head}>
      <tr>{children}</tr>
    </thead>
  );
}
// HeadCell → <th className={classes.headcell} data-part>, Body → <tbody>,
// Row → <tr className={classes.row} data-part {...rest}> (rows take DOM props:
// deck's hover-reveal needs row hover, key, aria attrs), Cell:
function Cell({ align, children, ...rest }: TableCellOwnProps & TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={classes.cell} data-part={TABLE_PARTS.cell} data-align={align === "end" ? "end" : undefined} {...rest}>
      {children}
    </td>
  );
}

export const Table = Object.assign(TableRoot, { Head, HeadCell, Body, Row, Cell });
```

`Table.module.css` — Tokyo table: root div `overflow-x: auto`; table `width: 100%; border-collapse: collapse; font-family: var(--font-mono); font-size: var(--font-size-sm)`; headcell muted uppercase `--font-size-xs` with `letter-spacing` via `--sb-table-tracking` var, `text-align: left`, `padding var(--spacing-xs) var(--spacing-md)`, `border-bottom: 1px solid var(--border)`; cell `padding var(--spacing-sm) var(--spacing-md); border-bottom: 1px solid var(--border-soft); white-space: nowrap; vertical-align: middle`; row hover `background: color-mix(in srgb, var(--fg) 5%, transparent)`; `[data-align="end"] { text-align: right }`.
- [ ] **Step 4: Node test green.**
- [ ] **Step 5: Visual test.** Light + dark: a three-column table with header, three rows mixing Badge/Chip/Button content, one align="end" column, hover state captured via `page.getByText(...).hover()` on the middle row.
- [ ] **Step 6: Workshop page** `Tables.tsx` reproducing a mini deck-like board section. Register.
- [ ] **Step 7: Exports** alphabetical (`Table`, `TABLE_PARTS`, `tableTheme`, types).
- [ ] **Step 8:** typecheck + test + gates green. Commit: `feat: Table recipe`.

### Task 9: ConfirmDialog recipe

**Files:**
- Create: `src/recipes/ConfirmDialog/ConfirmDialog.tsx`, `ConfirmDialog.module.css`, `ConfirmDialog.test.tsx`, `ConfirmDialog.visual.test.tsx`
- Create: `workshop/src/pages/ConfirmDialogs.tsx`
- Modify: `src/index.ts`, `workshop/src/App.tsx`

**Interfaces:**
- Consumes: `Modal` (`title`, `ariaLabel`, `onClose` — see `Modal.tsx`), `Button` from Task 3.
- Produces: `ConfirmDialog`, `CONFIRMDIALOG_PARTS = { root: "confirmdialog", body: "confirmdialog-body", foot: "confirmdialog-foot" }`, `confirmDialogTheme`, `ConfirmDialogOwnProps`, `ConfirmDialogProps`. Act 2 uses:

```tsx
<ConfirmDialog
  open={pendingRemove != null}
  title={`Remove ${name}?`}
  confirmLabel="Remove"
  onConfirm={…}
  onCancel={…}
>
  This deletes its service and route.
</ConfirmDialog>
```

- [ ] **Step 1: Node test.**

```tsx
// open=false renders nothing
// open=true renders Modal (role="dialog") titled via `title`; ariaLabel defaults
//   to the title string when title is a string
// body children in [data-part="confirmdialog-body"]
// two buttons: cancel (default label "Cancel") and confirm (confirmLabel),
//   confirm has data-intent="bad" by default; intent="accent" overrides
// clicking confirm fires onConfirm; cancel and Modal close fire onCancel
// initial focus is on the cancel button (destructive default-safe)
```

- [ ] **Step 2: Run, verify failure.**
- [ ] **Step 3: Implement.** Category 2 (transient overlay). Renders `null` when `!open`; otherwise a `Modal` whose children are the body div and a footer div with the two `size="sm"` Buttons; a `useEffect` + `ref` focuses the cancel button on mount. Own props:

```tsx
export interface ConfirmDialogOwnProps {
  open: boolean;
  title: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel: ReactNode;
  cancelLabel?: ReactNode;
  intent?: "bad" | "accent";
  ariaLabel?: string;
  children?: ReactNode;
}
```

Escape and overlay-click already arrive via Modal's `onClose` → wire to `onCancel`. `ConfirmDialog.module.css`: body `padding var(--spacing-md) 0; font-size: var(--font-size-sm); color: var(--fg)`; foot `display: flex; justify-content: flex-end; gap: var(--spacing-sm)`.
- [ ] **Step 4: Node test green.**
- [ ] **Step 5: Visual test.** Light + dark capture of the open dialog with the deck remove copy.
- [ ] **Step 6: Workshop page** `ConfirmDialogs.tsx` with an open/close trigger. Register.
- [ ] **Step 7: Exports** alphabetical.
- [ ] **Step 8:** typecheck + test + gates green. Commit: `feat: ConfirmDialog recipe`.

---

# Act 2 — local-apps

Every Act 2 task runs in `~/Documents/GitHub/local-apps` and ends with
`bun test` green plus a commit. The old board's reference implementation is
`core/board.html` + `core/board.js` at commit `74d42b4` — after Task 11
deletes them, read them from git (`git show 74d42b4:core/board.js`).

### Task 10: Pure logic port

**Files:**
- Create: `core/board/logic.ts`, `core/board/logic.test.ts`

**Interfaces:**
- Produces (consumed by Task 13's hook; signatures are frozen here):

```ts
export const REFRESH_MS = 5000;
export const RESTART_TIMEOUT_MS = 30000;
export const HEAL_RECENT_MS = 120000;
export const PROXY_WAIT_MS = 45000;

export type StatusData = /* structural type of /api/v1/status: apps, orphans,
  up, total, suffix, nextPort, canManage, canRestart, proxyStale, autoHeal —
  derive field-by-field from what board.js reads and src/api/status.ts emits */;
export type Row = StatusData["apps"][number];
export type RestartingMap = Record<string, { pid: number | null; at: number }>;
export type Notice = { kind: "ok" | "bad"; message: string; command?: string };

export function subline(data: StatusData | null): string;
export function accessSummary(row: Row): string;
export function isPlatform(managedBy: string | undefined): boolean;
export function tunnelDomain(data: StatusData): string;
export function sections(data: StatusData | null): { key: string; title: string | null; rows: Row[] }[];
export function tunnels(data: StatusData | null): Row[];
export function reconcileRestarting(restarting: RestartingMap, data: StatusData, now: number): RestartingMap;
export function autoBanner(data: StatusData, now: number): Notice | null;
export function splitList(text: string): string[];
export function addPayload(m: { name: string; external: boolean; command: string; workingDirectory: string; staticPort: string }): unknown;
export function editPatch(m: { name: string; port: string; kind: string; command: string; workingDirectory: string }): unknown;
```

- [ ] **Step 1: Write the failing tests.** Port each behavior from `core/board.js` as a table of cases — the old file is the oracle. Must-cover cases:

```ts
// subline: null → "loading…"; full data → "2/3 healthy · 1 public · 1 protected ·
//   next port 11012 · auto-refreshes"; protected/nextPort segments omitted when 0/absent
// accessSummary: unpublished leads with "not published"; password + emails/domains
//   phrasing including singular "1 person"; default "open to anyone"
// isPlatform: "deck" true, "local" true (pre-rename records), "user"/undefined false
// sections: apps always; strays section only when non-tunnel orphans exist,
//   titled "services without routes"
// reconcileRestarting: cleared on new pid + healthy; cleared past RESTART_TIMEOUT_MS;
//   kept while same pid or unhealthy; pure — input map not mutated
// autoBanner: heal in-flight (ok===null, recent) → bad restarting message;
//   proxyStale → bad stale message mentioning "reload proxy"; recent ok heal →
//   ok message; else null. Copy verbatim from board.js autoBanner.
// splitList: "a@x.dev, b@y.dev\nc@z.dev" → three entries; blanks dropped
// addPayload: external → { name, staticPort:Number }; service → { name,
//   command: whitespace-split array, workingDirectory }
// editPatch: service kind adds command array + workingDirectory; port → Number
```

- [ ] **Step 2: Run `bun test core/board/logic.test.ts`, verify failure.**
- [ ] **Step 3: Implement** by transliterating `core/board.js` — same strings, same branch order, `Date.now()` replaced by the `now` parameter so everything is pure. `autoBanner`'s `toLocaleTimeString` call stays (tests pin the branch, not the locale string).
- [ ] **Step 4: Tests green.** Full `bun test` still green.
- [ ] **Step 5: Commit** `feat: pure board logic port`.

### Task 11: Build pipeline, React shell, vendor teardown

**Files:**
- Create: `scripts/build-board.ts`, `core/board/main.tsx`, `core/board/Board.tsx`, `core/board/board.css`, `core/generated/board.js`, `core/generated/board.css` (built, committed)
- Modify: `package.json`, `core/board-assets.ts`, `core/board-assets.test.ts`, `src/api/server.ts` (asset routes only)
- Delete: `core/board.html`, `core/board.js`, `core/vendor/` (all four files), `core/icons.js`, the `build:icons` script
- Test: `core/board-assets.test.ts` (rewritten), `core/generated-fresh.test.ts`

**Interfaces:**
- Consumes: `logic.ts` (Task 10) — the shell renders `subline(null)` ("loading…") only; the hook arrives in Task 13.
- Produces: `boardHtml(): Response`, `boardJs(): Response`, `boardCss(): Response` from `core/board-assets.ts`; the committed-artifact pattern and `bun run build:board` used by all later tasks; `buildBoardArtifacts(): Promise<{ js: string; css: string }>` exported from `scripts/build-board.ts` for the freshness test.

- [ ] **Step 1: Dependencies.**

```bash
cd ~/Documents/GitHub/local-apps
bun add @mattstack/tui-kit@file:../tui-kit react react-dom
bun add -d @types/react @types/react-dom
```

Pin `react`/`react-dom` to the exact version installed (write them without `^` in package.json), matching mr-board's practice.

- [ ] **Step 2: Build script.** `scripts/build-board.ts`:

```ts
import { join } from "path";
import type { BunPlugin } from "bun";

const ROOT = join(import.meta.dir, "..");

// The file: kit is realpath'd by the bundler, so a kit recipe's bare `react`
// import resolves inside the kit's own store — two Reacts, two soribashi
// contexts, broken theming. Pin every react specifier to this repo's copy.
// Reference: mr-board src/server.ts reactSingleton.
const reactSingleton: BunPlugin = {
  name: "react-singleton",
  setup(builder) {
    builder.onResolve({ filter: /^react(-dom)?(\/.*)?$/ }, (args) => ({
      path: Bun.resolveSync(args.path, ROOT),
    }));
  },
};

export async function buildBoardArtifacts(): Promise<{ js: string; css: string }> {
  const build = await Bun.build({
    entrypoints: [join(ROOT, "core/board/main.tsx")],
    target: "browser",
    minify: true,
    plugins: [reactSingleton],
  });
  if (!build.success) throw new Error(build.logs.join("\n"));
  let js = "";
  let css = "";
  for (const out of build.outputs) {
    if (out.kind === "entry-point") js = await out.text();
    if (out.kind === "asset" && out.path.endsWith(".css")) css += await out.text();
  }
  if (!js || !css) throw new Error("board build missing js or css output");
  return { js, css };
}

if (import.meta.main) {
  const { js, css } = await buildBoardArtifacts();
  await Bun.write(join(ROOT, "core/generated/board.js"), js);
  await Bun.write(join(ROOT, "core/generated/board.css"), css);
  console.log("core/generated/board.{js,css} written");
}
```

Add `"build:board": "bun run scripts/build-board.ts"` to package.json scripts. (Verify the `out.kind` values against Bun's actual BuildArtifact API at implementation time; adjust the collection loop if CSS arrives differently, keeping the two-artifact contract.)

- [ ] **Step 3: React entry + shell.** `core/board/main.tsx`:

```tsx
import { createRoot } from "react-dom/client";
import { SoribashiProvider } from "@mattstack/tui-kit/provider";
import { tuiTheme } from "@mattstack/tui-kit/theme";
import "@mattstack/tui-kit/theme.css";
import "./board.css";
import { Board } from "./Board.tsx";

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
function applyScheme() {
  document.documentElement.classList.toggle("dark", darkQuery.matches);
}
applyScheme();
darkQuery.addEventListener("change", applyScheme);

createRoot(document.getElementById("root")!).render(
  <SoribashiProvider theme={tuiTheme}>
    <Board />
  </SoribashiProvider>,
);
```

`core/board/Board.tsx` (this task's placeholder — Task 13 replaces the body):

```tsx
import { subline } from "./logic.ts";

export function Board() {
  return (
    <main className="board">
      <header className="board-header">
        <h1>Deck</h1>
      </header>
      <p className="board-subline">{subline(null)}</p>
    </main>
  );
}
```

`core/board/board.css` starts with the page frame (verbatim widths from the old inline styles):

```css
.board {
  width: min(100% - 2rem, 96rem);
  margin-inline: auto;
  font-family: var(--font-mono);
  color: var(--fg);
}
body {
  margin: 0;
  background: var(--bg);
}
.board-header { display: flex; justify-content: space-between; align-items: center; }
.board-subline { color: var(--muted); }
```

- [ ] **Step 4: board-assets rewrite.** New `core/board-assets.ts`:

```ts
// readFileSync(import.meta.dir…) dies under --compile; static imports embed the
// assets in the binary and behave identically under plain `bun run`.
import BOARD_JS from "./generated/board.js" with { type: "text" };
import BOARD_CSS from "./generated/board.css" with { type: "text" };

const CACHE = "no-cache";

const BOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Deck</title>
<link rel="stylesheet" href="/board.css">
</head>
<body>
<div id="root"></div>
<noscript><main class="board"><p>this board needs JavaScript to show live status.</p></main></noscript>
<script src="/board.js" defer></script>
</body>
</html>`;

export function boardHtml(): Response {
  return new Response(BOARD_HTML, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": CACHE },
  });
}

export function boardJs(): Response {
  return new Response(BOARD_JS as unknown as string, {
    headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": CACHE },
  });
}

export function boardCss(): Response {
  return new Response(BOARD_CSS as unknown as string, {
    headers: { "content-type": "text/css; charset=utf-8", "cache-control": CACHE },
  });
}
```

(Carry over the `@ts-expect-error` import-attribute annotations from the old file if tsc still needs them.) In `src/api/server.ts`: add `if (pathname === "/board.css") return boardCss();` beside the `/board.js` route; delete the `/vendor/` branch and the `vendorAsset` import.

- [ ] **Step 5: Vendor teardown.** Delete `core/board.html`, `core/board.js`, `core/vendor/` (oat.min.css, oat.min.js, alpine.min.js, lucide.min.js), `core/icons.js`; remove `build:icons` and the `lucide` devDep from package.json.

- [ ] **Step 6: Rewrite `core/board-assets.test.ts`.** Every Oat/Alpine assertion dies with the markup it guarded. New assertions:

```ts
// shell references /board.js and /board.css; has <div id="root">; has <noscript>
// content-types correct on all three responses
// no /vendor references anywhere in the shell
```

- [ ] **Step 7: Freshness gate.** `core/generated-fresh.test.ts`:

```ts
import { expect, test } from "bun:test";
import { buildBoardArtifacts } from "../scripts/build-board.ts";
import COMMITTED_JS from "./generated/board.js" with { type: "text" };
import COMMITTED_CSS from "./generated/board.css" with { type: "text" };

test("core/generated is fresh — run `bun run build:board` after editing core/board/", async () => {
  const { js, css } = await buildBoardArtifacts();
  expect(js).toBe(COMMITTED_JS as unknown as string);
  expect(css).toBe(COMMITTED_CSS as unknown as string);
}, 30000);
```

If Bun's minifier proves non-deterministic between runs (compare two fresh builds first), pin the comparison to a content hash of the un-minified build instead — determinism of the gate beats byte-equality of the shipped artifact.

- [ ] **Step 8: Build + verify both boot paths.** `bun run build:board`, commit artifacts. Then `bun run src/main.ts serve` (with `PORT=11097` to avoid the live deck) → `curl localhost:11097/` shows the shell, `/board.js` + `/board.css` serve. Then `bun run build` compiles; run `dist/deck serve` the same way. `bun test` green.
- [ ] **Step 9: Commit** `feat: React board shell, embedded build pipeline, vendor teardown`.

### Task 12: Fixture mode + Playwright DOM rig

**Files:**
- Create: `test/fixture/status.json`, `test/dom/rig.ts`, `test/dom/shell.spec.ts`
- Modify: `src/api/server.ts` (fixture guard), `package.json` (devDeps + `test:dom` script)

**Interfaces:**
- Produces: `DECK_FIXTURE=<dir>` server mode; `test/dom/rig.ts` exporting `withBoard(fn: (page: Page) => Promise<void>): Promise<void>` that boots the fixture server on a free port, launches chromium (headless), opens `/`, waits for `[data-board-ready]`, runs `fn`, and tears down. `bun run test:dom` runs `bun test test/dom/`.
- Consumes: Task 11's shell.

- [ ] **Step 1: Fixture guard.** In `startApi`'s fetch handler, immediately after the `pathname` destructure (before the `/api/v1/` block), add:

```ts
const fixtureDir = process.env.DECK_FIXTURE || null;
if (fixtureDir && pathname.startsWith("/api/v1/")) {
  if (pathname === "/api/v1/status" && req.method === "GET") {
    return new Response(Bun.file(join(fixtureDir, "status.json")), {
      headers: { "content-type": "application/json" },
    });
  }
  // Mutations are inert and deterministic: the DOM tests assert the REQUEST
  // (via page.route interception) and the optimistic UI, never launchd effects.
  return json({ ok: true });
}
```

- [ ] **Step 2: Fixture data.** `test/fixture/status.json` — hand-write a payload matching what `src/api/status.ts` emits (read `rowFor` for exact field names). Contents: `canManage: true`, `canRestart: true`, `suffix: "mattstack"`, `nextPort: 11012`, `up: 2`, `total: 3`, apps: (1) healthy published app with service running + health `{status: 200, ok: true, ms: 34}` + oauth emails mode with 2 emails + hasPassword true; (2) app with dev-port override (`override: {basePort: 11003}`, `publicFollowsOverride: false`), preflight `[]` (live publicly badge); (3) stopped app, health `{status: null}`, unpublished, one `issues` entry (`source: "cloudflare"`); orphans: one tunnel row (`isTunnel: true`, service running) and one stray (`isTunnel: false`, service stopped). One row `managedBy: "deck"` (the board itself), one `managedBy: "mattstack"`.
- [ ] **Step 3: Rig + first test.** Add devDeps `playwright`, `pixelmatch`, `pngjs`, `@types/pixelmatch`, `@types/pngjs` (versions per mr-board's package.json). `test/dom/rig.ts` boots `bun run src/main.ts serve` with `DECK_FIXTURE` + a free `PORT` via `Bun.spawn`, polls `/healthz`, launches one shared chromium. `test/dom/shell.spec.ts`: page loads, `<h1>Deck</h1>` visible, document title "Deck", no console errors. `data-board-ready`: have `Board.tsx` stamp `data-board-ready` on `<main>` (in this task: unconditionally; Task 13 moves it to after first status render).
- [ ] **Step 4: Run `bun run test:dom` green; full `bun test` green** (DOM tests live under `test/`, excluded from the default `bun test core src` script — verify the script globs and keep them so).
- [ ] **Step 5: Commit** `feat: fixture mode and Playwright DOM rig`.

### Task 13: useBoardState + the board tables

**Files:**
- Create: `core/board/api.ts`, `core/board/useBoardState.ts`, `core/board/AppsTable.tsx`, `core/board/TunnelSection.tsx`
- Modify: `core/board/Board.tsx`, `core/board/board.css`
- Test: `test/dom/board.spec.ts`

**Interfaces:**
- Consumes: Task 10 logic (all of it), kit `Table`, `Badge`, `Chip`, `Button`, `Switch`, `Spinner`, `Icon`/`ICONS`.
- Produces: `useBoardState()` returning (frozen for Tasks 14–17):

```ts
{
  data: StatusData | null;
  sections: ReturnType<typeof sections>;
  tunnels: Row[];
  subline: string;
  restarting: RestartingMap;
  isRestarting(row: Row): boolean;
  refresh(): Promise<void>;
  onRestart(row: Row): void;
  onPublish(row: Row): Promise<void>;
  // port editing (Task 14 consumes)
  editing: { app: string; value: string } | null;
  startEdit(row: Row): void; setEditValue(v: string): void;
  submitPort(): void; cancelEdit(): void; clearPort(row: Row): void;
  onPublicFollows(row: Row): Promise<void>;
  // modals (Tasks 15–16 consume)
  addModal / editModal / accessModal state + open/close/submit actions, shapes
    ported field-for-field from board.js (openAccess, openEdit, submitAdd,
    submitEdit, onRemove → pendingRemove + confirmRemove, savePassword,
    onPasswordSwitch, onOauthSwitch, onOauthMode, applyOauth);
  // notices (Task 17 consumes)
  proxyNotice: Notice | null; reloadingProxy: boolean; onProxyReload(): Promise<void>;
}
```

- `core/board/api.ts`: `getStatus()`, `apiPut(path, payload)`, `apiPost(path, payload?)`, `apiPatch`, `apiDelete` — thin fetch wrappers over the frozen endpoints, transliterated from board.js.

- [ ] **Step 1: DOM tests first** (`test/dom/board.spec.ts`), against the Task 12 fixture:

```ts
// renders one row per fixture app; site cell links "name" + ".mattstack" suffix
// healthy row shows Badge "200 34ms"; stopped row shows Badge "unreachable"
// launchd column: "running · pid …" vs "stopped"; unmanaged phrasing when fixture has it
// "this board" chip on the managedBy:"deck" row; "managed · mattstack" chip on the other
// publish Switch per manageable row with the parity aria-label
//   ("make X private" / "publish X"); clicking fires PUT /api/v1/apps/X/publish
//   (assert via page.route interception) then a refresh GET
// strays section titled "services without routes"; tunnel section renders with
//   "carries *.mattstack"
// subline matches logic.subline of the fixture
// restart button (canRestart row): click → POST …/restart intercepted; row
//   flips to Badge "restarting…" with a spinner inside
// issues entry renders Badge "cloudflare sync failed" + <code> message
// external-link anchor present only when publicUrl differs; published copy in
//   its aria-label
```

- [ ] **Step 2: Run, verify failures.**
- [ ] **Step 3: Implement.** `useBoardState` transliterates board.js state into one hook: `useState` per field, `useEffect` for the 5s interval (cleared on unmount; skipped while `editing != null`), all timings from `logic.ts` constants, all derived values delegated to `logic.ts`. Cells:
  - `SiteCell`: name anchor (`<a className="site-name">` with `<strong>` + suffix span), external-link anchor with the published/private aria-label + title logic verbatim, platform/managed `Chip`s (`uppercase` + `title` carrying the old chip tooltips), issues list (Badge intent="bad" + `<code>`), preflight list (Badge intent="warn"/"ok" per board.html's three preflight states).
  - `HealthCell`: restarting → `<Badge intent="warn"><Spinner size="xs" /> restarting…</Badge>`; else no-route muted span / unreachable / status+ms Badge with `title={"HTTP " + status}`; stderr Modal trigger (ghost icon Button, `aria-label` verbatim) — the stderr Modal itself renders `<pre>{stderr.join("\n")}</pre>`.
  - `LaunchdCell`, `PublishCell` (Switch with parity aria-label/title), `AccessCell` (ghost Button with two Icons, `title`/`aria-label` = `accessSummary(row) + ", change access"`), `ActionsCell` (restart / edit / remove sm outline icon Buttons, remove `intent="bad"`, aria-labels verbatim).
  - `Board.tsx` composes header (reload-proxy Button placeholder wired in Task 17, add-app Button opening Task 15's modal state), subline, sections via `Table`, `TunnelSection`. Stamp `data-board-ready` only once `data != null` (moves Task 12's stamp).
- [ ] **Step 4: DOM tests green; `bun test` green; `bun run build:board` + commit artifacts.**
- [ ] **Step 5: Commit** `feat: board tables on tui-kit`.

### Task 14: Port override UX

**Files:**
- Modify: `core/board/AppsTable.tsx` (PortCell), `core/board/board.css`
- Test: `test/dom/port.spec.ts`

**Interfaces:** consumes `useBoardState`'s editing surface (Task 13 shapes).

- [ ] **Step 1: DOM tests:**

```ts
// port Button (ghost, aria-label "change development port") opens inline edit:
//   TextField appears focused (aria-label "development port", inputmode numeric)
// Enter with value → PUT …/override {devPort: N} intercepted; Enter empty → cancel,
//   no request; Escape → cancel; blur → cancel
// override row: struck base port absent (chip carries it): "dev" Chip with
//   title "dev port override, normally 11003"
// hover the row → revert button (aria-label "revert to 11003") and "public too"
//   Switch become visible/interactable; revert → PUT …/override {devPort: null}
// "public too" Switch aria-label + title parity strings; change → PUT
//   …/public-follows-override {follows: true}
// non-manageable row (canManage false fixture variant or self row): plain port text
```

Add a second fixture file only if needed — prefer asserting the self row (`managedBy: "deck"`) which is never editable.

- [ ] **Step 2: Implement.** PortCell ports board.html's four `x-if` arms 1:1. The hover-reveal CSS moves to `board.css` as deck-domain rules keyed on `[data-part="table-row"]:hover .devport-extra, .devport-extra:focus-within` with the old absolute-positioning block (comments preserved only where they state the layout constraint). Editing input is a `TextField` with `inputRef` autofocus, `onKeyDown` Enter/Escape, `onBlur` cancel.
- [ ] **Step 3: Tests green; build:board; commit** `feat: port override editing`.

### Task 15: Add / Edit / Remove flows

**Files:**
- Create: `core/board/modals.tsx`
- Modify: `core/board/Board.tsx`
- Test: `test/dom/modals.spec.ts`

**Interfaces:** consumes `useBoardState` modal surface; kit `Modal`, `TextField`, `Switch`, `Button`, `Alert`, `ConfirmDialog`.

- [ ] **Step 1: DOM tests:**

```ts
// "add app" opens the Add modal: switch "I run this myself — just route a port"
//   first, then Name field (focused, pattern attr present); external=false shows
//   Command + Working directory + "Will be assigned port 11012 (PORT env)."
//   external=true swaps to "Port it listens on"
// submit → POST /api/v1/apps with addPayload shape (intercept + assert body);
//   API error body {message} renders in the modal's Alert, modal stays open
// row edit button opens Edit modal titled "Edit <name>"; service kind shows
//   command/workingDirectory; submit → PATCH with editPatch body; error stays open
// remove button opens ConfirmDialog "Remove <name>?" body "This deletes its
//   service and route."; confirm → DELETE; API error → notice Alert with the
//   API's message verbatim; cancel → no request
```

- [ ] **Step 2: Implement** `AddAppModal`, `EditAppModal`, remove `ConfirmDialog` — field-for-field ports of board.html's dialogs on kit components, header copy verbatim ("Registers a local service: a named https domain, and (unless it runs itself) a supervised process that starts on login.").
- [ ] **Step 3: Tests green; build:board; commit** `feat: add/edit/remove flows`.

### Task 16: Access modal

**Files:**
- Create: `core/board/AccessModal.tsx`
- Modify: `core/board/Board.tsx`
- Test: `test/dom/access.spec.ts`

**Interfaces:** consumes `useBoardState` access surface; kit `Modal`, `Switch`, `TextField`, `TextArea`, `RadioGroup`, `Button`, `Alert`.

- [ ] **Step 1: DOM tests:**

```ts
// access cell button (aria-label = accessSummary + ", change access") opens
//   modal titled "Access · <name>"; published header line vs the two
//   unpublished/no-url variants (copy verbatim from board.html)
// password section: switch ON with no password reveals field + Set button
//   (disabled until typed); Set → PUT …/password {password}; switch OFF from
//   hasPassword → PUT …/password {password:null}; failed OFF re-renders switch
//   still on (route a 500 and assert checked state — the controlled-Switch parity case)
// "Changing it signs out anyone holding a session." hint shown when hasPassword
// oauth section: switch reveals radios + textarea + hint "One per line. Commas
//   work too."; mode flip clears the list; Apply disabled on empty; Apply →
//   PUT …/access {mode:"emails",emails:[…]} with splitList applied
// cfSynced:false response on turn-off → the "visitors may still be asked to
//   sign in" warning Alert
// footer "Done" closes
```

- [ ] **Step 2: Implement** — transliterate `openAccess`/`onPasswordSwitch`/`savePassword`/`onOauthSwitch`/`onOauthMode`/`applyOauth` state machines into the hook (if not already stubbed in Task 13) and render with kit parts. All aria-labels/titles verbatim from board.html.
- [ ] **Step 3: Tests green; build:board; commit** `feat: access modal`.

### Task 17: Proxy notices + reload

**Files:**
- Modify: `core/board/Board.tsx`, `core/board/useBoardState.ts`
- Test: `test/dom/proxy.spec.ts`

**Interfaces:** consumes `logic.autoBanner`, `PROXY_WAIT_MS`; kit `Alert`, `Button`, `Spinner`.

- [ ] **Step 1: DOM tests:**

```ts
// fixture with proxyStale:true → bad Alert with the stale-routes copy
// reload proxy button: click → POST /api/v1/proxy/restart; while waiting the
//   button shows Spinner + "restarting…" and is disabled
// not-authorized response → Alert with the one-time-setup copy and the
//   installCommand rendered in the command <pre>
// success path (route /healthz through one failure then ok) → ok Alert
//   "portless proxy restarted — .localhost now serves the current routes."
// explicit-click notice outranks autoBanner until holdUntil (assert the ok
//   notice survives one refresh tick with proxyStale still true)
```

Use a `proxyStale` variant fixture (`test/fixture/status-stale.json`) and point the rig at it per-test via a `withBoard({ fixture })` option added to `rig.ts`.

- [ ] **Step 2: Implement** `onProxyReload`/`waitForProxy`/`notice`/auto-banner wiring in the hook (transliterated; `waitForProxy`'s sawDrop loop intact) and the header Alert region in `Board.tsx`.
- [ ] **Step 3: Tests green; build:board; commit** `feat: proxy notices and reload`.

### Task 18: Gateway pages in React

**Files:**
- Create: `scripts/build-gateway-css.ts`, `core/generated/gateway.css` (built, committed)
- Modify: `core/gateway-pages.ts` → `core/gateway-pages.tsx`, its importers (`grep -rn "gateway-pages" src core` and update extensions), `core/gateway.test.ts` / `core/gateway-proxy.test.ts` where they assert current markup
- Test: extend the existing gateway test files

**Interfaces:**
- Produces: the same four exports with unchanged signatures: `pageNothingHere(): string`, `pageOffline(app: string): string`, `pageRateLimited(): string`, `pageLogin(app: string, opts?: { error?: boolean; next?: string }): string`.

- [ ] **Step 1: Token CSS generator.** `scripts/build-gateway-css.ts` imports `tuiTheme` from `@mattstack/tui-kit/theme`, reads `tokens.colors` (surface/gray/line/blue/red families) and the theme's `dark` overrides, and emits `core/generated/gateway.css`:

```css
:root { --bg: …; --panel: …; --fg: …; --muted: …; --border: …; --accent: …; --red: …; }
@media (prefers-color-scheme: dark) { :root { /* same seven from the dark block */ } }
```

Values are read off the theme object at build time — never hand-copied. Wire it into `build:board` (one script run emits both) and extend `core/generated-fresh.test.ts` to cover it.

- [ ] **Step 2: Failing tests.** Extend the gateway tests:

```ts
// each page contains no <script> anywhere (zero-JS failure-path contract)
// pageLogin escapes app names: pageLogin('<b>"x"</b>') contains no raw <b> and
//   no raw double-quote in the hidden next value (renderToStaticMarkup escapes;
//   assert the old esc() behaviors survive)
// login form: method POST action /__auth, password input with autofocus +
//   autocomplete="current-password", hidden next field, error paragraph only
//   when opts.error
// each page inlines the generated token css (contains "--bg:")
```

- [ ] **Step 3: Implement.** `core/gateway-pages.tsx`: a `Card({ title, children })` component rendering the doctype-wrapped shell with `<style>{GATEWAY_CSS}</style>` (imported `with { type: "text" }` from `core/generated/gateway.css` plus a small static layout block — grid-centred card, border `var(--border)`, background `var(--panel)`, accent button, `.err` in `var(--red)`); `renderToStaticMarkup` from `react-dom/server`; each page function returns `"<!doctype html>" + renderToStaticMarkup(<Card…/>)`. The lock badge SVG becomes a component. Login form is plain elements (`defaultValue` for the hidden next field). No kit recipe imports here — the pages must not pull the client bundle's weight; they are styled by the generated tokens + local styles only. (This satisfies "all React" at the authoring layer; the kit's *look* arrives via the shared tokens.)
- [ ] **Step 4: Tests green** (`bun test core src`); `bun run build:board`; verify a compiled `bun run build` binary still serves a login page. **Commit** `feat: gateway pages on React + Tokyo tokens`.

### Task 19: Capture harness, fresh baselines, docs, final sweep

**Files:**
- Create: `test/capture.ts`, `test/compare.ts`, `test/baselines/` (committed PNGs)
- Modify: `package.json` (scripts `capture`, `capture:baseline`, `capture:compare`), `README.md` (dev-loop section), `docs/` note if README grows too long
- Test: `bun run capture:compare`

**Interfaces:** consumes the fixture server (Task 12), all board surfaces (13–17).

- [ ] **Step 1: Port the harness.** Copy `mr-board/tests/capture.ts` and `tests/compare.ts` shapes (deterministic chromium flags verbatim — they are the product of a debugging session; font-host blocking only if the shell links webfonts, which deck's does not — drop that block). Scenario list (name → actions):
  - Day: `board-default` (fixture load), `board-empty` (empty fixture file), `board-override-hover` (hover row 2), `board-preflight` (fixture arranged so row 2 shows preflight), `board-sections` (scroll to strays+tunnel), `modal-add-service` / `modal-add-external` (open, flip switch), `modal-edit`, `modal-access` (password on + oauth emails), `modal-stderr`, `notice-ok`, `notice-error` (stale fixture)
  - Night: `board-default-dark`, `modal-access-dark`, `notice-error-dark` — via `page.emulateMedia({ colorScheme: "dark" })`.
- [ ] **Step 2: Take baselines.** `bun run capture:baseline`; eyeball every PNG (this is the moment the new look is accepted — flag anything visually broken and fix before committing); commit `test/baselines/`.
- [ ] **Step 3: Stability check.** `bun run capture && bun run capture:compare` → 15/15 zero-diff on a re-run.
- [ ] **Step 4: Docs.** README gains a "Board dev loop" section: `bun run build:board` after client edits (the freshness test enforces it), `bun run test:dom`, `bun run capture:compare`, the file: kit dependency note (clean `bun install` needed after kit package.json changes — see mr-board `docs/tui-kit-devloop.md` for why), and the react-singleton constraint.
- [ ] **Step 5: Final sweep.** `bun test` (all suites), `bun run test:e2e` (must pass unmodified), `bun run build` + boot the compiled binary against the fixture. In tui-kit: `bun run typecheck && bun run test && bun run gates` one last time.
- [ ] **Step 6: Commit** `feat: capture harness and fresh Tokyo baselines`.

---

## Plan self-review notes

- Spec §3.1–3.9 → Tasks 1–9. §4.1 → 11/13–17. §4.2 → 11. §4.3 → 11 (freshness test). §5 → 18. §6 → 11 (scheme watcher) + 18 (media-query CSS). §7.1 → per-recipe steps. §7.2 → 12–17, 19. §8 → asserted across 13–17 DOM tests; timings imported from `logic.ts` constants. §9 risks: singleton (11), staleness (11), same-plan kit fixes (SDD fix loops), scheme flash (11 + dark captures in 19), zero-JS gateway (18 test), comments rule (global constraints).
- Deliberate deviation from spec §5: gateway pages do not import kit *recipes* (they would drag component CSS-modules into a server-rendered string); they are React components styled by the theme-derived token CSS. The spec's "React-authored, zero client JS, kit-derived Tokyo styling" contract is fully met; Task 18 states this in place.
- Two intermediate-state notes for the executor: after Task 11 the board is a header-only shell until Task 13 restores full function (tests stay green throughout); Task 13's hook may stub the modal/notice surfaces it declares, with 15–17 filling them in.
