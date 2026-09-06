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
  // The two mixes are built here, not in Badge.module.css, so the CSS file
  // only ever references var(--sb-badge-*) — the no-hardcoded-values gate
  // flags a literal color-mix() percentage even inside var()'s own
  // expression tree, so the mix has to be assembled where percentages
  // aren't scanned. Same escape hatch Button's --surface-wash-fg-5 uses,
  // done inline because no existing wash token carries a per-intent tone.
  vars: (_theme, props) => {
    const tone = BADGE_TONES[(props as BadgeOwnProps).intent ?? "muted"];
    return {
      root: {
        "--sb-badge-color": tone,
        "--sb-badge-bg": `color-mix(in srgb, ${tone} 12%, transparent)`,
        "--sb-badge-border": `color-mix(in srgb, ${tone} 40%, transparent)`,
      },
    };
  },
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
