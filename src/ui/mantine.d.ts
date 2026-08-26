/**
 * Ambient module augmentation so Mantine's color props (`color`, `c`, `bg`,
 * ...) autocomplete and type-check the kit's custom theme colors. Arbitrary
 * CSS strings (e.g. `var(--ui-bg-2)`) still resolve -- this only adds the
 * named colors.
 *
 * `ExtendedCustomColors` (`design-system/colors.ts`) is the single source of
 * truth for the union -- it derives its custom names from `BG_LEVEL_COLORS`,
 * the same object registered as `theme.colors` in `design-system/theme.ts`,
 * so this augmentation can't drift out of sync with either.
 *
 * A repo can declare `MantineThemeColorsOverride` only once, so an app adding
 * its own brand colors declares their NAMES in
 * `design-system/app-colors.ts` -- the designated extension point -- instead
 * of editing this file. That keeps this file and `colors.ts` byte-identical
 * to the kit, so neither has to be re-merged on every sync.
 *
 * Convention: https://mantine.dev/theming/colors/ ("Colors type safety").
 */
import type { MantineColorsTuple } from '@mantine/core';

import type { ExtendedCustomColors } from './design-system/colors';

declare module '@mantine/core' {
  export interface MantineThemeColorsOverride {
    colors: Record<ExtendedCustomColors, MantineColorsTuple>;
  }
}
