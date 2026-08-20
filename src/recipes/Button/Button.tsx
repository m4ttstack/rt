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

/** `src/` is browser code and may never read the node `process` global (see
    test/no-node-builtins.test.ts) — `import.meta.env.DEV` is the browser-safe
    equivalent, cast through `unknown` because this kit declares no
    `vite/client` types. Mirrors @soribashi/core's own isDev(). */
function isDev(): boolean {
  try {
    const viteEnv = (import.meta as unknown as { env?: { DEV?: boolean } }).env;
    if (viteEnv && typeof viteEnv.DEV === "boolean") return viteEnv.DEV;
  } catch {
    // import.meta access threw — fall through to the safe default.
  }
  return true;
}

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

    if (isDev() && iconOnly && !rest["aria-label"]) {
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
