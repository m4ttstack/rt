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

/** `as const` is load-bearing — see Chip.tsx's CHIP_VARIANTS note. `solid` is
    first/default: the panel+border box every other variant is a departure
    from. */
const BUTTON_VARIANTS = ["solid", "outline", "subtle", "ghost"] as const;

const BUTTON_VOCABULARY_AXES = ["intent", "variant", "size"] as const;

/** DERIVED from Mantine's own `defaultVariantColorsResolver` (the RAW/custom-
    colour fallback branch — the one that applies to a single-shade-per-hue
    palette like Tokyo's, which has no 10-step ramp to index into), not
    tuned by eye. Mantine's real numbers: `outline` hover =
    `rgba(color, 0.05)`, `subtle` hover = `rgba(color, 0.12)` — two DIFFERENT
    alphas, not one shared value, and both IDENTICAL across light/dark (no
    scheme-conditional alpha in that fallback branch — see the task-3 report
    for the full source excerpts and the Mantine reference contrast ratios
    computed from them). Tokyo's tone tokens already vary correctly per
    scheme via `light-dark(...)` at the token layer, which is what lets one
    flat alpha work for both schemes here too. `outline`'s rest state is
    genuinely `transparent`, matching what Mantine's alpha composites
    over — `--bg` (the page), not `--panel`. */
const OUTLINE_HOVER_TINT = "5%";

/** `ghost` is transparent-at-rest with colour-on-hover — structurally
    Mantine's `subtle`, not `outline` — so it gets `subtle`'s alpha (12%),
    also over `--bg` for the same "rest is genuinely transparent" reason. */
const GHOST_HOVER_TINT = "12%";

/** `subtle` (ours) is a deliberate divergence from Mantine's `subtle`: card
    background AT REST, not transparent — so its hover reuses `ghost`'s 12%
    proportion (same variant family) but mixed over `--card`, its own actual
    rest surface, rather than over `--bg`. */
const SUBTLE_HOVER_TINT = "12%";

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
  defaults: { intent: "accent", variant: "solid", size: "md" },
  vars: (theme, props) => {
    const autoRoot = autoVars(theme, "Button", props as Record<string, unknown>, true).root ?? {};
    // `--button-color` IS the intent tone (autoVars' own resolved value, same
    // map autoVars uses) — reused rather than re-deriving it from a second
    // FAMILY lookup. `outline`/`subtle`/`ghost` all read it directly as their
    // at-rest text/border colour too (see Button.module.css).
    const tone = autoRoot["--button-color"];
    return {
      root: {
        ...autoRoot,
        ...(tone
          ? {
              "--sb-button-outline-hover-bg": `color-mix(in srgb, ${tone} ${OUTLINE_HOVER_TINT}, var(--bg))`,
              "--sb-button-ghost-hover-bg": `color-mix(in srgb, ${tone} ${GHOST_HOVER_TINT}, var(--bg))`,
              "--sb-button-subtle-hover-bg": `color-mix(in srgb, ${tone} ${SUBTLE_HOVER_TINT}, var(--card))`,
            }
          : {}),
      },
    };
  },
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
