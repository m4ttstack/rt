import { AppShell, ScrollArea } from '@mantine/core';
import type {
  AppShellHeaderProps,
  AppShellMainProps,
  AppShellNavbarConfiguration,
  AppShellNavbarProps,
  AppShellProps,
} from '@mantine/core';

import { useSchemeColors } from '@ui/hooks';

export interface SiteShellProps extends Omit<
  AppShellProps,
  'children' | 'header' | 'navbar' | 'aside' | 'footer'
> {
  /** Rendered inside the fixed `AppShell.Header` at the top of the viewport. */
  header: React.ReactNode;
  /**
   * Height of the fixed header, in px. Content is offset by the same amount,
   * so it never renders underneath the header.
   * @default 56
   */
  headerHeight?: number;
  /**
   * Props for the `AppShell.Header` element itself, e.g. a `style` override
   * for a translucent header surface. Caller styles win over the kit's
   * defaults.
   */
  headerProps?: AppShellHeaderProps;
  /** Props for the `AppShell.Main` element wrapping `children`. */
  mainProps?: AppShellMainProps;
  /**
   * Rendered inside a fixed left `AppShell.Navbar` (a `bg.level2` surface
   * with a 1px right hairline, content scrollable). Omit it and the shell
   * renders exactly as the header-only layout.
   */
  navbar?: React.ReactNode;
  /**
   * Width of the fixed navbar, in px. Only meaningful with `navbar`.
   * @default 240
   */
  navbarWidth?: number;
  /**
   * Breakpoint below which the navbar's `collapsed.mobile` state applies
   * (Mantine `AppShell`'s own navbar breakpoint). @default 'sm'
   */
  navbarBreakpoint?: AppShellNavbarConfiguration['breakpoint'];
  /**
   * Mantine `AppShell`'s own collapsed flags, for wiring a burger/toggle:
   * `{ mobile }` collapses below `navbarBreakpoint`, `{ desktop }` above it.
   */
  navbarCollapsed?: AppShellNavbarConfiguration['collapsed'];
  /**
   * Props for the `AppShell.Navbar` element itself. Caller styles win over
   * the kit's defaults, same as `headerProps`.
   */
  navbarProps?: AppShellNavbarProps;
  children: React.ReactNode;
}

/**
 * Site-level chrome: a fixed header above scrollable page content, as a thin
 * kit-styled wrapper over Mantine's `AppShell`, with an optional fixed
 * sidebar via the `navbar` slot. The page itself keeps normal document
 * scrolling (`AppShell.Main` is offset by the header height, and by the
 * navbar width when one is given), so sticky elements and in-page anchors
 * behave as usual.
 *
 * Layering: the header is a raised `bg.level2` surface with a 1px
 * `--mantine-color-default-border` bottom hairline; the navbar (when given)
 * is the same `bg.level2` surface with the same hairline on its right edge,
 * its content wrapped in a growing scrollable section; main content sits on
 * `bg.level1` (page background) -- the same level1-page/level2-surface
 * convention as `PageShell`, and scheme-aware in both light and dark mode.
 *
 * Collapse behavior rides Mantine `AppShell`'s own navbar config:
 * `navbarBreakpoint` plus the `navbarCollapsed` flags (wire the latter to a
 * burger's state for a mobile drawer-style sidebar).
 *
 * Remaining `AppShell` props (`padding`, `zIndex`, `offsetScrollbars`, ...)
 * pass straight through. Aside/footer sections are out of scope: reach for
 * raw `AppShell` when the chrome outgrows "header + sidebar + content".
 */
export function SiteShell({
  header,
  headerHeight = 56,
  headerProps,
  mainProps,
  navbar,
  navbarWidth = 240,
  navbarBreakpoint = 'sm',
  navbarCollapsed,
  navbarProps,
  children,
  ...appShellProps
}: SiteShellProps) {
  const { bg } = useSchemeColors();

  return (
    <AppShell
      header={{ height: headerHeight }}
      // Only configure the navbar section when a navbar was actually given,
      // so the no-navbar shell renders exactly as the header-only layout
      // (no main-content offset, no empty navbar element).
      navbar={
        navbar !== undefined
          ? {
              width: navbarWidth,
              breakpoint: navbarBreakpoint,
              collapsed: navbarCollapsed,
            }
          : undefined
      }
      {...appShellProps}
    >
      {/* withBorder={false}: the kit hairline uses --mantine-color-default-border,
          not AppShell's own --app-shell-border-color, so the header edge matches
          every other default border in the kit. */}
      <AppShell.Header
        withBorder={false}
        {...headerProps}
        style={{
          backgroundColor: bg.level2,
          borderBottom: '1px solid var(--mantine-color-default-border)',
          ...headerProps?.style,
        }}
      >
        {header}
      </AppShell.Header>
      {navbar !== undefined ? (
        // Same withBorder={false} + hairline treatment as the header, on the
        // right edge. The grow section + ScrollArea is Mantine's own idiom
        // for a navbar whose content scrolls independently of the page.
        <AppShell.Navbar
          withBorder={false}
          {...navbarProps}
          style={{
            backgroundColor: bg.level2,
            borderRight: '1px solid var(--mantine-color-default-border)',
            ...navbarProps?.style,
          }}
        >
          <AppShell.Section grow component={ScrollArea}>
            {navbar}
          </AppShell.Section>
        </AppShell.Navbar>
      ) : null}
      <AppShell.Main bg={bg.level1} {...mainProps}>
        {children}
      </AppShell.Main>
    </AppShell>
  );
}
