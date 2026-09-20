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
 * PROVENANCE, and the procedure to repeat when regenerating: run
 * `@mantine/colors-generator`'s `generateColorsMap(seed)` for tui-kit's
 * canonical hex to get its raw 10-shade ramp and `baseColorIndex` -- the
 * generator places the seed wherever the seed's own lightness falls, which
 * is rarely the shade Mantine actually reads as primary (`primaryShade` in
 * `theme.ts`: shade 6 in light/Day, shade 4 in dark/Night). Convert the raw
 * ramp's 10 stops to OKLab, then re-anchor: piecewise-linearly warp the
 * stop positions so stop 0 stays at index 0, `baseColorIndex` moves to the
 * target index (6 or 4), and stop 9 stays at index 9, and resample the
 * OKLab curve (linear interpolation between the two nearest raw stops) at
 * the 10 new integer positions. The target index gets the seed's exact hex
 * (no round-trip error); indices 0 and 9 are copied from the raw ramp's own
 * endpoints unchanged. This keeps the ramp perceptually smooth and
 * monotonic in lightness while landing the canonical hex exactly on the
 * primary shade -- unresampled output would leave `filled`, `outline` and
 * `text` on a colour tui-kit never specified. No script in this repo
 * automates the procedure; it was run by hand against the installed
 * `@mantine/colors-generator` package.
 *
 * The consuming app's `ramp-anchors.test.ts` (packages/tokens/test) pins
 * that each canonical hex is exactly at its target index.
 */
export const tokyoRamps = {
  accentDay: [
    '#e8ecff',
    '#d7dcff',
    '#bcc5ff',
    '#9ba5ff',
    '#7585ff',
    '#5a6bff',
    '#4658ff',
    '#0b26ff',
    '#0014dd',
    '#000cb5',
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
    '#e5fff8',
    '#c1ffec',
    '#80fed6',
    '#48fec3',
    '#31feb9',
    '#20eba7',
    '#00c287',
    '#00bb82',
    '#00b57c',
    '#00ae77',
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
    '#fff5e1',
    '#ffe9cc',
    '#ffd19a',
    '#ffb864',
    '#fea337',
    '#ff951b',
    '#ff8a00',
    '#e37b00',
    '#cb6c00',
    '#b15c00',
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
    '#ffe7f3',
    '#ffd6e7',
    '#ffbdd6',
    '#ff9abf',
    '#ff77a7',
    '#ff5892',
    '#ff3d81',
    '#ff0b62',
    '#dd004c',
    '#b4003b',
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
    '#f7e9ff',
    '#ecd8ff',
    '#ddbeff',
    '#ca9bff',
    '#b678ff',
    '#a65bff',
    '#9b45ff',
    '#7e0eff',
    '#6500dd',
    '#4f00b5',
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
    '#e0feff',
    '#c4f8ff',
    '#8cedff',
    '#57e4fe',
    '#36ddfd',
    '#21d9fe',
    '#00b8d9',
    '#00afd0',
    '#00a4c3',
    '#0095b3',
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

export type TokyoRampName = keyof typeof tokyoRamps;

export const ramp = (name: TokyoRampName): MantineColorsTuple =>
  tokyoRamps[name] as unknown as MantineColorsTuple;
