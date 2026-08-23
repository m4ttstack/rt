import { Box, Text } from '@mantine/core';
import type { MantineColor } from '@mantine/core';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BG_LEVEL_COLORS, theme } from '@ui/design-system';
import type { ExtendedCustomColors } from '@ui/design-system';
import { renderWithProviders } from '@ui/storybook/test-utils';

// Compile-time check that the mantine.d.ts augmentation stays in sync with
// BG_LEVEL_COLORS: every registered name must be a valid MantineColor (so
// it autocompletes on `c`/`bg`/`color` props).
const _typeCheck: MantineColor[] = Object.keys(
  BG_LEVEL_COLORS
) as (keyof typeof BG_LEVEL_COLORS)[];
void _typeCheck;

describe('bg-level theme colors', () => {
  it('registers all four levels, every shade the same scheme-aware var', () => {
    (['bg-level-1', 'bg-level-2', 'bg-level-3', 'bg-level-4'] as const).forEach(
      (name, index) => {
        const tuple = theme.colors?.[name];
        expect(tuple).toHaveLength(10);
        tuple?.forEach(shade =>
          expect(shade).toBe(`var(--ui-bg-${index + 1})`)
        );
      }
    );
    expect(Object.keys(BG_LEVEL_COLORS)).toHaveLength(4);
  });

  it('resolves as a bg style prop through the generated color variables', () => {
    renderWithProviders(
      <Box bg="bg-level-2" data-testid="surface">
        content
      </Box>
    );
    // An unshaded theme color resolves to the -filled alias, which Mantine
    // derives from the tuple's primary shade -- here (and at every shade)
    // the scheme-aware var itself. Asserted on the raw style attribute
    // (the `bg` prop maps to the `background` shorthand, and jsdom's CSS
    // parser drops var() values from the parsed style object).
    expect(screen.getByTestId('surface').getAttribute('style')).toContain(
      'background: var(--mantine-color-bg-level-2-filled)'
    );
  });

  it('resolves as a text color prop via the -text alias', () => {
    renderWithProviders(<Text c="bg-level-4">label</Text>);
    expect(screen.getByText('label').style.color).toBe(
      'var(--mantine-color-bg-level-4-text)'
    );
  });
});

// Mantine's color props end in `(string & {})`, so any string is assignable
// and a typo can never be a type error -- what the augmentation actually buys
// is autocomplete, which comes from the union's LITERAL members. Assert on
// those. `AppCustomColors` (an app's own brand names) joins the same union;
// it can't be asserted here while it is `never`, but setting it to a literal
// makes `'brandTeal' extends Literals<ExtendedCustomColors>` true.
type Literals<T> = T extends string ? (string extends T ? never : T) : never;
type Assert<T extends true> = T;

export type _surfaceSlotsAutocomplete = Assert<
  'bg-level-2' extends Literals<ExtendedCustomColors> ? true : false
>;
