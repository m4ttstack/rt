import { createTheme, type MantineColorsTuple } from '@mantine/core';

// Re-exported so a brand can type its own component entries exactly the way
// `base-theme.ts` does -- `themeComponents({ Button: { defaultProps: ... } })`
// is checked against Mantine's real per-component `.extend` signature, where
// a bare `components` literal is `Record<string, any>`.
export { themeComponents } from './base-theme';

/**
 * The one theme file an app is EXPECTED to edit, and the only place a
 * re-theming app needs to touch to brand the kit.
 *
 * `theme.ts` merges this ON TOP of `base-theme.ts`, so anything left out here
 * keeps the kit's default. Two things follow, and both are the reason this
 * file exists:
 *
 * 1. Syncing the kit forward stops being a 3-way merge of a file holding both
 *    kit intent and app brand. `base-theme.ts` and `theme.ts` replace cleanly;
 *    this file is never touched by a sync.
 * 2. The kit's unbranded look survives branding. `baseTheme` is still in the
 *    tree, so a dev route or embedded view can render in it (see `ThemeIsland`)
 *    instead of hand-transcribing the kit's defaults back out of the repo.
 *
 * Brand colors also need their names declared in `app-colors.ts`, which is
 * what teaches Mantine's `color`/`c`/`bg` props to autocomplete them:
 *
 * ```ts
 * export const appTheme = createTheme({
 *   primaryColor: 'brandPlum',
 *   defaultRadius: 0,
 *   colors: { brandPlum: colorToMantineColorsTuple(plumShades) },
 *   components: themeComponents({
 *     Card: { defaultProps: { withBorder: true, shadow: 'none' } },
 *   }),
 * });
 * ```
 *
 * Leave it empty when the app is happy with the kit's defaults.
 */
/**
 * Every hue is ONE scheme-aware CSS variable repeated across all ten shades,
 * not a generated ramp. tui-kit has one canonical value per colour and no
 * ramp, so deriving nine more shades would invent values parity forbids.
 * `isLightColor` short-circuits on `var(` strings, so these are safe through
 * Mantine's luminance checks -- the same trick the kit's own BG_LEVEL_COLORS
 * uses for its surface slots.
 */
const tokyo = (cssVar: string): MantineColorsTuple =>
  Array(10).fill(`var(${cssVar})`) as unknown as MantineColorsTuple;

export const appTheme = /* @__PURE__ */ createTheme({
  primaryColor: 'accent',
  primaryShade: { light: 7, dark: 7 },
  colors: {
    accent: tokyo('--tk-accent'),
    ok: tokyo('--tk-green'),
    warn: tokyo('--tk-amber'),
    bad: tokyo('--tk-red'),
    purple: tokyo('--tk-purple'),
    // Mantine built-ins re-pointed, so stray stock-colour usage inside the
    // kit's own components still lands in palette.
    blue: tokyo('--tk-accent'),
    green: tokyo('--tk-green'),
    red: tokyo('--tk-red'),
    yellow: tokyo('--tk-amber'),
    violet: tokyo('--tk-purple'),
    cyan: tokyo('--tk-cyan'),
  },
  radius: { xs: '3px', sm: '4px', md: '6px', lg: '8px', xl: '10px' },
  defaultRadius: 'md',
  // The ladder follows tui-kit's census usage frequency, not a geometric
  // progression: `md` is 0.76rem because that is the board's most-used size.
  fontSizes: {
    xs: '0.66rem',
    sm: '0.7rem',
    md: '0.76rem',
    lg: '0.85rem',
    xl: '0.92rem',
  },
  spacing: {
    xs: '0.3rem',
    sm: '0.45rem',
    md: '0.6rem',
    lg: '0.7rem',
    xl: '0.9rem',
  },
  lineHeights: { md: '1.55' },
  fontFamily: '"Tomorrow", "Noto Sans JP", monospace',
  fontFamilyMonospace: '"Tomorrow", "Noto Sans JP", monospace',
  headings: { fontFamily: '"Tomorrow", "Noto Sans JP", monospace' },
  shadows: {
    md: '0 10px 30px rgba(0, 0, 0, 0.28), 0 2px 8px rgba(0, 0, 0, 0.18)',
    lg: '0 12px 40px rgba(0, 0, 0, 0.25)',
    xl: '-6px 0 32px rgba(0, 0, 0, 0.3)',
  },
});
