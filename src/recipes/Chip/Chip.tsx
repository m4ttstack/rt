import { autoVars } from "@soribashi/core";
import type { ComponentProps, ReactNode } from "react";
import { definePolymorphicComponent } from "../../builders.ts";
import classes from "./Chip.module.css";
import "./Chip.keyframes.css";

/** Authoring category (1 = pure styled primitive). Read off this module by
    scripts/derive.ts to build the kit's manifest; not dead code. */
export const recipeCategory = 1 as const;

const CHIP_SELECTORS = ["root", "icon"] as const;

/** Stable selector surface for app-side CSS, since CSS-module class names are
    hashed. Stamped in the non-overridable tail (after `{...rest}`) so a
    `<Chip data-part="…" />` cannot sever an app's `[data-part="chip"]` rules. */
export const CHIP_PARTS = { root: "chip", icon: "chip-icon" } as const;

/** Two of the theme's four variants — `default` (opaque panel) and `light`
    (soft filled) are omitted: nothing in the chip family renders either,
    only a bordered-outline or a fully transparent pill. `subtle` here is the
    same transparent-at-rest, tone-coloured-text box Chip always rendered —
    the old shared resolver returned `background: "transparent"` for every
    variant unconditionally, so this name was never actually a rename in
    substance, just in which branch of the new per-variant resolver it now
    reads (`singleShadeVariantColors`'s `subtle` branch is mechanically that
    same box). `as const` is load-bearing: without it `TVariants[number]`
    widens to `string` and `VariantProp` collapses to `unknown`, so
    `<Chip variant="nope" />` compiles silently. */
const CHIP_VARIANTS = ["outline", "subtle"] as const;

const CHIP_VOCABULARY_AXES = ["intent", "variant"] as const;

/** Verbatim mr-board values, retunable via `Chip.extend({ vars })`. The pulse
    period is the FULL cycle (Chip.module.css owns the keyframe stops). */
const CHIP_SCALARS: Record<string, string> = {
  "--sb-chip-pulse-period": "1.4s",
  "--sb-chip-dimmed-opacity": "0.7",
  "--sb-chip-uppercase-tracking": "0.06em",
};

/** Chip's own props; `ChipProps` below is the full public surface. */
export interface ChipOwnProps {
  children?: ReactNode;
  /** A leading glyph. Decorative by contract — the slot is `aria-hidden`, so a
      chip's accessible name is its children alone. */
  icon?: ReactNode;
  /** The board's opacity pulse: work is in flight on this axis. */
  pulse?: boolean;
  /** The board's quiet register for a queued / unanswered / resolved state. */
  dimmed?: boolean;
  /** Small-caps register: uppercase, tracked, 700, 0.55rem. */
  uppercase?: boolean;
}

/** All five generic params are explicit: inference alone has been observed to
    silently drop the vocabulary-axis typing. */
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
  // Both axes need a default: autoVars returns {} unless BOTH intent and
  // variant are set, so a Chip rendered with neither gets no --chip-* vars at
  // all and silently loses its whole colour story.
  defaults: { intent: "accent", variant: "outline" },
  // A recipe-supplied `vars` resolver REPLACES the builder's automatic autoVars
  // call rather than layering on it, so the auto-derived colour vars must be
  // merged in by hand here. Forget the merge and the CSS still parses — the
  // colours just resolve to nothing.
  vars: (theme, props) => ({
    root: {
      ...(autoVars(theme, "Chip", props as Record<string, unknown>, true).root ?? {}),
      ...CHIP_SCALARS,
    },
  }),
  render: ({ Element, props, getStyles, ref }) => {
    // Vocabulary-axis props are not stripped by the builder (only `as` is), and
    // getStyles('root') already emits data-intent/data-variant.
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

    // Before `rest`, so `<Chip as="button" type="submit">` still wins.
    const domProps = Element === "button" ? { type: "button" as const, ...rest } : rest;

    return (
      <Element
        ref={ref}
        {...domProps}
        // Non-overridable tail: getStyles first (so the recipe's class and vars
        // beat a raw className/style), then the cross-boundary data-part, then
        // the modifiers. `|| undefined` keeps the attribute ABSENT rather than
        // `="false"`, which is what makes the bare `[data-pulse]` selector work.
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

/** No-op `.extend({})` a consumer's `createTheme({ components })` starts from. */
export const chipTheme = Chip.extend({});
