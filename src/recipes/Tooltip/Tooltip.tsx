import type { ComponentProps, HTMLAttributes, ReactNode } from "react";
import { defineComponent } from "../../builders.ts";
import classes from "./Tooltip.module.css";

/** Authoring category (1 = pure styled primitive). Read off this module by
    scripts/derive.ts to build the kit's manifest; not dead code. */
export const recipeCategory = 1 as const;

const TOOLTIP_SELECTORS = ["root"] as const;

/** Stable selector surface for app-side CSS, stamped in the non-overridable
    tail so a call site cannot sever an app's `[data-part]` rules. */
export const TOOLTIP_PARTS = { root: "tooltip" } as const;

/** Gap between the trigger's own box (`top: 100%`, not StatusDot's fixed
    em offset off a tiny glyph) and the hover card — StatusDot's
    `--sd-tooltip-offset` overlaps any trigger taller than ~1.5em, so this
    recipe measures from the box edge instead and only needs a small gap. */
const TOOLTIP_SCALARS: Record<string, string> = {
  "--sb-tooltip-gap": "var(--spacing-xxs)",
};

export interface TooltipOwnProps {
  /** Tooltip text, rendered by CSS `content: attr(data-tip)` — the same
      mechanism StatusDot's dot tooltip uses, so it exposes NOTHING to
      assistive tech: no accessible name, no role, no announcement. A
      consumer whose wrapped content needs the tip's information conveyed to
      AT still supplies its own `aria-label`/`aria-describedby` — this recipe
      does not, and cannot, do that for them. */
  tip: string;
  children?: ReactNode;
}

type TooltipProps_ = TooltipOwnProps & Omit<HTMLAttributes<HTMLSpanElement>, "ref">;

export const Tooltip = defineComponent<
  TooltipProps_,
  typeof TOOLTIP_SELECTORS,
  readonly [],
  readonly [],
  HTMLSpanElement
>({
  name: "Tooltip",
  selectors: TOOLTIP_SELECTORS,
  classes,
  vars: () => ({ root: { ...TOOLTIP_SCALARS } }),
  render: ({ props, getStyles, ref }) => {
    const {
      tip,
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
        data-part={TOOLTIP_PARTS.root}
        data-tip={tip}
      >
        {children}
      </span>
    );
  },
});

export type TooltipProps = ComponentProps<typeof Tooltip>;

/** No-op `.extend({})` a consumer's `createTheme({ components })` starts from. */
export const tooltipTheme = Tooltip.extend({});
