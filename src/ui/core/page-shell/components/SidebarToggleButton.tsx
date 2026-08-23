import { ActionIcon } from '@mantine/core';
import type { ActionIconProps } from '@mantine/core';

import { Icons } from '@ui/icons';

export interface SidebarToggleButtonProps extends Omit<
  ActionIconProps,
  'children'
> {
  onClick?: () => void;
  /** Lifts the button with a themed shadow (for floating over content). */
  withShadow?: boolean;
  iconSize?: number;
}

/**
 * The mobile sidebar opener: a panel icon button that Header renders inline
 * (or Content floats over itself when there is no header), shown only while
 * the sidebar is collapsed into its overlay drawer.
 */
export const SidebarToggleButton = ({
  withShadow,
  iconSize,
  ...buttonProps
}: SidebarToggleButtonProps) => (
  <ActionIcon
    variant="default"
    aria-label="Open sidebar"
    {...buttonProps}
    style={{
      boxShadow: withShadow ? 'var(--mantine-shadow-md)' : undefined,
      zIndex: 1,
      ...buttonProps.style,
    }}
  >
    <Icons.sidebar size={iconSize ?? 23} />
  </ActionIcon>
);
