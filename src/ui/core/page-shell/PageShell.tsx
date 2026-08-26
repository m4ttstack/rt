import {
  Children,
  Fragment,
  isValidElement,
  useCallback,
  useEffect,
  useState,
} from 'react';
import { Group, Stack } from '@mantine/core';
import type { BoxProps, StackProps } from '@mantine/core';

import { useIsMobile, useSchemeColors } from '@ui/hooks';
import { useRailShellHeaderHeight } from '../rail-shell/context';
import { Content } from './components/Content';
import { Header } from './components/Header';
import { Main } from './components/Main';
import { Sidebar } from './components/Sidebar';
import { PAGE_SHELL_TAB_BAR_HEIGHT, TabBar } from './components/TabBar';
import type { PageShellTab } from './components/TabBar';
import { PageShellContext } from './context';
import { useSideDrawerState } from './useSideDrawerState';

export interface PageShellProps extends Omit<StackProps, 'children' | 'title'> {
  children: React.ReactNode;
  /** Height of `PageShell.Header`, when one is rendered. @default 64 */
  headerHeight?: string | number;
  /** Open width of `PageShell.Sidebar`. @default '20vw' */
  sidebarWidth?: string | number;
  /**
   * Override for the shared surface `PageShell.Sidebar` and `PageShell.Header`
   * sit on. @default bg.level2
   */
  sideBarHeaderBg?: BoxProps['bg'];
  /**
   * Content scroll mode: `false` (default) gives the content area its own
   * capped scroll frame; `true` clamps it to a fixed, overflow-hidden
   * height for layouts that manage their own inner scrolling.
   */
  scrollClamp?: boolean;
  /**
   * localStorage key persisting the sidebar's open/collapsed state across
   * visits. Without it the state is plain component state.
   */
  drawerStateKey?: string;
  /**
   * What "full height" means for the shell's height math: the viewport
   * (`'100vh'`), the parent container (`'100%'`), or no clamping at all
   * (`'auto'`, for shells that scroll with the page body).
   * @default '100vh'
   */
  heightMode?: '100%' | '100vh' | 'auto';
  /**
   * Extra top offset to clear a fixed app-level header rendered outside
   * this component: applied as top padding on the shell and subtracted
   * from the computed content/sidebar heights.
   *
   * Inside a `RailShell` this defaults to that chrome's `headerHeight`,
   * which is the double-nav case and the only value that lines up, so
   * hosting a page under the rail needs no prop and cannot drift. Outside
   * one it defaults to 0. An explicit value always wins.
   * @default the hosting RailShell's headerHeight, else 0
   */
  topOffset?: string | number;
  /**
   * Renders the header as `position: fixed` (overlaying instead of
   * stacking, so it stops subtracting from the content height).
   * @default false
   */
  fixedHeader?: boolean;
  /**
   * Simple mode: page title for an auto-rendered `PageShell.Header`. Only
   * used when no compound children (`PageShell.Main`/`PageShell.Sidebar`)
   * are given.
   */
  title?: React.ReactNode;
  /** Simple mode: right-aligned actions for the auto-rendered header. */
  actions?: React.ReactNode;
  /** Simple mode: the `PageShell.Content` topNotch banner slot. */
  topNotch?: { content: React.ReactNode; opened: boolean };
  /**
   * Tab row rendered above the body row (sidebar included) -- page-level
   * sub-navigation between sibling views. Tabs link router-agnostically:
   * `onClick`, or `component`/`href` per `RailEntry`'s pattern (typed-router
   * caveat: AGENTS.md section 10). Works in both simple and compound mode;
   * the content/sidebar height math subtracts the bar automatically.
   */
  tabs?: PageShellTab[];
  /** Height of the tab bar when `tabs` is set. @default 46 */
  tabBarHeight?: string | number;
}

// True when `children` contains one of the compound statics, looking
// through any fragment wrappers (recursively -- a fragment of fragments
// still counts) so composition helpers that return `<><Sidebar/>...</>`
// behave the same as listing the statics inline.
function containsCompoundChild(children: React.ReactNode): boolean {
  return Children.toArray(children).some(child => {
    if (!isValidElement(child)) return false;
    if (child.type === Fragment) {
      return containsCompoundChild(
        (child.props as { children?: React.ReactNode }).children
      );
    }
    return (
      child.type === Main ||
      child.type === Sidebar ||
      child.type === Header ||
      child.type === Content
    );
  });
}

/**
 * The page-level layout primitive, as a compound component:
 *
 * ```tsx
 * <PageShell drawerStateKey="my-page-sidebar">
 *   <PageShell.Sidebar>...</PageShell.Sidebar>
 *   <PageShell.Main>
 *     <PageShell.Header title="Gear library" actions={...} />
 *     <PageShell.Content>...</PageShell.Content>
 *   </PageShell.Main>
 * </PageShell>
 * ```
 *
 * Sub-components register their presence through context so siblings adapt
 * (Main narrows for a mounted Sidebar, Content subtracts a mounted Header).
 * The sidebar collapses to a slide-away rail on desktop and an overlay
 * drawer on mobile, optionally persisting its state via `drawerStateKey`.
 *
 * The simple form still works: with no compound children, `title`/
 * `actions`/`topNotch` render the classic title-row-above-content page
 * (an auto-wrapped Main/Header/Content).
 *
 * A `tabs` prop renders a page-level tab row (`TabBar`) above the body row
 * in either mode; the height math subtracts it from both the content and
 * the sidebar.
 *
 * Layering: the shell sits on `bg.level1` (page background); sidebar and
 * header share the raised `bg.level2` surface (override via
 * `sideBarHeaderBg`); content defaults to `bg.level3`.
 */
function PageShellRoot({
  children,
  headerHeight = 64,
  tabBarHeight = PAGE_SHELL_TAB_BAR_HEIGHT,
  sidebarWidth = '20vw',
  sideBarHeaderBg,
  scrollClamp = false,
  drawerStateKey,
  heightMode = '100vh',
  topOffset,
  fixedHeader = false,
  title,
  actions,
  topNotch,
  tabs,
  style,
  ...stackProps
}: PageShellProps) {
  const isMobile = useIsMobile();
  const { bg } = useSchemeColors();

  // The rail chrome publishes the height of its fixed header, so the
  // double-nav case lines up with no prop and no shared constant to keep in
  // sync by hand. Undefined outside a RailShell, which is the standalone case.
  const railHeaderHeight = useRailShellHeaderHeight();
  const resolvedTopOffset = topOffset ?? railHeaderHeight ?? 0;

  const [sidebarOpen, setSidebarOpen] = useSideDrawerState({
    drawerStateKey,
    initialValue: !isMobile,
  });

  // Entering mobile always closes the sidebar (it becomes an overlay
  // drawer, which should never start open over the page).
  useEffect(() => {
    if (isMobile && sidebarOpen) {
      setSidebarOpen(false);
    }
    // Deliberately keyed on the mobile transition only -- re-running when
    // sidebarOpen changes would instantly re-close a drawer the user just
    // opened on mobile.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile]);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen(!sidebarOpen);
  }, [sidebarOpen, setSidebarOpen]);

  const [hasHeader, setHasHeader] = useState(false);
  const [hasSidebar, setHasSidebar] = useState(false);

  // Seeded from the root's own `tabs` prop so the built-in TabBar (rendered
  // below, gated on `tabs` directly -- not on this state, to avoid a
  // circular dependency) keeps working with zero consumer effort; the
  // built-in TabBar then registers/unregisters via `setHasTabBar` in a
  // layout effect on mount/unmount, same path a consumer's own tab row
  // uses. The two paths don't fight: only one tab bar is ever mounted for a
  // given shell, and its mount/unmount effect is the single source of
  // truth after the initial render.
  const [hasTabBar, setHasTabBar] = useState((tabs?.length ?? 0) > 0);

  // Compound mode is opted into by composing the statics as direct
  // children; otherwise the shell auto-wraps children in Main/Content
  // (plus a Header when `title`/`actions` ask for one), keeping the simple
  // page case a one-liner. Header/Content count too, so a mis-nested
  // `<PageShell.Content>` hits its own guard instead of being silently
  // double-wrapped. Fragments are looked through: `Children.toArray` does
  // NOT flatten a `<>...</>` wrapper, and without this a fragment-wrapped
  // `<PageShell.Sidebar>` would silently fall into simple mode and render
  // inside the auto-wrapped content column instead of as the sidebar.
  const isCompound = containsCompoundChild(children);

  const body = isCompound ? (
    children
  ) : (
    <Main>
      {(title != null || actions != null) && (
        <Header title={title} actions={actions} />
      )}
      <Content topNotch={topNotch}>{children}</Content>
    </Main>
  );

  return (
    <PageShellContext.Provider
      value={{
        headerHeight,
        tabBarHeight,
        hasTabBar,
        setHasTabBar,
        sidebarWidth: isMobile ? '100%' : sidebarWidth,
        toggleSidebar,
        sidebarOpen,
        bg: sideBarHeaderBg ?? bg.level2,
        scrollClamp,
        hasHeader,
        setHasHeader,
        hasSidebar,
        setHasSidebar,
        collapsedSidebar: isMobile,
        heightMode,
        topOffset: resolvedTopOffset,
        fixedHeader,
      }}
    >
      <Stack
        id="page-shell-root"
        gap={0}
        h="100%"
        w="100%"
        bg={bg.level1}
        // `contain: layout` (not `content`: paint containment would clip
        // the sidebar trigger's overhang at the root box) plus a modest
        // explicit stacking level, so edge-riding UI like the collapsed
        // sidebar trigger paints above adjacent low-z app chrome (an icon
        // rail navbar at zIndex 5) while staying under a
        // default-z fixed header (100).
        style={{
          contain: 'layout',
          position: 'relative',
          zIndex: 10,
          paddingTop: resolvedTopOffset,
          ...style,
        }}
        {...stackProps}
      >
        {(tabs?.length ?? 0) > 0 && <TabBar tabs={tabs!} />}
        <Group gap={0} align="stretch" pos="relative" flex={1} w="100%">
          {body}
        </Group>
      </Stack>
    </PageShellContext.Provider>
  );
}

// Compound statics attached via a single PURE Object.assign (top-level
// `PageShell.Sidebar = ...` mutations would pin this whole family into
// consumer bundles even when PageShell is unused).
export const PageShell = /* @__PURE__ */ Object.assign(PageShellRoot, {
  Sidebar,
  Main,
  Header,
  Content,
});
