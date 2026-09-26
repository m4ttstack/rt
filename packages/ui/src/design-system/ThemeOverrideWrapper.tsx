import { mergeThemeOverrides, useMantineTheme } from '@mantine/core';
import type { MantineThemeOverride } from '@mantine/core';

import { ScopedThemeProvider } from './ScopedThemeProvider';
import type { ScopedThemeProps } from './ScopedThemeProvider';

export interface ThemeOverrideWrapperProps extends ScopedThemeProps {
  /** Partial theme merged onto the ancestor provider's theme for this subtree only. */
  theme: MantineThemeOverride;
}

/**
 * ADDS a treatment to one subtree: the given partial theme is merged onto
 * whatever `MantineProvider` is already in the tree (a marketing section with
 * rounder cards, one page with a different `primaryColor`). Requires an
 * ancestor `MantineProvider` -- `useMantineTheme()` throws otherwise.
 *
 * It cannot SUBTRACT one. `mergeThemeOverrides` only merges onto the parent,
 * so an absent key inherits the parent's value and every treatment would have
 * to be individually restated to be removed. When the ask is "make this look
 * like the kit again" -- a dev route, an embedded admin view, a print layout
 * -- reach for `ThemeIsland` with `baseTheme` instead of subtracting here.
 *
 * Layout-transparent: the scope element it renders is `display: contents`, so
 * wrapping an existing tree adds no box. See `ScopedThemeProvider` for why
 * there is an element at all.
 */
export function ThemeOverrideWrapper({
  theme,
  cssVariablesResolver,
  children,
}: ThemeOverrideWrapperProps) {
  const parent = useMantineTheme();
  return (
    <ScopedThemeProvider
      theme={mergeThemeOverrides(parent, theme)}
      cssVariablesResolver={cssVariablesResolver}
      transparent
    >
      {children}
    </ScopedThemeProvider>
  );
}
