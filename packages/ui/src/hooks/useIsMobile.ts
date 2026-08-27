import { px, useMantineTheme } from '@mantine/core';
import { useViewportSize } from '@mantine/hooks';

/**
 * `true` once the viewport has been measured and its width is at or below
 * the theme's `sm` breakpoint. Uses Mantine's own `useViewportSize` (no
 * extra hook library) against the theme breakpoint rather than a
 * hard-coded pixel value, so it tracks whatever the design system defines
 * as "mobile".
 *
 * `useViewportSize` reports `{ width: 0, height: 0 }` until its mount effect
 * measures `window`; the `width > 0` guard avoids treating that unmeasured
 * state as mobile.
 */
export function useIsMobile(): boolean {
  const theme = useMantineTheme();
  const { width } = useViewportSize();
  const breakpoint = Number(px(theme.breakpoints.sm));

  return width > 0 && width <= breakpoint;
}
