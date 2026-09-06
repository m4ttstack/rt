import { mergeRefs } from "@soribashi/core";
import type { ComponentProps, HTMLAttributes, ReactNode } from "react";
import { useMemo, useRef } from "react";
import { defineComponent } from "../../builders.ts";
import { TooltipCard, useTooltipReveal } from "./TooltipCard.tsx";
import classes from "./Tooltip.module.css";

/** Authoring category (1 = pure styled primitive). Read off this module by
    scripts/derive.ts to build the kit's manifest; not dead code. */
export const recipeCategory = 1 as const;

const TOOLTIP_SELECTORS = ["root", "card"] as const;

/** Stable selector surface for app-side CSS, stamped in the non-overridable
    tail so a call site cannot sever an app's `[data-part]` rules. */
export const TOOLTIP_PARTS = { root: "tooltip", card: "tooltip-card" } as const;

/** Read by TooltipCard off the trigger element at show time (see its
    `resolveGapPx`) — a portaled card can't inherit this through the cascade,
    since createPortal moves it out of the trigger's subtree. */
const TOOLTIP_GAP_VAR = "--sb-tooltip-gap";

const TOOLTIP_SCALARS: Record<string, string> = {
  [TOOLTIP_GAP_VAR]: "var(--spacing-xxs)",
};

export interface TooltipOwnProps {
  /** Tooltip text. The card exposes NOTHING to assistive tech (`aria-hidden`,
      no role, no announcement) — a consumer whose wrapped content needs the
      tip's information conveyed to AT still supplies its own
      `aria-label`/`aria-describedby`; this recipe does not, and cannot, do
      that for them. */
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

    const triggerRef = useRef<HTMLSpanElement | null>(null);
    const setRefs = useMemo(() => mergeRefs(triggerRef, ref), [ref]);
    const visible = useTooltipReveal(triggerRef, { active: true, focusWithin: true });

    return (
      <span
        ref={setRefs}
        {...rest}
        {...getStyles("root")}
        data-part={TOOLTIP_PARTS.root}
        // Kept for a consumer that still reads it (e.g. an existing E2E
        // selector) even though the kit's own CSS no longer does — the
        // card's content is now the real DOM text below, not attr(data-tip).
        data-tip={tip}
      >
        {children}
        <TooltipCard
          triggerRef={triggerRef}
          visible={visible}
          gapVar={TOOLTIP_GAP_VAR}
          part={TOOLTIP_PARTS.card}
          cardProps={getStyles("card")}
        >
          {tip}
        </TooltipCard>
      </span>
    );
  },
});

export type TooltipProps = ComponentProps<typeof Tooltip>;

/** No-op `.extend({})` a consumer's `createTheme({ components })` starts from. */
export const tooltipTheme = Tooltip.extend({});
