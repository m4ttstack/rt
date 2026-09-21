import { defaultVariantColorsResolver } from '@mantine/core';
import type { VariantColorsResolver } from '@mantine/core';

// Mantine's own filled-label pick is a luminance test between pure white and
// pure black (or unconditionally white with autoContrast off); neither lands
// on the kit's measured per-hue pick. `gold` is absent: it has no Mantine
// colour entry, so no filled gold button exists to label.
const ON_FILL_HUES = new Set(['accent', 'ok', 'bad', 'warn', 'purple', 'cyan']);

/**
 * Mantine 9's variant-color hook. Starts from Mantine's `defaultVariantColorsResolver`
 * and overrides only the cases the kit cares about.
 *
 * Two overrides: for the `default` variant, instead of Mantine's flat gray,
 * `default` reads from the layered background scheme so it always sits one
 * level above whatever surface it's on. For the `filled` variant on a kit
 * hue, the label reads the per-hue `--tk-on-fill-<hue>` token instead of
 * Mantine's white/black pick.
 */
export const variantColorResolver: VariantColorsResolver = input => {
  const base = defaultVariantColorsResolver(input);

  if (input.variant === 'default') {
    return {
      ...base,
      background: 'var(--ui-bg-3)',
    };
  }

  if (
    input.variant === 'filled' &&
    typeof input.color === 'string' &&
    ON_FILL_HUES.has(input.color)
  ) {
    return {
      ...base,
      color: `var(--tk-on-fill-${input.color})`,
    };
  }

  return base;
};
