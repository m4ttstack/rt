import { useContext } from 'react';
import { rem } from '@mantine/core';

import { MainContext, PageShellContext } from './context';

type PageShellComponentName =
  'Header' | 'Main' | 'Sidebar' | 'Content' | 'TabBar';

const fullName = (name: PageShellComponentName) => `<PageShell.${name} />`;

/**
 * Guard for sub-components: throws with an actionable message when a
 * `PageShell.*` component is rendered outside a `<PageShell />`.
 */
export const useIsInPageShell = (name: PageShellComponentName) => {
  const context = useContext(PageShellContext);
  if (!context) {
    throw new Error(
      `Component ${fullName(name)} was unable to find <PageShell /> in the tree.\n${fullName(name)} should only be used as a child of <PageShell />.`
    );
  }
};

/**
 * Guard for the sub-components that only make sense inside the main column:
 * throws when rendered outside a `<PageShell.Main />`.
 */
export const useIsInMain = (name: PageShellComponentName) => {
  const isInsideMain = useContext(MainContext);
  if (!isInsideMain) {
    throw new Error(
      `Component ${fullName(name)} was unable to find <PageShell.Main /> in the tree.\n${fullName(name)} should only be used as a child of <PageShell.Main />.`
    );
  }
};

/** The PageShell's shared state, for consumers composing their own sub-components. */
export function usePageShellContext() {
  const context = useContext(PageShellContext);
  if (context === undefined) {
    throw new Error(
      'usePageShellContext must be used within a <PageShell /> subtree'
    );
  }
  return context;
}

// Normalizes a height/offset prop into something calc() accepts: numbers go
// through Mantine's rem scaling, strings ('56px', '10vh', a var()) pass
// through untouched.
const toUnit = (value: string | number) =>
  typeof value === 'number' ? rem(value) : value;

/**
 * The height available to `PageShell.Content`: the shell's height mode
 * minus the external top offset, minus the tab bar when the root renders
 * one, minus the header when one is registered (a fixed header overlays
 * instead of stacking, so it doesn't subtract). `heightMode="auto"` opts
 * out of clamping entirely.
 */
export function usePageShellContentHeight(): string {
  const {
    headerHeight,
    hasHeader,
    hasTabBar,
    tabBarHeight,
    heightMode,
    topOffset,
    fixedHeader,
  } = usePageShellContext();

  if (heightMode === 'auto') return 'auto';

  const headerTerm = hasHeader && !fixedHeader ? headerHeight : 0;
  const tabBarTerm = hasTabBar ? tabBarHeight : 0;
  return `calc(${heightMode} - ${toUnit(topOffset)} - ${toUnit(headerTerm)} - ${toUnit(tabBarTerm)})`;
}

/**
 * The height available to `PageShell.Sidebar`: the full shell height minus
 * the external top offset and the tab bar (the tab bar spans above the
 * whole body row, sidebar included; the header runs alongside the sidebar,
 * so it never subtracts).
 */
export function usePageShellSidebarHeight(): string {
  const { heightMode, topOffset, hasTabBar, tabBarHeight } =
    usePageShellContext();

  if (heightMode === 'auto') return 'auto';

  const tabBarTerm = hasTabBar ? tabBarHeight : 0;
  return `calc(${heightMode} - ${toUnit(topOffset)} - ${toUnit(tabBarTerm)})`;
}
