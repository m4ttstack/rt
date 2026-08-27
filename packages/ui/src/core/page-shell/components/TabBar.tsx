import { useLayoutEffect } from 'react';
import { Tabs } from '@mantine/core';
import type { TabsProps } from '@mantine/core';

import { Icon, type IconName } from '@mattstack/app-kit/icons';
import { useIsInPageShell, usePageShellContext } from '../hooks';
import classes from '../PageShell.module.css';

/** Tab bar height in px, the default for the root's `tabBarHeight`. */
export const PAGE_SHELL_TAB_BAR_HEIGHT = 46;

export interface PageShellTab {
  /** Stable identity for the tab. */
  id: string;
  /** Tab text (any ReactNode; a plain string is typical). */
  label: React.ReactNode;
  /**
   * Custom label node rendered instead of `label` -- for tabs needing more
   * than plain text (a badge, a truncating tooltip, ...).
   */
  labelComponent?: React.ReactNode;
  /** Optional icon rendered before the label. */
  icon?: IconName;
  /** Optional icon rendered after the label. */
  iconRight?: IconName;
  active?: boolean;
  /** Called on click (alongside any linking the tab carries). */
  onClick?: () => void;
  /**
   * Router-agnostic linking, same idea as `RailEntry`: an element type to
   * render the tab as (e.g. a router `Link`), typically paired with `href`.
   * Typed-router caveat: polymorphic passthrough types a route-literal `to`
   * loosely -- wrap through the router's `createLink()` instead of passing a
   * bare typed `Link` (AGENTS.md section 10).
   */
  component?: React.ElementType;
  href?: string;
}

export interface PageShellTabBarProps {
  tabs: PageShellTab[];
  /** Passthrough to Mantine `Tabs`' `color` (theme color for the active tab indicator). */
  color?: TabsProps['color'];
  /** Passthrough to Mantine `Tabs`' `radius`. @default 0 */
  radius?: TabsProps['radius'];
}

/**
 * The shell's tab row, rendered by the root when its `tabs` prop is set --
 * or composed directly by a consumer building their own tab row (register
 * presence into the shell's height math via
 * `usePageShellContext().setHasTabBar`, the same way this component does).
 * Spans the full shell width above the body row (sidebar included), sized
 * by the root's `tabBarHeight` and sitting on the shared shell surface
 * (context `bg`). Built on Mantine's native `Tabs`/`Tabs.Tab` (role="tablist"
 * / role="tab" come from Mantine); the active tab carries the same calm
 * primary-light tint the kit uses for other active states (`SelectableList`
 * rows, the docs sidebar), on top of Mantine's native active indicator.
 */
export const TabBar = ({ tabs, color, radius = 0 }: PageShellTabBarProps) => {
  useIsInPageShell('TabBar');

  const { tabBarHeight, bg, setHasTabBar } = usePageShellContext();

  useLayoutEffect(() => {
    // Lets other components know a tab bar is present (Content/Sidebar
    // subtract its height). A consumer composing their own tab row
    // registers into the same context state the same way.
    setHasTabBar(true);
    return () => {
      setHasTabBar(false);
    };
  }, [setHasTabBar]);

  return (
    <Tabs
      variant="default"
      value={tabs.find(tab => tab.active)?.id ?? null}
      color={color}
      radius={radius}
    >
      <Tabs.List
        id="page-shell-tab-bar"
        aria-label="Page tabs"
        h={tabBarHeight}
        px="sm"
        bg={bg}
        style={{
          flexShrink: 0,
          borderBottom: '1px solid var(--mantine-color-default-border)',
        }}
      >
        {tabs.map(tab => {
          const LinkComponent = tab.component;
          return (
            <Tabs.Tab
              key={tab.id}
              value={tab.id}
              h="100%"
              fz="sm"
              classNames={{ tab: classes.tabBarTab }}
              leftSection={tab.icon && <Icon name={tab.icon} size={16} />}
              rightSection={
                tab.iconRight && <Icon name={tab.iconRight} size={16} />
              }
              onClick={tab.onClick}
              // `component` can't take a dynamic value (the polymorphic
              // types need a static element), so per-tab linking goes
              // through Mantine's `renderRoot` escape hatch instead. `href`
              // is folded in inside the callback (rather than passed as a
              // prop to `Tabs.Tab` itself) so it stays out of the way of
              // `Tabs.Tab`'s own prop types.
              renderRoot={
                LinkComponent
                  ? rootProps => (
                      <LinkComponent {...rootProps} href={tab.href} />
                    )
                  : undefined
              }
            >
              {tab.labelComponent ?? tab.label}
            </Tabs.Tab>
          );
        })}
      </Tabs.List>
    </Tabs>
  );
};
