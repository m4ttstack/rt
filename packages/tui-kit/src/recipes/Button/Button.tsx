import { autoVars, isDev } from "@soribashi/core";
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";
import { defineComponent } from "../../builders.ts";
import { Spinner } from "../Spinner/Spinner.tsx";
import classes from "./Button.module.css";

/** Authoring category (1 = pure styled primitive). Read off this module by
    scripts/derive.ts to build the kit's manifest; not dead code. */
export const recipeCategory = 1 as const;

const BUTTON_SELECTORS = ["root"] as const;

export const BUTTON_PARTS = { root: "button" } as const;

/** `as const` is load-bearing — see Chip.tsx's CHIP_VARIANTS note. `default`
    is first/the default variant: the panel+border box every other variant is
    a departure from. */
const BUTTON_VARIANTS = ["default", "filled", "light", "outline", "subtle"] as const;

const BUTTON_VOCABULARY_AXES = ["intent", "variant", "size"] as const;

/**
 * The three pre-existing gate-tier cells pin here, not in intent-resolver.ts
 * (spec: docs/superpowers/specs/2026-09-10-polish-port-design.md) — the
 * shared resolver feeds autoVars for every recipe, so pinning them there
 * would restyle shipped non-Button surfaces; pinning the quartet in Button's
 * own `vars` keeps every other recipe on the resolver's retune-table output.
 */
const PINNED_CELLS: Record<string, { bg?: string; color: string; hover: string; border: string }> = {
  "light|muted": {
    bg: "color-mix(in srgb, var(--fg) 8%, transparent)",
    color: "var(--fg)",
    hover: "color-mix(in srgb, var(--fg) 13%, transparent)",
    border: "transparent",
  },
  "light|accent": {
    bg: "color-mix(in srgb, var(--accent) 14%, transparent)",
    color: "var(--accent-text)",
    hover: "color-mix(in srgb, var(--accent) 22%, transparent)",
    border: "transparent",
  },
  "subtle|muted": {
    color: "var(--fg)",
    hover: "color-mix(in srgb, var(--fg) 6%, transparent)",
    border: "transparent",
  },
};

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
  // are all set — see Chip.tsx. `vars` calls autoVars itself (rather than
  // omitting the key, which is what let the builder do that automatically —
  // define-component.tsx) so it can layer in ONE extra static var: the
  // contrast-retuned `default`/`bad` text colour (Button.module.css's parity
  // anchor). The mix is built here rather than as a literal in that CSS
  // rule because the no-hardcoded-values gate flags a literal color-mix()
  // percentage even inside var()'s own expression tree — same escape hatch
  // Badge.tsx's --sb-badge-bg and Switch.tsx's --sb-switch-bg-* use.
  vars: (theme, props) => {
    const base = autoVars(theme, "Button", props as Record<string, unknown>, true);
    const pinned = PINNED_CELLS[`${props.variant}|${props.intent}`];
    return {
      root: {
        ...base.root,
        // Keep in sync with LIGHT_VARIANT_TONE_WEIGHT.bad in intent-resolver.ts.
        "--sb-button-bad-color": "color-mix(in srgb, var(--red) 80%, var(--fg))",
        ...(pinned && {
          "--button-bg": pinned.bg ?? base.root?.["--button-bg"],
          "--button-color": pinned.color,
          "--button-hover": pinned.hover,
          "--button-border": pinned.border,
        }),
      },
    };
  },
  defaults: { intent: "accent", variant: "default", size: "md" },
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
