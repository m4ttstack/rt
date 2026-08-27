import { defaultVariantColorsResolver } from '@mantine/core';
import type { VariantColorsResolver } from '@mantine/core';

/**
 * Mantine 9's variant-color hook. Starts from Mantine's `defaultVariantColorsResolver`
 * and overrides only the cases the kit cares about.
 *
 * The one override: for the `default` variant, instead of Mantine's flat gray,
 * `default` reads from the layered background scheme so it always sits one
 * level above whatever surface it's on.
 */
export const variantColorResolver: VariantColorsResolver = input => {
  const base = defaultVariantColorsResolver(input);

  if (input.variant === 'default') {
    return {
      ...base,
      background: 'var(--ui-bg-3)',
    };
  }

  return base;
};
