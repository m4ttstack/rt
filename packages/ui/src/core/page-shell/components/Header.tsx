import { useLayoutEffect } from 'react';
import { Group, Title } from '@mantine/core';
import type { GroupProps } from '@mantine/core';

import { useIsInMain, useIsInPageShell, usePageShellContext } from '../hooks';
import { RowTitle } from './RowTitle';
import { SidebarToggleButton } from './SidebarToggleButton';

export interface PageShellHeaderProps extends Omit<GroupProps, 'h' | 'title'> {
  /** Left-aligned page title, rendered as a `Title` order 2. */
  title?: React.ReactNode;
  /** Right-aligned actions cluster (buttons, toggles, ...). */
  actions?: React.ReactNode;
  /** Free-form header content, rendered between `title` and `actions`. */
  children?: React.ReactNode;
  /** Surface override; defaults to the shell's shared surface (bg.level2). */
  bg?: GroupProps['bg'];
  /** Bottom hairline. @default true */
  withBorder?: boolean;
}

/**
 * The shell's header row, sized by the root's `headerHeight` and sitting on
 * the shared shell surface. Registers its presence so `Content` can
 * subtract it from the available height, renders the mobile sidebar opener
 * when the sidebar is collapsed into a drawer, and turns `position: fixed`
 * when the root sets `fixedHeader`, and renders a row-scale title when the
 * root sets `compactHeader` -- the same title `TabBar` renders, for a page
 * whose header row should match a sibling's tab row.
 */
export const Header = ({
  title,
  actions,
  children,
  bg: bgProp,
  withBorder = true,
  style,
  ...rest
}: PageShellHeaderProps) => {
  useIsInMain('Header');
  useIsInPageShell('Header');

  const {
    headerHeight,
    bg,
    collapsedSidebar,
    setHasHeader,
    hasSidebar,
    toggleSidebar,
    fixedHeader,
    compactHeader,
  } = usePageShellContext();

  useLayoutEffect(() => {
    // Lets sibling components know a header is present (Content subtracts
    // its height; a floating sidebar toggle stands down).
    setHasHeader(true);
    return () => {
      setHasHeader(false);
    };
  }, [setHasHeader]);

  return (
    <Group
      id="page-shell-header"
      bg={bgProp ?? bg}
      h={headerHeight}
      w="100%"
      px="lg"
      wrap="nowrap"
      style={{
        borderBottom: withBorder
          ? '1px solid var(--mantine-color-default-border)'
          : undefined,
        position: fixedHeader ? 'fixed' : undefined,
        zIndex: fixedHeader ? 1 : undefined,
        ...style,
      }}
      {...rest}
    >
      {collapsedSidebar && hasSidebar && (
        <SidebarToggleButton size="lg" onClick={toggleSidebar} />
      )}
      {title != null &&
        (compactHeader ? (
          <RowTitle>{title}</RowTitle>
        ) : (
          <Title order={2}>{title}</Title>
        ))}
      {children}
      {actions != null && (
        <Group gap="sm" ml="auto" wrap="nowrap">
          {actions}
        </Group>
      )}
    </Group>
  );
};
