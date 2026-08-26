import { Box, Stack } from '@mantine/core';
import type { BoxProps, StackProps } from '@mantine/core';
import clsx from 'clsx';

import classes from './SlideInSidebar.module.css';

export interface SlideInSidebarProps extends Omit<BoxProps, 'w'> {
  opened: boolean;
  children: React.ReactNode;
  /** The rail's open width. Required -- the collapse animates against it. */
  width: string | number;
  /**
   * Floating control (typically a toggle button) centered on the rail's
   * inner edge, riding the edge as it slides. Positioned against the rail
   * itself, so pass `pos="relative"` (or position it via a wrapper) when
   * using this slot.
   */
  trigger?: React.ReactNode;
  /**
   * Which edge of the layout the rail sits on: 'left' draws its hairline
   * (and trigger) on the right edge, 'right' mirrors both. @default 'left'
   */
  side?: 'left' | 'right';
  /**
   * Whether the hairline is drawn on the rail's inner edge. Set `false` for
   * a borderless rail. @default true
   */
  border?: boolean;
  id?: string;
}

/**
 * An in-flow collapsible rail (no overlay): animates its width between
 * `width` and 0, keeping content mounted while closed (faded out and
 * pointer-inert) so reopening is instant, with an optional floating
 * `trigger` centered on its inner edge. The collapsible-sidebar half of
 * `PageShell.Sidebar`.
 *
 * For an overlay panel that slides in over the page and closes on
 * outside-click/Escape, use Mantine's `Drawer` directly -- that behavior
 * is exactly what `Drawer` is, so the kit doesn't wrap it.
 */
export function SlideInSidebar({
  opened,
  width,
  trigger,
  children,
  side = 'left',
  border = true,
  className,
  style,
  ...boxProps
}: SlideInSidebarProps) {
  // The hairline sits on the rail's inner edge (the edge facing the page
  // content) and collapses with the rail so no stray border remains at
  // width 0. Opt out entirely with `border={false}` for a borderless rail.
  const borderSide = side === 'left' ? 'borderRight' : 'borderLeft';
  const edgeSide = side === 'left' ? 'left' : 'right';

  return (
    <Stack
      {...(boxProps as StackProps)}
      w={opened ? width : 0}
      maw={width}
      gap={0}
      className={clsx(classes.slide, className)}
      style={{
        ...(border && {
          [borderSide]: '1px solid var(--mantine-color-default-border)',
          [`${borderSide}Width`]: opened ? 1 : 0,
        }),
        ...style,
      }}
    >
      <Stack
        className={classes.slide}
        style={{ pointerEvents: opened ? 'auto' : 'none' }}
        opacity={opened ? 1 : 0}
        gap={0}
        flex={1}
      >
        {children}
      </Stack>
      {trigger && (
        <Box
          pos="absolute"
          top="50%"
          className={classes.slide}
          style={{
            [edgeSide]: opened ? width : 0,
            // Centered astride the moving edge in both states. When the
            // rail is collapsed the overhang crosses the host's own
            // boundary, so the shell layering must keep the host above any
            // adjacent chrome (see PageShell root's zIndex) or the trigger
            // gets painted behind it.
            transform:
              side === 'left'
                ? 'translate(-50%, -50%)'
                : 'translate(50%, -50%)',
            zIndex: 110,
          }}
        >
          {trigger}
        </Box>
      )}
    </Stack>
  );
}
