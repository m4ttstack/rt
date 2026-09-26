import { Box, Group, Stack } from '@mantine/core';
import type { BoxProps, GroupProps, StackProps } from '@mantine/core';
import { useHover } from '@mantine/hooks';

export interface HoverBoxProps extends Omit<BoxProps, 'children'> {
  /** Render prop receiving the wrapper's current hovered state. */
  children: (hovered: boolean) => React.ReactNode;
}

export interface HoverStackProps extends Omit<StackProps, 'children'> {
  /** Render prop receiving the wrapper's current hovered state. */
  children: (hovered: boolean) => React.ReactNode;
}

export interface HoverGroupProps extends Omit<GroupProps, 'children'> {
  /** Render prop receiving the wrapper's current hovered state. */
  children: (hovered: boolean) => React.ReactNode;
}

/**
 * Show-on-hover containers: each tracks its own hovered state (via
 * `@mantine/hooks`' `useHover`) and hands it to a render-prop `children`,
 * so the caller decides what to reveal/hide (a row's action icons, a
 * secondary line of text, etc.) instead of the wrapper guessing.
 *
 * Three flavors -- `Box`/`Stack`/`Group` -- so the wrapper itself can also
 * be the layout container, matching whichever of those three the content
 * needs.
 */
export function HoverBox({ children, ...props }: HoverBoxProps) {
  const { ref, hovered } = useHover<HTMLDivElement>();

  return (
    <Box ref={ref} {...props}>
      {children(hovered)}
    </Box>
  );
}

export function HoverStack({ children, ...props }: HoverStackProps) {
  const { ref, hovered } = useHover<HTMLDivElement>();

  return (
    <Stack ref={ref} {...props}>
      {children(hovered)}
    </Stack>
  );
}

export function HoverGroup({ children, ...props }: HoverGroupProps) {
  const { ref, hovered } = useHover<HTMLDivElement>();

  return (
    <Group ref={ref} {...props}>
      {children(hovered)}
    </Group>
  );
}
