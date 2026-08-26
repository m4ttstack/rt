import type { MantineColor } from '@mantine/core';

/**
 * Layered background, text, and border tokens keyed off the CSS vars in
 * `@ui/styles/scheme-vars.css`. `staticSchemeColors` is the plain object
 * form, usable anywhere (module scope, non-React code); `useSchemeColors`
 * is the hook form for components. Both return the same map: every value
 * is a CSS expression that resolves per color-scheme on its own -- the
 * fixed tokens through the `--ui-*` vars, the color-taking helpers through
 * the CSS `light-dark()` function (Mantine sets `color-scheme` from its own
 * scheme attribute, so `light-dark()` follows it). No React state is needed
 * to pick between light and dark.
 */

/** Per-scheme border color for a theme color: quiet in light, deep in dark. */
const borderColor = (color: MantineColor) =>
  `light-dark(var(--mantine-color-${color}-2), var(--mantine-color-${color}-8))`;

export const staticSchemeColors = {
  bg: {
    /** The page itself. */
    level1: 'var(--ui-bg-1)',
    /** The default surface on the page (cards, panels). */
    level2: 'var(--ui-bg-2)',
    /** A surface nested inside level2 (wells, content areas). */
    level3: 'var(--ui-bg-3)',
    /** The contrast/accent surface (table headers, hover/active). */
    level4: 'var(--ui-bg-4)',
    /** Pure white in light, pure black in dark -- maximum contrast against the page. */
    monochrome: 'light-dark(#fff, #000)',
    /**
     * A theme color's tinted surface -- the same fill Alert/Badge use for
     * their `light` variant.
     */
    color: (color: MantineColor) => `var(--mantine-color-${color}-light)`,
    /**
     * A softer take on `color()`: in light schemes the color's lightest
     * shade mixed further toward white by `alpha`; in dark, the standard
     * light-variant fill (already subtle against a dark page).
     */
    lightened: (color: MantineColor, alpha = 0.6) =>
      `light-dark(color-mix(in srgb, var(--mantine-color-${color}-0), #fff ${alpha * 100}%), var(--mantine-color-${color}-light))`,
  },
  text: {
    /** The default body text color. */
    normal: 'var(--mantine-color-text)',
    /** Secondary text. */
    muted: 'var(--ui-text-muted)',
    /** Near-body text that still reads a shade off the default. */
    gray: 'var(--ui-text-gray)',
    /** The most subdued step (used by `useHoverableTextStyle`'s underline). */
    dimmed: 'var(--ui-text-dimmed)',
    /**
     * A theme color at its most legible end for text: the deepest shade in
     * light schemes, the lightest in dark.
     */
    highContrast: (color: MantineColor) =>
      `light-dark(var(--mantine-color-${color}-9), var(--mantine-color-${color}-1))`,
  },
  border: {
    /** The default hairline (Mantine's own default border token). */
    default: 'var(--mantine-color-default-border)',
    /** A theme color as a border color, per scheme. */
    color: borderColor,
    /** A ready-to-use `border` shorthand in a theme color. */
    style: (color: MantineColor, width = 1, borderStyle = 'solid') =>
      `${width}px ${borderStyle} ${borderColor(color)}`,
  },
} as const;

export const useSchemeColors = () => staticSchemeColors;
