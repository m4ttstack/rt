import { ActionIcon, Box, Group, Stack, Tooltip } from '@mantine/core';

import { Icon } from '@mattstack/app-kit/icons';
import classes from './Rail.module.css';

export interface RailProps {
  /** Accessible name of the rail's `nav` landmark. */
  label: string;
  /** Whether the rail is showing its labeled, expanded state (pass
   * `useRailState`'s `effectiveExpanded`). */
  expanded: boolean;
  onToggleExpanded: () => void;
  /** Tooltip and collapsed-state aria-label of the expand trigger.
   * @default 'Expand navigation' */
  expandLabel?: string;
  /** Expanded-state aria-label of the trigger. @default 'Collapse navigation' */
  collapseLabel?: string;
  /**
   * Entry pinned to the rail's bottom via a flex spacer (e.g. a
   * color-scheme toggle). Pinning stretches the rail to `100dvh`, which
   * assumes the full-height alt-layout navbar `RailShell` provides.
   */
  pinBottom?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * The rail content for `RailShell`'s `rail` slot: a `nav`-semantics stack
 * of `RailEntry`s under a built-in expand/collapse trigger. The trigger is
 * desktop-only (`visibleFrom="sm"`): on mobile the rail opens already
 * expanded from the shell's header toggle, so a manual trigger would be
 * dead weight there.
 */
export function Rail({
  label,
  expanded,
  onToggleExpanded,
  expandLabel = 'Expand navigation',
  collapseLabel = 'Collapse navigation',
  pinBottom,
  children,
}: RailProps) {
  return (
    <Stack
      gap="xs"
      py="md"
      px={8}
      align="stretch"
      style={{
        overflow: 'hidden',
        // minHeight pins `pinBottom` to the viewport bottom: in the shell's
        // alt layout the rail spans the full viewport height.
        ...(pinBottom != null ? { minHeight: '100dvh' } : null),
      }}
      component="nav"
      aria-label={label}
    >
      <Group wrap="nowrap" className={classes.railEntryRow} visibleFrom="sm">
        <Tooltip
          label={expandLabel}
          disabled={expanded}
          position="right"
          offset={16}
        >
          <ActionIcon
            variant="subtle"
            size="lg"
            onClick={onToggleExpanded}
            aria-label={expanded ? collapseLabel : expandLabel}
            aria-expanded={expanded}
          >
            <Icon
              name="panelLeftOpen"
              size={18}
              className={
                expanded
                  ? `${classes.railTriggerIcon} ${classes.railTriggerIconFlipped}`
                  : classes.railTriggerIcon
              }
            />
          </ActionIcon>
        </Tooltip>
      </Group>
      {children}
      {pinBottom != null && (
        <>
          <Box flex={1} />
          {pinBottom}
        </>
      )}
    </Stack>
  );
}
