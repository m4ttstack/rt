import type { ComponentProps, HTMLAttributes, Ref } from "react";
import { defineComponent } from "../../builders.ts";
import classes from "./StatusDot.module.css";

/** Authoring category (1 = pure styled primitive). Read off this module by
    scripts/derive.ts to build the kit's manifest; not dead code. This recipe
    takes an already-derived `intent`/`tip` pair — mr-board's own ok/warn/bad
    classification is board domain logic and stays board-side. */
export const recipeCategory = 1 as const;

/** `root` is the tooltip anchor; `dot` is the coloured glyph. */
const STATUSDOT_SELECTORS = ["root", "dot"] as const;

/** Stable selector surface for app-side CSS, stamped in the non-overridable
    tail so a call site cannot sever an app's `[data-part]` rules. */
export const STATUSDOT_PARTS = { root: "statusdot", dot: "statusdot-dot" } as const;

/** `intent` maps DIRECTLY to the dot tokens, deliberately bypassing autoVars
    and the theme's intent resolver, which would collapse the dot palette's
    separate visibility budget. Same reason no `vocabularyAxes` are declared.
    See docs/decisions.md. */
const STATUSDOT_TONES: Record<StatusDotOwnProps["intent"], string> = {
  ok: "var(--dot-ok)",
  warn: "var(--dot-warn)",
  bad: "var(--dot-bad)",
};

/** Verbatim mr-board value. An em has no theme rung by design, but still needs
    a `var()` outlet to pass the CSS gate. */
const STATUSDOT_SCALARS: Record<string, string> = {
  "--sd-tooltip-offset": "1.5em",
};

/** StatusDot's own props; `StatusDotProps` below is the full public surface. */
export interface StatusDotOwnProps {
  /** Which of the three dot tokens colours the glyph. A three-value RECIPE
      scalar, not the theme's `intent` vocabulary axis — see STATUSDOT_TONES. */
  intent: "ok" | "warn" | "bad";
  /** Tooltip text, rendered by CSS `content: attr(data-tip)` — so it exposes
      nothing to assistive tech, mr-board's own ceiling. A consumer who needs
      the status announced adds `role`/`aria-label` themselves. */
  tip?: string;
}

type StatusDotProps_ = StatusDotOwnProps & Omit<HTMLAttributes<HTMLSpanElement>, "ref">;

export const StatusDot = defineComponent<
  StatusDotProps_,
  typeof STATUSDOT_SELECTORS,
  readonly [],
  readonly []
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

    return (
      <span
        ref={ref as Ref<HTMLSpanElement>}
        {...rest}
        {...getStyles("root")}
        data-part={STATUSDOT_PARTS.root}
        data-tip={tip}
      >
        <span {...getStyles("dot")} data-part={STATUSDOT_PARTS.dot}>
          ●
        </span>
      </span>
    );
  },
});

/** Everything a call site may pass, own props included. */
export type StatusDotProps = ComponentProps<typeof StatusDot>;

/** No-op `.extend({})` a consumer's `createTheme({ components })` starts from. */
export const statusDotTheme = StatusDot.extend({});
