import { Text, Tooltip } from '@mantine/core';
import type { TooltipProps } from '@mantine/core';

import { Icon } from '@mattstack/app-kit/icons';
import type { IconName } from '@mattstack/app-kit/icons';

export interface IconTooltipProps extends Omit<TooltipProps, 'children'> {
  /** Registry icon to render as the trigger. @default 'questionCircle' */
  name?: IconName;
  /** Icon size in px. @default 18 */
  size?: number;
  /**
   * An arbitrary node to use as the trigger instead of a registry icon --
   * escape hatch for a custom glyph. Takes precedence over `name`.
   */
  icon?: React.ReactNode;
}

/**
 * A small inline icon (a `?` by default) that reveals `label` in a tooltip
 * on hover or keyboard focus -- the "hint" affordance used next to a field
 * label, a table header, or any other compact bit of UI that needs an
 * optional explanation without permanently taking up space.
 *
 * `disabled` hides the icon entirely (returns nothing), so a disabled hint
 * leaves no dangling affordance. The trigger icon color follows the
 * Tooltip's own `color` prop when set, falling back to the dimmed token.
 */
export function IconTooltip({
  name = 'questionCircle',
  size = 18,
  icon,
  ...tooltipProps
}: IconTooltipProps) {
  if (tooltipProps.disabled) return null;

  return (
    <Tooltip
      events={{ hover: true, focus: true, touch: false }}
      {...tooltipProps}
    >
      <Text
        component="span"
        c={tooltipProps.color ?? 'dimmed'}
        style={{ cursor: 'pointer', lineHeight: 0 }}
        tabIndex={0}
        aria-label="more info"
      >
        {icon ?? <Icon name={name} size={size} />}
      </Text>
    </Tooltip>
  );
}
