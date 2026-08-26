import { createTheme, virtualColor } from '@mantine/core';

import { ramp } from './ramps';

/**
 * Tokyo Day / Tokyo Night's `MantineThemeOverride` -- the brand values a
 * mantine-kit app merges on top of its own kit-owned `baseTheme` (see the
 * consuming app's `AGENTS.md` section 4 for the three-file theme split this
 * slots into: kit `base-theme.ts`, app `app-theme.ts` re-exporting
 * `tokyoTheme` from here, kit `theme.ts` merging the two). This package
 * ships data only -- no React, no components.
 */
/**
 * Each hue is a PAIR of real ten-shade ramps joined by `virtualColor`, which
 * is what picks between them per color scheme. The concrete `*Day`/`*Night`
 * entries have to be registered as colors in their own right -- `virtualColor`
 * takes color NAMES, not tuples, and resolves them out of this same map.
 *
 * `primaryShade` is not free: it is the index the ramps were anchored on, so
 * `filled`/`outline`/`text` land on tui-kit's canonical hex exactly. Moving
 * either number without regenerating `ramps.ts` silently re-points every
 * primary surface at a shade tui-kit never specified.
 */
const virtual = (name: string, hue: string) =>
  virtualColor({ name, light: `${hue}Day`, dark: `${hue}Night` });

export const tokyoTheme = /* @__PURE__ */ createTheme({
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
    // The ladder above is tui-kit's dense scale, sized for text rows inside a
    // panel. Bordered surfaces need more room than that before their content
    // stops touching the border: `xxl` is what a row-sized card takes, `xxxl`
    // what a full panel takes.
    xxl: '1.125rem',
    xxxl: '1.5rem',
  },
  lineHeights: { md: '1.55' },
  // Both slots are the same family on purpose: tui-kit names a monospace
  // in its `sans` slot too, and the kit leads its consumers on font.
  fontFamily:
    '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontFamilyMonospace:
    '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  headings: {
    fontFamily:
      '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    // Mantine's stock ladder (h1 2.125rem … h2 1.625rem) is sized for a
    // proportional sans on a roomy page. Against this kit's dense monospace
    // body — xl tops out at 0.92rem — an unsized h2 renders ~2x the largest
    // body text and swallows its own header row. The ladder below keeps the
    // step ratios but lands the whole scale on the body's scale.
    sizes: {
      h1: { fontSize: '1.35rem', lineHeight: '1.3', fontWeight: '700' },
      h2: { fontSize: '1.1rem', lineHeight: '1.35', fontWeight: '700' },
      h3: { fontSize: '0.98rem', lineHeight: '1.4', fontWeight: '700' },
      h4: { fontSize: '0.9rem', lineHeight: '1.45', fontWeight: '600' },
      h5: { fontSize: '0.82rem', lineHeight: '1.45', fontWeight: '600' },
      h6: { fontSize: '0.76rem', lineHeight: '1.5', fontWeight: '600' },
    },
  },
  shadows: {
    md: '0 10px 30px rgba(0, 0, 0, 0.28), 0 2px 8px rgba(0, 0, 0, 0.18)',
    lg: '0 12px 40px rgba(0, 0, 0, 0.25)',
    xl: '-6px 0 32px rgba(0, 0, 0, 0.3)',
  },
});
