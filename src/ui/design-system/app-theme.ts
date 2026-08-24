import { createTheme, virtualColor } from '@mantine/core';

import { ramp } from './app-ramps';

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
 * Each hue is a PAIR of real ten-shade ramps joined by `virtualColor`, which
 * is what picks between them per color scheme. The concrete `*Day`/`*Night`
 * entries have to be registered as colors in their own right -- `virtualColor`
 * takes color NAMES, not tuples, and resolves them out of this same map.
 *
 * `primaryShade` is not free: it is the index the ramps were anchored on, so
 * `filled`/`outline`/`text` land on tui-kit's canonical hex exactly. Moving
 * either number without regenerating `app-ramps.ts` silently re-points every
 * primary surface at a shade tui-kit never specified.
 */
const virtual = (name: string, hue: string) =>
  virtualColor({ name, light: `${hue}Day`, dark: `${hue}Night` });

export const appTheme = /* @__PURE__ */ createTheme({
  primaryColor: 'accent',
  primaryShade: { light: 6, dark: 4 },
  colors: {
    accentDay: ramp('accentDay'),
    accentNight: ramp('accentNight'),
    okDay: ramp('okDay'),
    okNight: ramp('okNight'),
    warnDay: ramp('warnDay'),
    warnNight: ramp('warnNight'),
    badDay: ramp('badDay'),
    badNight: ramp('badNight'),
    purpleDay: ramp('purpleDay'),
    purpleNight: ramp('purpleNight'),
    cyanDay: ramp('cyanDay'),
    cyanNight: ramp('cyanNight'),

    accent: virtual('accent', 'accent'),
    ok: virtual('ok', 'ok'),
    warn: virtual('warn', 'warn'),
    bad: virtual('bad', 'bad'),
    purple: virtual('purple', 'purple'),
    cyan: virtual('cyan', 'cyan'),
    // Mantine built-ins re-pointed, so stray stock-colour usage inside the
    // kit's own components still lands in palette.
    blue: virtual('blue', 'accent'),
    green: virtual('green', 'ok'),
    red: virtual('red', 'bad'),
    yellow: virtual('yellow', 'warn'),
    violet: virtual('violet', 'purple'),
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
  // Both slots are the same family on purpose: tui-kit names a monospace
  // in its `sans` slot too, and the kit leads its consumers on font.
  fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontFamilyMonospace: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  headings: { fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
  shadows: {
    md: '0 10px 30px rgba(0, 0, 0, 0.28), 0 2px 8px rgba(0, 0, 0, 0.18)',
    lg: '0 12px 40px rgba(0, 0, 0, 0.25)',
    xl: '-6px 0 32px rgba(0, 0, 0, 0.3)',
  },
});
