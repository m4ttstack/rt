import { mergeRefs } from "@soribashi/core";
import type { ComponentProps, HTMLAttributes } from "react";
import { useMemo, useRef } from "react";
import { defineComponent } from "../../builders.ts";
import { TooltipCard, useTooltipReveal } from "../Tooltip/TooltipCard.tsx";
import classes from "./StatusDot.module.css";

/** Authoring category (1 = pure styled primitive). Read off this module by
    scripts/derive.ts to build the kit's manifest; not dead code. This recipe
    takes an already-derived `intent`/`tip` pair — mr-board's own ok/warn/bad
    classification is board domain logic and stays board-side. */
export const recipeCategory = 1 as const;

/** `root` is the tooltip anchor; `dot` is the coloured glyph; `card` is the
    portaled hover card, shared machinery with Tooltip (see TooltipCard.tsx). */
const STATUSDOT_SELECTORS = ["root", "dot", "card"] as const;

/** Stable selector surface for app-side CSS, stamped in the non-overridable
    tail so a call site cannot sever an app's `[data-part]` rules. */
export const STATUSDOT_PARTS = {
  root: "statusdot",
  dot: "statusdot-dot",
  card: "statusdot-card",
} as const;

/** `intent` maps DIRECTLY to the dot tokens, deliberately bypassing autoVars
    and the theme's intent resolver, which would collapse the dot palette's
    separate visibility budget. Same reason no `vocabularyAxes` are declared.
    See docs/decisions.md. */
const STATUSDOT_TONES: Record<StatusDotOwnProps["intent"], string> = {
  ok: "var(--dot-ok)",
  warn: "var(--dot-warn)",
  bad: "var(--dot-bad)",
};

/** The same trigger-scoped gap var Tooltip's card reads (TooltipCard.tsx's
    `resolveGapPx`) — reusing its name, not just its shape, is what lets the
    two recipes share one card implementation. `--sd-tooltip-offset` (a fixed
    1.5em from the root's OWN top edge) is retired: that "top edge" geometry
    only made sense for the old `position: absolute` card measured against its
    `position: relative` parent. The shared card measures `rect.bottom + gap`
    off `getBoundingClientRect()` instead, so a top-offset number has no slot
    to plug into any more. */
const STATUSDOT_SCALARS: Record<string, string> = {
  "--sb-tooltip-gap": "var(--spacing-xxs)",
};

/** StatusDot's own props; `StatusDotProps` below is the full public surface. */
export interface StatusDotOwnProps {
  /** Which of the three dot tokens colours the glyph. A three-value RECIPE
      scalar, not the theme's `intent` vocabulary axis — see STATUSDOT_TONES. */
  intent: "ok" | "warn" | "bad";
  /** Tooltip text. The card exposes nothing to assistive tech (`aria-hidden`),
      mr-board's own ceiling. A consumer who needs the status announced adds
      `role`/`aria-label` themselves. Omitted entirely: no card ever shows. */
  tip?: string;
}

type StatusDotProps_ = StatusDotOwnProps & Omit<HTMLAttributes<HTMLSpanElement>, "ref">;

export const StatusDot = defineComponent<
  StatusDotProps_,
  typeof STATUSDOT_SELECTORS,
  readonly [],
  readonly [],
  HTMLSpanElement
>({
  name: "StatusDot",
  selectors: STATUSDOT_SELECTORS,
  classes,
  // Nothing to merge with the builder's automatic autoVars output, which a
  // recipe-supplied resolver replaces: StatusDot declares no `variants`.
  vars: (_theme, props) => ({
    root: { ...STATUSDOT_SCALARS },
    dot: { "--sd-color": STATUSDOT_TONES[(props as StatusDotOwnProps).intent] },
  }),
  render: ({ props, getStyles, ref }) => {
    // `intent` is destructured out even though it is not a Styles API key: it is
    // consumed by the `vars` resolver above, and left in `rest` it would leak
    // onto the DOM as a raw `intent="ok"` attribute.
    const {
      intent: _intent,
      tip,
      classNames: _classNames,
      styles: _styles,
      vars: _vars,
      attributes: _attributes,
      unstyled: _unstyled,
      ...rest
    } = props;

    const triggerRef = useRef<HTMLSpanElement | null>(null);
    const setRefs = useMemo(() => mergeRefs(triggerRef, ref), [ref]);
    // Hover-only, unlike Tooltip's focus-within reveal — StatusDot has no
    // keyboard-focus contract today (see StatusDotOwnProps.tip's doc comment).
    const visible = useTooltipReveal(triggerRef, { active: tip !== undefined, focusWithin: false });

    return (
      <span
        ref={setRefs}
        {...rest}
        {...getStyles("root")}
        data-part={STATUSDOT_PARTS.root}
        // Kept for a consumer that still reads it even though the kit's own
        // CSS no longer does — see Tooltip.tsx's identical note.
        data-tip={tip}
      >
        <span {...getStyles("dot")} data-part={STATUSDOT_PARTS.dot}>
          ●
        </span>
        {tip !== undefined && (
          <TooltipCard
            triggerRef={triggerRef}
            visible={visible}
            gapVar="--sb-tooltip-gap"
            part={STATUSDOT_PARTS.card}
            cardProps={getStyles("card")}
          >
            {tip}
          </TooltipCard>
        )}
      </span>
    );
  },
});

/** Everything a call site may pass, own props included. */
export type StatusDotProps = ComponentProps<typeof StatusDot>;

/** No-op `.extend({})` a consumer's `createTheme({ components })` starts from. */
export const statusDotTheme = StatusDot.extend({});
