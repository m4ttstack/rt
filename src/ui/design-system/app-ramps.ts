import type { MantineColorsTuple } from '@mantine/core';

/**
 * Tokyo Day / Tokyo Night as real ten-shade ramps, one pair per hue.
 *
 * Mantine derives every variant from tuple SHADES -- `light` is shade 1 and
 * `light-color` is shade 9 in light scheme; `light` is `darken(shade 9)` and
 * `light-color` is shade 0 in dark; `filled`/`outline`/`text` are the primary
 * shade. Ten identical entries therefore collapse fill and label onto the
 * same colour, which is why a `variant="light"` Badge rendered as a solid
 * pill with invisible text until these existed.
 *
 * PROVENANCE, and the one thing to preserve when regenerating: each ramp is
 * `@mantine/colors-generator`'s output for tui-kit's canonical hex (verified
 * byte-identical to mantine.dev/colors-generator), RESAMPLED so that hex
 * lands on the shade Mantine actually reads as primary. The generator places
 * its seed wherever the seed's own lightness falls -- 5..9 across Tokyo Day,
 * 2..4 across Tokyo Night -- and Mantine reads ONE primary shade for every
 * hue, so unresampled output would leave `filled`, `outline` and `text` on a
 * colour tui-kit never specified.
 *
 * The anchors are `primaryShade` in `app-theme.ts` and must move together:
 * shade 6 in light, shade 4 in dark. `app-theme.test.ts` pins that each
 * canonical hex is exactly there.
 */
export const TOKYO_RAMPS = {
  accentDay: [
    '#e5f4ff',
    '#c7e1fd',
    '#a9cefa',
    '#8cbaf7',
    '#6ea6f3',
    '#5092ee',
    '#2e7de9',
    '#206cd2',
    '#115cbc',
    '#004ca6',
  ],
  accentNight: [
    '#e7f2ff',
    '#cbdefe',
    '#afcafd',
    '#94b6fa',
    '#7aa2f7',
    '#638ee8',
    '#4c79d9',
    '#3565ca',
    '#1d50ba',
    '#003aab',
  ],
  okDay: [
    '#f5f8f1',
    '#d9e1d1',
    '#becbb2',
    '#a3b593',
    '#899f75',
    '#708a57',
    '#587539',
    '#466227',
    '#344f14',
    '#233d00',
  ],
  okNight: [
    '#f2fce7',
    '#ddf1c9',
    '#c8e5aa',
    '#b3da8b',
    '#9ece6a',
    '#8fbf5c',
    '#7fb04d',
    '#70a13f',
    '#62922f',
    '#53841f',
  ],
  warnDay: [
    '#fcf5eb',
    '#e9ddcd',
    '#d6c6b0',
    '#c3af93',
    '#b09876',
    '#9e825a',
    '#8c6c3e',
    '#77582b',
    '#634517',
    '#4f3200',
  ],
  warnNight: [
    '#fff5e3',
    '#f8e4c5',
    '#f0d2a7',
    '#e8c188',
    '#e0af68',
    '#d09f58',
    '#c18f48',
    '#b17f37',
    '#a26f25',
    '#93600e',
  ],
  badDay: [
    '#ffe8f2',
    '#ffced9',
    '#ffb3c1',
    '#ff97aa',
    '#ff7992',
    '#fb587c',
    '#f52a65',
    '#dc1e54',
    '#c41143',
    '#ac0033',
  ],
  badNight: [
    '#ffe8ee',
    '#ffcdd5',
    '#ffb1bd',
    '#fc94a5',
    '#f7768e',
    '#e86478',
    '#d85163',
    '#c83d4e',
    '#b92739',
    '#a90023',
  ],
  purpleDay: [
    '#f6eeff',
    '#dfd2f5',
    '#c9b7eb',
    '#b49ce1',
    '#9f80d5',
    '#8b64c9',
    '#7847bd',
    '#6a3daa',
    '#5d3498',
    '#502b86',
  ],
  purpleNight: [
    '#f4ebff',
    '#e5d7fe',
    '#d7c3fc',
    '#c9affa',
    '#bb9af7',
    '#9f81e7',
    '#8468d7',
    '#6b4fc7',
    '#5433b7',
    '#4006a6',
  ],
  cyanDay: [
    '#ebfaff',
    '#c9e2ee',
    '#a7cbdc',
    '#85b4cb',
    '#629eba',
    '#3d87a8',
    '#007197',
    '#005e83',
    '#004b6f',
    '#00395c',
  ],
  cyanNight: [
    '#e1f9ff',
    '#c9efff',
    '#b1e4ff',
    '#98daff',
    '#7dcfff',
    '#68bbf0',
    '#53a8e2',
    '#3d94d3',
    '#2581c5',
    '#006eb6',
  ],
} as const satisfies Record<string, readonly string[]>;

export type TokyoRampName = keyof typeof TOKYO_RAMPS;

export const ramp = (name: TokyoRampName): MantineColorsTuple =>
  TOKYO_RAMPS[name] as unknown as MantineColorsTuple;
