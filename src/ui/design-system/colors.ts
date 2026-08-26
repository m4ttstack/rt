import type { DefaultMantineColor, MantineColorsTuple } from '@mantine/core';

import type { AppCustomColors } from './app-colors';

function isMantineColorsTuple(colors: unknown): colors is MantineColorsTuple {
  return (
    Array.isArray(colors) &&
    colors.length >= 10 &&
    colors.every(color => typeof color === 'string')
  );
}

/**
 * Converts an arbitrary shade record (e.g. a design tool's color ramp, keyed
 * by shade name/number) into the exact tuple shape Mantine's `theme.colors`
 * expects: at least 10 ordered hex/rgb strings.
 */
export function colorToMantineColorsTuple(
  shades: Record<string, string>
): MantineColorsTuple {
  const colors = Object.values(shades).slice(0, 10);

  if (!isMantineColorsTuple(colors)) {
    throw new Error(
      'Invalid color shade record: need at least 10 shades to build a MantineColorsTuple.'
    );
  }

  return colors;
}

/** A tuple whose every shade is the same value -- for CSS-var-backed colors. */
const sameVarTuple = (cssVar: string): MantineColorsTuple => [
  cssVar,
  cssVar,
  cssVar,
  cssVar,
  cssVar,
  cssVar,
  cssVar,
  cssVar,
  cssVar,
  cssVar,
];

/**
 * The four layered-background surface slots (styles/scheme-vars.css,
 * surfaced by `useSchemeColors`) registered as theme colors, so they
 * autocomplete and resolve anywhere a Mantine color prop is accepted:
 * `<Paper bg="bg-level-2" />`, `c="bg-level-4"`, `color=...`. Every shade
 * is the same CSS var reference, so any shade suffix -- and the generated
 * aliases like `-filled` (what an unshaded `bg` resolves to) and `-text`
 * (what an unshaded `c` resolves to) -- lands on the level's scheme-aware
 * color. `isLightColor` short-circuits on `var(` strings, so the tuples
 * are safe through Mantine's luminance checks.
 *
 * The names autocomplete on color props via the `MantineThemeColorsOverride`
 * augmentation in `src/ui/mantine.d.ts`, which imports `ExtendedCustomColors`
 * below -- that type derives its keys from this object, so the two can't
 * drift out of sync.
 */
export const BG_LEVEL_COLORS = {
  'bg-level-1': sameVarTuple('var(--ui-bg-1)'),
  'bg-level-2': sameVarTuple('var(--ui-bg-2)'),
  'bg-level-3': sameVarTuple('var(--ui-bg-3)'),
  'bg-level-4': sameVarTuple('var(--ui-bg-4)'),
} as const;

/**
 * The full set of color names Mantine's `color`/`c`/`bg` props accept in
 * this kit's theme: the layered-background surface slots above, every
 * built-in Mantine color, and whatever the app declares in `app-colors.ts`.
 * The single source of truth for the `MantineThemeColorsOverride`
 * augmentation in `src/ui/mantine.d.ts`, so that ambient declaration and
 * this union can't drift apart.
 */
export type ExtendedCustomColors =
  keyof typeof BG_LEVEL_COLORS | AppCustomColors | DefaultMantineColor;
