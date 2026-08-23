import type { MantineThemeOverride } from '@mantine/core';

import { ScopedThemeProvider } from './ScopedThemeProvider';
import type { ScopedThemeProps } from './ScopedThemeProvider';

export interface ThemeIslandProps extends ScopedThemeProps {
  /** The theme this subtree renders in, REPLACING the ancestor's rather than merging onto it. */
  theme: MantineThemeOverride;
  /**
   * Also restore the kit's `--ui-bg-*` / `--ui-text-*` ramp on the island
   * (the `.ui-base-surfaces` class in `styles/scheme-vars.css`). Pair it with
   * `theme={baseTheme}` in an app that remapped the ramp to its own role
   * ladder: the theme half and the CSS half are separate layers, and
   * restoring only one leaves the island half-branded.
   */
  baseSurfaces?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * REPLACES the theme for one subtree, scoped so nothing leaks to the rest of
 * the page. The counterpart to `ThemeOverrideWrapper`: that one adds a
 * treatment to the ancestor theme, this one swaps the theme wholesale.
 *
 * Two things want it:
 *
 * - **Getting the kit's look back.** `<ThemeIsland theme={baseTheme}
 *   baseSurfaces>` renders a dev route, embedded admin view, or print layout
 *   in the kit's defaults inside a heavily branded app. This is the case a
 *   merge-based override cannot express at all.
 * - **Fidelity previews.** A bench comparing rendered output has to show the
 *   product theme exactly as production does, even when the surrounding
 *   chrome runs on a different one.
 *
 * Unlike `ThemeOverrideWrapper` this renders a real box, since an island
 * generally wants to paint its own surface; give it `className`/`style` to
 * size it.
 *
 * If the app passes a `cssVariablesResolver` to its own `MantineProvider`,
 * pass the same one here -- a nested provider does not inherit it, and
 * without it every resolver-injected token silently reverts to Mantine's
 * stock derivation inside the island.
 */
export function ThemeIsland({
  theme,
  cssVariablesResolver,
  baseSurfaces = false,
  className,
  style,
  children,
}: ThemeIslandProps) {
  const classes = [baseSurfaces ? 'ui-base-surfaces' : null, className]
    .filter(Boolean)
    .join(' ');

  return (
    <ScopedThemeProvider
      theme={theme}
      cssVariablesResolver={cssVariablesResolver}
      className={classes || undefined}
      style={style}
    >
      {children}
    </ScopedThemeProvider>
  );
}
