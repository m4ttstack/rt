import { useId } from 'react';
import { MantineProvider, useComputedColorScheme } from '@mantine/core';
import type { CSSVariablesResolver, MantineThemeOverride } from '@mantine/core';

/** Options both subtree-theming components forward to the scoped provider. */
export interface ScopedThemeProps {
  /**
   * The app's `cssVariablesResolver`, if it has one. A nested provider does
   * NOT inherit the resolver from its parent -- it re-derives every generated
   * color variable with whatever resolver it was handed, so leaving this out
   * reverts resolver-injected values (contrast fixes, brand aliases) to
   * Mantine's stock derivation inside the subtree.
   */
  cssVariablesResolver?: CSSVariablesResolver;
  children: React.ReactNode;
}

interface ScopedThemeProviderProps extends ScopedThemeProps {
  theme: MantineThemeOverride;
  /** Extra classes for the scope element (`ThemeIsland` exposes this). */
  className?: string;
  style?: React.CSSProperties;
  /**
   * `true` keeps the scope element out of layout entirely (`display:
   * contents`), so wrapping an existing tree adds no box. Custom properties
   * still inherit through it -- inheritance follows the DOM tree, not the box
   * tree.
   */
  transparent?: boolean;
}

/**
 * A `MantineProvider` whose CSS variables land on ONE subtree instead of the
 * whole document. Shared by `ThemeOverrideWrapper` and `ThemeIsland`; not
 * exported from the kit, because the two of them are the supported ways in.
 *
 * A bare nested `MantineProvider` is wrong for a subtree in three ways, all
 * of which this fixes:
 *
 * 1. `cssVariablesSelector` defaults to `:root`, so a nested provider emits
 *    its variables GLOBALLY, later in the head than the app's. The "subtree"
 *    override silently repaints the whole page. Scoping the selector to a
 *    per-instance class is the fix, and it is why this renders an element at
 *    all.
 * 2. The scheme attribute has to sit on that same element: Mantine composes
 *    scheme blocks as `${selector}[data-mantine-color-scheme="..."]`
 *    (`convert-css-variables.ts`), so with the attribute anywhere else the
 *    light/dark half of the emitted variables never matches anything, and
 *    dark mode simply does nothing inside the subtree.
 * 3. `MantineProvider` runs `useProviderColorScheme`, which writes
 *    `data-mantine-color-scheme` to `getRootElement()` -- the DOCUMENT root
 *    by default -- seeded from its own `defaultColorScheme`, which is
 *    `'light'`. Mounting a nested provider under an app set to `'auto'` can
 *    therefore flip the entire page to light on a dark-preference machine.
 *    `forceColorScheme` pins it to what the parent already resolved and stops
 *    the second scheme manager.
 *
 * `withGlobalClasses={false}` for the same reason as (1): the global class
 * layer is document-level and the app's provider already emitted it.
 */
export function ScopedThemeProvider({
  theme,
  cssVariablesResolver,
  className,
  style,
  transparent = false,
  children,
}: ScopedThemeProviderProps) {
  // React's useId is DOM-id-safe but not CSS-identifier-safe (`«r0»` in
  // React 19, `:r0:` before it), and this value goes into a selector.
  const scope = `ui-theme-scope-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

  // Resolved, not the raw preference: `'auto'` is not a value the attribute
  // or `forceColorScheme` accept. Read synchronously so the subtree doesn't
  // paint one frame in the wrong scheme.
  const colorScheme = useComputedColorScheme('light', {
    getInitialValueInEffect: false,
  });

  return (
    <div
      className={className ? `${scope} ${className}` : scope}
      data-mantine-color-scheme={colorScheme}
      style={transparent ? { display: 'contents', ...style } : style}
    >
      <MantineProvider
        theme={theme}
        cssVariablesSelector={`.${scope}`}
        cssVariablesResolver={cssVariablesResolver}
        forceColorScheme={colorScheme}
        withGlobalClasses={false}
      >
        {children}
      </MantineProvider>
    </div>
  );
}
