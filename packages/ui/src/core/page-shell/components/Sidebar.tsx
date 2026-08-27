import { useLayoutEffect } from 'react';
import { ActionIcon, Drawer, Flex, ScrollArea } from '@mantine/core';
import type {
  BoxProps,
  DrawerProps,
  ScrollAreaAutosizeProps,
} from '@mantine/core';
import clsx from 'clsx';

import { Icons } from '@mattstack/app-kit/icons';
import { SlideInSidebar } from '../../slide-in-sidebar/SlideInSidebar';
import {
  useIsInPageShell,
  usePageShellContext,
  usePageShellSidebarHeight,
} from '../hooks';
import classes from '../PageShell.module.css';

export interface PageShellSidebarProps {
  /** Content, or a render prop receiving the computed available height. */
  children: React.ReactNode | ((height: string) => React.ReactNode);
  /** Surface override; defaults to the shell's shared surface (bg.level2). */
  bg?: BoxProps['bg'];
  /**
   * Extra props for the sidebar's inner ScrollArea (desktop rail only).
   *
   * The sidebar ALREADY wraps its children in a `ScrollArea.Autosize` sized
   * to the shell frame, which is invisible from the outside: the natural move
   * for a long nav list is to reach for a `ScrollArea` of your own, and that
   * produces exactly the nested-scrollbar mess the shell exists to prevent.
   * Tune the built-in one through here instead.
   */
  scrollAreaProps?: ScrollAreaAutosizeProps;
  /** Extra props for the mobile overlay drawer. */
  drawerProps?: Omit<DrawerProps, 'children' | 'opened' | 'onClose'>;
  /** Hides the floating collapse control on the rail's edge. @default false */
  hideCollapseButton?: boolean;
}

/**
 * The shell's collapsible sidebar. On desktop it renders as an inline
 * `SlideInSidebar` rail sized by the root's `sidebarWidth`, with a floating
 * collapse control whose arrow swings 180deg between open and collapsed
 * (persisting open state when the root sets `drawerStateKey`). On mobile it
 * collapses into an overlay drawer, opened from the header's (or content's
 * floating) toggle button.
 */
export const Sidebar = ({
  children,
  bg: bgProp,
  scrollAreaProps,
  drawerProps,
  hideCollapseButton = false,
}: PageShellSidebarProps) => {
  useIsInPageShell('Sidebar');

  const {
    setHasSidebar,
    sidebarWidth,
    toggleSidebar,
    sidebarOpen,
    bg,
    collapsedSidebar,
  } = usePageShellContext();

  useLayoutEffect(() => {
    // Lets sibling components know a sidebar is present (Main narrows
    // itself; the header shows its mobile opener).
    setHasSidebar(true);
    return () => {
      setHasSidebar(false);
    };
  }, [setHasSidebar]);

  const height = usePageShellSidebarHeight();

  const renderedChildren =
    typeof children === 'function' ? children(height) : children;

  if (collapsedSidebar) {
    // The mobile overlay is a plain Drawer (an overlay side panel is
    // exactly what Drawer is); SlideInSidebar is only the desktop rail.
    return (
      <Drawer
        position="left"
        opened={sidebarOpen}
        onClose={toggleSidebar}
        size="sm"
        scrollAreaComponent={ScrollArea.Autosize}
        closeButtonProps={{ 'aria-label': 'Close panel' }}
        {...drawerProps}
      >
        {renderedChildren}
      </Drawer>
    );
  }

  return (
    <SlideInSidebar
      side="left"
      pos="relative"
      id="page-shell-sidebar"
      opened={sidebarOpen}
      width={sidebarWidth}
      bg={bgProp ?? bg}
      trigger={
        !hideCollapseButton && (
          <ActionIcon
            size="lg"
            variant="default"
            onClick={toggleSidebar}
            aria-label="Toggle sidebar"
          >
            <Icons.arrowLeftToLine
              size={18}
              className={clsx(
                classes.collapseArrow,
                !sidebarOpen && classes.collapseArrowFlipped
              )}
            />
          </ActionIcon>
        )
      }
    >
      <ScrollArea.Autosize
        mah={height}
        type="auto"
        scrollbars="y"
        id="page-shell-sidebar-scrollarea"
        className={classes.sidebarScrollArea}
        {...scrollAreaProps}
      >
        <Flex
          direction="column"
          flex={1}
          mih={height}
          id="page-shell-sidebar-content"
        >
          {renderedChildren}
        </Flex>
      </ScrollArea.Autosize>
    </SlideInSidebar>
  );
};
