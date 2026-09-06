import type { ComponentProps, HTMLAttributes } from "react";
import { defineComponent } from "../../builders.ts";
import classes from "./Spinner.module.css";
import "./Spinner.keyframes.css";

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
