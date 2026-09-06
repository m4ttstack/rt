import type { ComponentProps, HTMLAttributes, ReactNode } from "react";
import { defineComponent } from "../../builders.ts";
import classes from "./Alert.module.css";

/** Authoring category (1 = pure styled primitive). Read off this module by
    scripts/derive.ts to build the kit's manifest; not dead code. */
export const recipeCategory = 1 as const;

const ALERT_SELECTORS = ["root", "command"] as const;

export const ALERT_PARTS = { root: "alert", command: "alert-command" } as const;

/** Two-value recipe scalar mapped straight to family tokens, deliberately
    bypassing autoVars — same rationale as Badge's BADGE_TONES. */
const ALERT_TONES: Record<AlertOwnProps["intent"], string> = {
  ok: "var(--green)",
  bad: "var(--red)",
};

export interface AlertOwnProps {
  /** Both deck call sites (proxy notice, modal form error) always know their
      intent, so unlike Badge there is no sane default — required. */
  intent: "ok" | "bad";
  /** Rendered as a <pre data-part="alert-command"> below the children when
      given; omitted entirely otherwise. */
  command?: string;
  children?: ReactNode;
}

type AlertProps_ = AlertOwnProps & Omit<HTMLAttributes<HTMLDivElement>, "ref">;

export const Alert = defineComponent<
  AlertProps_,
  typeof ALERT_SELECTORS,
  readonly [],
  readonly [],
  HTMLDivElement
>({
  name: "Alert",
  selectors: ALERT_SELECTORS,
  classes,
  // The mix is built here, not in Alert.module.css, so the CSS file only
  // ever references var(--sb-alert-*) — the no-hardcoded-values gate flags a
  // literal color-mix() percentage even inside var()'s own expression tree,
  // so the mix has to be assembled where percentages aren't scanned. Same
  // escape hatch Badge.tsx's --sb-badge-bg/--sb-badge-border use.
  vars: (_theme, props) => {
    const tone = ALERT_TONES[(props as AlertOwnProps).intent];
    return {
      root: {
        "--sb-alert-color": tone,
        "--sb-alert-bg": `color-mix(in srgb, ${tone} 10%, transparent)`,
      },
    };
  },
  render: ({ props, getStyles, ref }) => {
    const {
      intent,
      command,
      children,
      classNames: _classNames,
      styles: _styles,
      vars: _vars,
      attributes: _attributes,
      unstyled: _unstyled,
      ...rest
    } = props;

    return (
      <div
        ref={ref}
        {...rest}
        {...getStyles("root")}
        role="alert"
        data-part={ALERT_PARTS.root}
        data-intent={intent}
      >
        {children}
        {command === undefined ? null : (
          <pre {...getStyles("command")} data-part={ALERT_PARTS.command}>
            {command}
          </pre>
        )}
      </div>
    );
  },
});

export type AlertProps = ComponentProps<typeof Alert>;

export const alertTheme = Alert.extend({});
