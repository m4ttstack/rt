import { forwardRef } from 'react';
import {
  ActionIcon,
  createPolymorphicComponent,
  Group,
  Text,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import type { UnstyledButtonProps } from '@mantine/core';
import clsx from 'clsx';

import { Icon, type IconName } from '@mattstack/app-kit/icons';
import classes from './Rail.module.css';

export interface RailEntryProps extends UnstyledButtonProps {
  icon: IconName;
  /** Entry label: the tooltip while slim, the slide-in text once expanded,
   * and the entry's accessible name in both states. */
  label: string;
  /** Whether the rail is expanded (pass `useRailState`'s
   * `effectiveExpanded`, same as the parent `Rail`). */
  expanded: boolean;
  active?: boolean;
  /** Renders the icon dimmed and suppresses `onClick` (button-style
   * entries; a linked entry's own navigation is not intercepted). */
  disabled?: boolean;
  onClick?: React.MouseEventHandler<HTMLElement>;
}

const RailEntryInner = /* @__PURE__ */ forwardRef<
  HTMLButtonElement,
  RailEntryProps
>(function RailEntry(
  { icon, label, expanded, active, disabled, onClick, className, ...others },
  ref
) {
  return (
    <Tooltip
      label={label}
      disabled={expanded}
      position="right"
      offset={16}
      transitionProps={{ transition: 'fade', duration: 200 }}
    >
      <UnstyledButton
        ref={ref}
        aria-label={label}
        aria-disabled={disabled || undefined}
        aria-current={active ? 'page' : undefined}
        onClick={disabled ? undefined : onClick}
        className={clsx(classes.railEntry, className)}
        {...others}
      >
        {/* Fixed icon column: entries are always left-aligned with the
              icon at the slim rail's centered x, so nothing jumps when the
              rail expands -- the always-mounted label just fades in beside
              it (see .railLabel). */}
        <Group gap="sm" wrap="nowrap" className={classes.railEntryRow}>
          <ActionIcon
            component="div"
            variant={active ? 'filled' : 'subtle'}
            size="lg"
            c={disabled && !active ? 'dimmed' : undefined}
          >
            <Icon name={icon} size={20} />
          </ActionIcon>
          <Text
            size="sm"
            className={classes.railLabel}
            data-expanded={expanded || undefined}
            aria-hidden={!expanded}
          >
            {label}
          </Text>
        </Group>
      </UnstyledButton>
    </Tooltip>
  );
});

/**
 * One mini-rail entry: icon-only with a right-side tooltip while the rail
 * is slim; icon plus a slide-in label once expanded. Plain-button by
 * default; router-agnostic linking rides Mantine's polymorphic `component`
 * prop (`<RailEntry component={Link} href="/docs" ... />`), so any router's
 * anchor works.
 *
 * Typed-router caveat: the polymorphic prop machinery types passthrough
 * props loosely, silently widening a typed router's route-literal `to` to
 * `string` -- wrap kit components with the router's `createLink()` instead
 * of relying on bare `component={Link}` (see AGENTS.md section 10, "Bring
 * your own router").
 */
export const RailEntry = /* @__PURE__ */ createPolymorphicComponent<
  'button',
  RailEntryProps
>(RailEntryInner);
