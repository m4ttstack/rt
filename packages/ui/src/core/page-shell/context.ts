import { createContext } from 'react';
import type { BoxProps } from '@mantine/core';

/**
 * Everything the PageShell root decides once and its sub-components read:
 * geometry (heights, sidebar width, top offset), the shared surface color,
 * sidebar open/toggle state, and the presence flags sub-components register
 * so their siblings can adapt (e.g. `Main` narrows itself only when a
 * `Sidebar` is actually mounted).
 */
export interface PageShellContextValue {
  headerHeight: string | number;
  /** Height of the tab bar, when a tab bar is registered. */
  tabBarHeight: string | number;
  /**
   * True when a tab bar is registered into the shell's height math. The
   * root seeds this from its own `tabs` prop (so its built-in `TabBar`
   * keeps working with zero consumer effort), and the built-in `TabBar`
   * registers/unregisters via `setHasTabBar` in a layout effect on
   * mount/unmount, same as `hasHeader`/`hasSidebar`. A consumer rendering
   * their OWN tab row (instead of the root's `tabs` prop) can register it
   * into the height math the same way: call `setHasTabBar(true)` in a
   * layout effect, with a matching `setHasTabBar(false)` cleanup.
   */
  hasTabBar: boolean;
  setHasTabBar: (present: boolean) => void;
  sidebarWidth: string | number;
  toggleSidebar: () => void;
  sidebarOpen: boolean;
  /** Shared surface color for the sidebar and header (bg.level2 by default, or `sideBarHeaderBg` when set). */
  bg: BoxProps['bg'];
  scrollClamp: boolean;
  hasSidebar: boolean;
  setHasSidebar: (present: boolean) => void;
  hasHeader: boolean;
  setHasHeader: (present: boolean) => void;
  /** True when the sidebar renders as a mobile overlay drawer instead of the inline rail. */
  collapsedSidebar: boolean;
  heightMode: '100%' | '100vh' | 'auto';
  topOffset: string | number;
  fixedHeader: boolean;
  /** True when the header renders its title at row scale (see `Header`). */
  compactHeader: boolean;
}

export const PageShellContext = /* @__PURE__ */ createContext<
  PageShellContextValue | undefined
>(undefined);

/** Presence marker so Header/Content can insist on living inside <PageShell.Main />. */
export const MainContext = /* @__PURE__ */ createContext<boolean | undefined>(
  undefined
);
