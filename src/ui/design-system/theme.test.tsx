import {
  createTheme,
  MantineProvider,
  MantineThemeProvider,
  Text,
} from '@mantine/core';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { appTheme, baseTheme, theme } from '@ui/design-system';

describe('base/app theme split', () => {
  it('keeps the kit defaults reachable on baseTheme after branding', () => {
    // The whole point of the split: a brand edits `app-theme.ts`, and the
    // unbranded theme is still an importable object rather than something a
    // consumer has to transcribe back out of the kit repo.
    expect(baseTheme.primaryColor).toBe('indigo');
    expect(baseTheme.defaultRadius).toBe('md');
  });

  it('composes the app theme on top of the base theme', () => {
    // Empty by default in the kit itself, so `theme` is `baseTheme` plus
    // whatever the app added -- never less.
    expect(theme.primaryColor).toBe(appTheme.primaryColor ?? 'indigo');
    expect(theme.components).toBeDefined();
    expect(Object.keys(theme.components!)).toContain('Tooltip');
  });
});

describe('primaryShade shape', () => {
  it('is the object form, so nesting cannot collapse it to {}', () => {
    // Mantine's deepMerge recurses whenever the SOURCE value is an object,
    // without checking that the target is one too: deepMerge(7, {light,dark})
    // spreads `{...7}` to `{}`, finds isObject(7) false, and returns `{}`.
    // validateMantineTheme then reads `{}` as the object form and throws
    // "Cannot read properties of undefined (reading 'toString')".
    expect(typeof baseTheme.primaryShade).toBe('object');
  });

  it('survives an app theme nesting either primaryShade form under it', () => {
    const shapes = [
      createTheme({ primaryShade: { light: 7, dark: 4 } }),
      createTheme({ primaryShade: 5 }),
    ];

    shapes.forEach(nested => {
      expect(() =>
        render(
          <MantineProvider theme={theme}>
            <MantineThemeProvider theme={nested}>
              <Text>nested</Text>
            </MantineThemeProvider>
          </MantineProvider>
        )
      ).not.toThrow();
    });

    expect(screen.getAllByText('nested')).toHaveLength(shapes.length);
  });
});
