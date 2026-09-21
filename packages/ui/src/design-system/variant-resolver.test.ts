import { DEFAULT_THEME, mergeMantineTheme } from '@mantine/core';
import { describe, expect, it } from 'vitest';

import { baseTheme } from './base-theme';
import { variantColorResolver } from './variant-resolver';

// `createTheme` (and so `baseTheme`) returns a MantineThemeOverride, not the
// full MantineTheme the resolver's input type requires; merge onto the
// default the same way MantineProvider does before resolving it.
const theme = mergeMantineTheme(DEFAULT_THEME, baseTheme);

const HUES = ['accent', 'ok', 'bad', 'warn', 'purple', 'cyan'] as const;

describe('filled labels', () => {
  it.each(HUES)('%s reads its on-fill token', hue => {
    const result = variantColorResolver({
      color: hue,
      theme,
      variant: 'filled',
    });
    expect(result.color).toBe(`var(--tk-on-fill-${hue})`);
  });

  it('a non-hue colour keeps Mantine default', () => {
    const result = variantColorResolver({
      color: 'gray',
      theme,
      variant: 'filled',
    });
    expect(result.color).toBe('var(--mantine-color-white)');
  });

  it('other variants are untouched', () => {
    const result = variantColorResolver({
      color: 'ok',
      theme,
      variant: 'light',
    });
    expect(result.color).not.toBe('var(--tk-on-fill-ok)');
  });
});
