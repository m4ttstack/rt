import { useMemo } from 'react';
import {
  ActionIcon,
  Group,
  Overlay,
  Transition,
  useMatches,
} from '@mantine/core';
import type {
  AppShellHeaderProps,
  AppShellNavbarProps,
  GroupProps,
} from '@mantine/core';

import { useIsMobile } from '@ui/hooks';
import { Icon } from '@ui/icons';
import { SiteShell } from '../site-shell/SiteShell';
import { RailShellContext } from './context';
import classes from './RailShell.module.css';

/** Mini icon rail geometry: a slim always-visible icon strip that expands
 * into a labeled drawer. The app shell animates between the two widths. */
export const RAIL_WIDTH = 68;
export const RAIL_WIDTH_EXPANDED = 260;

export interface RailShellProps {
  /** Height of the fixed chrome header, in px. */
  headerHeight: number;
  /** Extra `AppShell.Header` props (e.g. a translucent surface). The
   * shell's own mobile z-index handling wins over a caller `zIndex`. */
  headerProps?: AppShellHeaderProps;
  /** Horizontal padding of the header row. @default 'md' */
  headerPx?: GroupProps['px'];
  /** Extra `AppShell.Navbar` props for the rail (e.g. a different surface).
   * The shell's own width, z-index and shadow stay authoritative. */
  railProps?: AppShellNavbarProps;
  /** Header content, rendered after the mobile rail toggle. */
  header: React.ReactNode;
  /** Rail content riding the navbar slot (typically a `Rail` of
   * `RailEntry`s). */
  rail: React.ReactNode;
  /** Whether the rail shows its labeled, expanded width. Pass
   * `useRailState`'s `effectiveExpanded` so the mobile-open rail is the
   * labeled nav, not a bare icon strip. */
  railExpanded: boolean;
  /** Whether the mobile rail is open (no effect from `sm` up). */
  railOpened: boolean;
  onToggleRail: () => void;
  onCloseRail: () => void;
  /** Slim rail width, in px. @default RAIL_WIDTH (68) */
  railWidth?: number;
  /** Expanded rail width, in px. @default RAIL_WIDTH_EXPANDED (260) */
  railWidthExpanded?: number;
  children: React.ReactNode;
}

/**
 * The mini-icon-rail app shell: a `SiteShell` in `layout="alt"` whose navbar
 * is the rail, under a slim fixed header that carries the mobile rail
 * toggle. Compose it with `Rail`/`RailEntry` in the `rail` slot and
 * `useRailState` for the open/expand wiring; host a `PageShell` in
 * `children` (passing `headerHeight` as its `topOffset`) for the
 * double-nav geometry.
 *
 * The z-index contract (kept internal; numbers here for composing chrome):
 * the desktop navbar sits at 5, UNDER a hosted `PageShell` root (10), so
 * edge-riding page UI (the collapsed sidebar trigger) paints in front of
 * the rail; the header keeps Mantine's default 100 and stays above
 * scrolled content; the mobile click-to-close overlay is fixed at 999 with
 * header and navbar lifted to 1000 while open (Mantine renders the navbar
 * at zIndex + 1, i.e. 1001, so the open rail paints over the header's left
 * strip).
 *
 * Mobile geometry (below the shell's `sm` breakpoint): the rail keeps an
 * explicit width instead of Mantine's full-width mobile navbar default
 * (`w`/`maw` caps on the navbar override the stylesheet's 100%), and
 * callers pass `railExpanded` already forced true while mobile-open (the
 * expand-then-open move `useRailState` implements: a labeled nav, not a
 * bare icon strip, floats over the page). Opening starts the z-index dance
 * above; closing restores normal stacking. Dismissal: tap the overlay or
 * navigate from a rail entry (the header toggle sits under the open rail).
 */
export function RailShell({
  headerHeight,
  headerProps,
  headerPx = 'md',
  railProps,
  header,
  rail,
  railExpanded,
  railOpened,
  onToggleRail,
  onCloseRail,
  railWidth = RAIL_WIDTH,
  railWidthExpanded = RAIL_WIDTH_EXPANDED,
  children,
}: RailShellProps) {
  const isMobile = useIsMobile();
  const railOverlayActive = isMobile && railOpened;
  const headerZIndex = railOverlayActive ? 1000 : undefined;
  const navbarZIndex = railOverlayActive ? 1000 : 5;
  const currentRailWidth = railExpanded ? railWidthExpanded : railWidth;
  // While the rail overlays the page it needs lift; from `sm` up it is a
  // plain in-flow rail and the hairline is enough.
  const railShadow = useMatches({
    base: 'var(--mantine-shadow-md)',
    sm: 'none',
  });

  // Memoized so a hosted PageShell doesn't re-render on every rail state
  // change just because the context object is new.
  const railContext = useMemo(() => ({ headerHeight }), [headerHeight]);

  return (
    <RailShellContext.Provider value={railContext}>
      <SiteShell
        layout="alt"
        transitionDuration={200}
        headerHeight={headerHeight}
        headerProps={{ ...headerProps, zIndex: headerZIndex }}
        header={
          <Group h="100%" px={headerPx} w="100%" wrap="nowrap">
            {isMobile && (
              <ActionIcon
                variant="subtle"
                size="lg"
                onClick={onToggleRail}
                aria-label="Toggle navigation"
              >
                <Icon name="panelLeftOpen" size={20} />
              </ActionIcon>
            )}
            {header}
          </Group>
        }
        navbar={rail}
        navbarWidth={currentRailWidth}
        navbarCollapsed={{ mobile: !railOpened }}
        navbarProps={{
          ...railProps,
          zIndex: navbarZIndex,
          w: currentRailWidth,
          maw: currentRailWidth,
          className: classes.railNavbar,
          style: { ...railProps?.style, boxShadow: railShadow },
        }}
        // Hosted sections bring a PageShell whose `topOffset` clears the fixed
        // header (padding + height math in one place), so AppShell.Main must
        // not also pad for it -- that would double the offset.
        mainProps={{ style: { paddingTop: 0 } }}
      >
        {children}
        <Transition mounted={railOverlayActive}>
          {transitionStyle => (
            <Overlay
              fixed
              zIndex={999}
              backgroundOpacity={0.4}
              style={transitionStyle}
              onClick={onCloseRail}
              data-testid="rail-overlay"
            />
          )}
        </Transition>
      </SiteShell>
    </RailShellContext.Provider>
  );
}
