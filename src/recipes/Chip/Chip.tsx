import { autoVars } from "@soribashi/core";
import type { ComponentProps, ReactNode } from "react";
import { definePolymorphicComponent } from "../../builders.ts";
import classes from "./Chip.module.css";

/**
 * Authoring category from soribashi's recipe conversion playbook's four
 * categories (soribashi
 * docs/superpowers/specs/2026-04-26-recipe-conversion-playbook.md § 2, reached
 * through .claude/skills/authoring-a-recipe/SKILL.md § 2):
 * 1 = pure styled primitive (§ 2.1) — one element, style slots, variants.
 *
 * `definePolymorphicComponent`, and the polymorphism is the whole point: nine
 * of mr-board's badge components render a `<span>`, and the clickable ones
 * (`.tui-review-open` — a saved review, an unposted respond draft, a held
 * outbound note) render a `<button>`. That is the skill's own criterion for
 * the builder choice.
 *
 * THE `asButton` DECISION, recorded because the brief left it open.
 * The brief floated `asButton?: boolean`; this recipe ships `as="button"`
 * instead, i.e. the builder's own polymorphism, and no bespoke boolean. Four
 * reasons, in order of weight:
 *
 *  1. `as` is soribashi's ONE public polymorphism surface. The skill's own
 *     traps section makes the same call for Base UI's `render` prop ("never
 *     let it leak through as a second, undocumented one"); a boolean that
 *     silently means `as="button"` is exactly that second surface, and the two
 *     can then disagree (`<Chip asButton as="a">`).
 *  2. `as` carries the ELEMENT'S TYPES with it. `PolymorphicComponentResult`
 *     is generic over `TAs`, so `<Chip as="button" disabled type="submit" />`
 *     type-checks and `<Chip disabled />` does not. `asButton` would leave the
 *     prop surface typed as span attributes while rendering a button — every
 *     button-only prop then needs a cast at the call site.
 *  3. It composes. mr-board already wraps one chip in an `<a>` (SlackPostedChip
 *     around a permalink); `as="a"` serves that for free, where a boolean
 *     vocabulary needs a second `asLink` the day someone wants it.
 *  4. It stays inside invariant 1. `as` resolves AFTER `useProps`
 *     (define-polymorphic-component.tsx says so explicitly), so
 *     `Chip.extend({ defaultProps: { as: 'button' } })` retargets the element
 *     from a theme — pinned by Chip.test.tsx's second extend case. A
 *     recipe-owned boolean would also thread through defaultProps, but only
 *     because it is an ordinary prop; nothing about it is element-aware.
 *
 * The one thing `asButton` would have bought — a call site that reads as a
 * flag rather than an element name — is bought instead by the CSS keying its
 * interactive treatment on `:is(button, a)` (see Chip.module.css), so the
 * element and the styling can never disagree.
 *
 * Read by scripts/derive.ts to build the kit's manifest; not itself derived,
 * since it records an authoring decision, not a fact recoverable from
 * RecipeMeta or the CSS.
 */
export const recipeCategory = 1 as const;

/**
 * The recipe's style slots. `root` is the chip box; `icon` is the wrapper
 * mr-board calls `.tui-badge-emoji`, which exists so a glyph's line box does
 * not shove the label's baseline around.
 */
const CHIP_SELECTORS = ["root", "icon"] as const;

/**
 * tui-kit's `data-part` convention (design spec § "Parity mechanics" 1;
 * controller ruling R7). Hashed CSS-module class names cannot be selected from
 * mr-board's residual `style.css`, so every addressable slot carries a stable,
 * SELF-IDENTIFYING data attribute:
 *
 *   root slot        -> the lowercased recipe name          (`chip`)
 *   every other slot -> `<recipe>-<slot key>`               (`chip-icon`)
 *
 * Self-identifying rather than bare slot keys, because the value has to work
 * standing alone: `[data-part="root"]` would match every recipe's root and
 * force the app to always qualify by an ancestor. `[data-part="chip"]` is the
 * drop-in replacement for the `.tui-review` the recipe absorbed.
 *
 * THE SPREAD POSITION IS PART OF THE CONVENTION: `data-part` is stamped in the
 * NON-OVERRIDABLE TAIL, after `{...rest}`, alongside `getStyles`. It is a
 * contract between the kit and mr-board's stylesheet, not a consumer-facing
 * prop — a `<Chip data-part="whatever" />` that won the spread would silently
 * sever every app-side `[data-part="chip"]` rule, with no error on either side
 * of the boundary. Pinned by Chip.test.tsx's "a consumer-supplied data-part
 * does not win".
 *
 * Exported (Icon keeps its single value module-private) because Task 20's
 * adoption pass rewrites ~30 board class selectors onto these two values and a
 * typo in either is silent on both sides.
 */
export const CHIP_PARTS = { root: "chip", icon: "chip-icon" } as const;

/**
 * Chip's own variant set, and deliberately TWO of the theme's three
 * (authoring skill § 14). `outline` is every coloured chip in the board — the
 * state classes all set `border-color: currentColor` over `.tui-review`'s
 * neutral frame. `subtle` is that frame left alone, which is `.tui-review`
 * itself plus the three `*-queued` states. `ghost` is dropped: nothing in the
 * family renders a borderless chip, and inheriting a value the recipe cannot
 * render commits CSS and visual baselines to a pairing nobody wants.
 *
 * `as const` IS LOAD-BEARING and is the sharpest trap in the authoring skill:
 * `VariantProp<TVariants>` collapses to `unknown` — an intersection no-op, so
 * `variant` accepts anything — exactly when `TVariants[number]` widens to
 * plain `string`, which is what dropping the assertion does. `<Chip
 * variant="nope" />` would then compile silently.
 *
 * Declared on the BUILDER CONFIG (not only via `.extend({ vocabulary })`,
 * skill § 13): `RecipeMeta.variants` and therefore the manifest key on this
 * tuple, and so does dev validation's recipe-local path, which is checked
 * before the theme-wide vocabulary.
 */
const CHIP_VARIANTS = ["outline", "subtle"] as const;

/**
 * The axes this recipe opts into. `getStyles('root')` stamps `data-intent` and
 * `data-variant` from them and NOTHING here may hand-emit those (skill § 7).
 *
 * `size` is deliberately absent. The census found exactly one chip size in
 * mr-board (11px, `.tui-review` and `.tui-flag` alike); the only smaller
 * relative is `.tui-draft`, whose 0.55rem is inseparable from its uppercase /
 * 700 / tracked register and is therefore served by the `uppercase` modifier
 * below, not by a size rung. Opting in anyway would have meant five renderable
 * sizes, five sets of visual baselines, and four of them invented — an API
 * promotion ahead of a real call site. It is additive whenever one appears:
 * add `'size'` here plus a size-keyed dimension record read in `vars`.
 */
const CHIP_VOCABULARY_AXES = ["intent", "variant"] as const;

/**
 * The recipe's own scalars — the three values the chip family needs that have
 * no theme rung to sit on.
 *
 * This is the authoring skill's § 6 dimension-record pattern with one
 * deviation, stated so it is not mistaken for the pattern itself: soribashi's
 * exemplars (`BUTTON_HEIGHTS`, `BADGE_HEIGHTS`) key a record on the theme's
 * `size` vocabulary, and Chip declares no size axis, so this record is keyed
 * by CONCERN instead. Everything else about the pattern holds and is the
 * reason it lives here rather than in the framework: the kit is a consumer and
 * owns these values (invariant 2), and a theme still retunes any of them per
 * instance through `Chip.extend({ vars })`.
 *
 * - pulse period: mr-board's `1.4s`, the FULL cycle. Chip.module.css halves it
 *   for its `alternate` spelling, so this stays the number the board wrote.
 * - dimmed opacity: the modal value across the board's four quiet states.
 * - uppercase tracking: `.tui-draft` / `.tui-peered`'s `0.06em`. An `em` is
 *   deliberately relative to the element's own font size, which is exactly why
 *   src/theme.ts declares no letter-spacing rungs.
 */
const CHIP_SCALARS: Record<string, string> = {
  "--sb-chip-pulse-period": "1.4s",
  "--sb-chip-dimmed-opacity": "0.7",
  "--sb-chip-uppercase-tracking": "0.06em",
};

/**
 * The recipe's OWN props. The full public surface is `ChipProps` below: this,
 * plus `intent`/`variant`, plus the target element's attributes, plus the
 * Styles API and the universal style props the builder adds for free.
 *
 * Two modifiers the board has that are NOT here, because the builder already
 * supplies them (skill § 5) and a recipe prop would only shadow them:
 *   `.tui-nudged { font-weight: 600 }`  ->  `<Chip fw={600}>`
 *   any one-off opacity                 ->  `<Chip opacity={0.6}>`
 * `dimmed` earns its place over the second of those only because seven board
 * rules want the same dim and a boolean keeps that number in one place.
 */
export interface ChipOwnProps {
  children?: ReactNode;
  /**
   * A leading glyph, rendered into the `chip-icon` slot. Decorative by
   * contract (the slot is `aria-hidden`, matching mr-board's own `BADGE_ICON`
   * svgs and `.tui-badge-emoji` span), so a chip's accessible name is its
   * children alone — put anything a screen reader needs in `children`.
   */
  icon?: ReactNode;
  /** The board's 1.4s opacity pulse: work is in flight on this axis. */
  pulse?: boolean;
  /** The board's quiet register for a queued / unanswered / resolved state. */
  dimmed?: boolean;
  /** `.tui-draft`'s small-caps register: uppercase, tracked, 700, 0.55rem. */
  uppercase?: boolean;
}

/**
 * All five generic params are supplied explicitly, following soribashi's
 * Button/Badge: inference alone has been observed there to silently drop the
 * vocabulary-axis typing.
 */
export const Chip = definePolymorphicComponent<
  ChipOwnProps,
  "span",
  typeof CHIP_SELECTORS,
  typeof CHIP_VARIANTS,
  typeof CHIP_VOCABULARY_AXES
>({
  name: "Chip",
  defaultElement: "span",
  vocabularyAxes: CHIP_VOCABULARY_AXES,
  selectors: CHIP_SELECTORS,
  variants: CHIP_VARIANTS,
  classes,
  // Both axes need a default and NOT only for ergonomics: autoVars returns {}
  // unless BOTH `intent` and `variant` are set (auto-vars.ts's early return),
  // so a Chip rendered with neither would get no --chip-* vars at all and
  // would silently lose its whole colour story. `accent` is the board's own
  // default chip colour (`.tui-peer` / `.tui-nudge` / `.tui-nudged` all sit on
  // `var(--accent)` with no further state class).
  defaults: { intent: "accent", variant: "outline" },
  // A RECIPE-SUPPLIED `vars` RESOLVER REPLACES THE BUILDER'S AUTOMATIC
  // autoVars CALL — it does not layer on top of it (skill § 4 + § 10;
  // define-polymorphic-component.tsx does `config.vars ? config.vars(...) :
  // autoVars(...)`, mutually exclusive). Chip needs BOTH: the auto-derived
  // --chip-bg/-color/-border/-hover vars (it is colour-bearing) AND its own
  // scalars above. Forget the merge and the CSS still parses — the colours
  // just resolve to nothing. Button and Badge are the two soribashi recipes
  // that get this right; this is their pattern.
  vars: (theme, props) => ({
    root: {
      ...(autoVars(theme, "Chip", props as Record<string, unknown>, true).root ?? {}),
      ...CHIP_SCALARS,
    },
  }),
  render: ({ Element, props, getStyles, ref }) => {
    // Vocabulary-axis props are NOT stripped by the builder before render
    // (only `as` is), and getStyles('root') already emits data-intent /
    // data-variant, so they are destructured out here rather than leaked onto
    // the DOM as raw `intent="ok"` attributes. classNames/styles/vars/
    // attributes/unstyled are the Styles API's own config surface, consumed
    // internally by useStyles and not valid DOM attributes either.
    const {
      children,
      icon,
      pulse,
      dimmed,
      uppercase,
      intent: _intent,
      variant: _variant,
      classNames: _classNames,
      styles: _styles,
      vars: _vars,
      attributes: _attributes,
      unstyled: _unstyled,
      ...rest
    } = props;

    // Band 1 for the button form only: a chip inside a form must never submit
    // it. Spread BEFORE `rest`, so `<Chip as="button" type="submit">` still
    // wins — the same courtesy soribashi's Button extends.
    const domProps = Element === "button" ? { type: "button" as const, ...rest } : rest;

    return (
      <Element
        ref={ref}
        // Band 2: everything the consumer passed.
        {...domProps}
        // Band 3, the NON-OVERRIDABLE TAIL — nothing below may be replaced
        // from a call site. `getStyles` first (so the recipe's own class and
        // vars beat a raw className/style), then the kit's cross-boundary
        // `data-part`, then the three boolean modifiers. Those are hand
        // stamped because `mod` is Box-only in soribashi and every other
        // recipe reflects its own booleans by hand (skill § 7's `data-grow` /
        // `data-with-border` precedent); `|| undefined` so the attribute is
        // ABSENT rather than `="false"`, which is what makes the bare
        // `[data-pulse]` selector in the stylesheet mean what it reads as.
        {...getStyles("root")}
        data-part={CHIP_PARTS.root}
        data-pulse={pulse || undefined}
        data-dimmed={dimmed || undefined}
        data-uppercase={uppercase || undefined}
      >
        {icon != null && (
          <span {...getStyles("icon")} data-part={CHIP_PARTS.icon} aria-hidden>
            {icon}
          </span>
        )}
        {children}
      </Element>
    );
  },
});

/** Everything a call site may pass, own props included. */
export type ChipProps = ComponentProps<typeof Chip>;

/**
 * The recipe's theme-entry convenience export — the no-op `.extend({})` a
 * consumer's `createTheme({ components: [...] })` can start from.
 */
export const chipTheme = Chip.extend({});
