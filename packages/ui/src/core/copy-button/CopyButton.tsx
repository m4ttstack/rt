import { ActionIcon, Button, Tooltip } from '@mantine/core';
import type {
  ActionIconProps,
  ButtonProps,
  FloatingPosition,
} from '@mantine/core';
import { useClipboard } from '@mantine/hooks';

import { useSchemeColors } from '@mattstack/app-kit/hooks';
import { Icons } from '@mattstack/app-kit/icons';

export interface CopyActionIconProps extends Omit<ActionIconProps, 'children'> {
  /** The text written to the clipboard when clicked. */
  value: string;
  /** Tooltip label shown while hovering, before a copy happens. */
  label?: string;
  /** Tooltip label shown briefly after a successful copy. @default 'Copied!' */
  copiedLabel?: string;
  /** Tooltip position. @default 'bottom' */
  tooltipPosition?: FloatingPosition;
  /** Icon size in px. @default 16 */
  iconSize?: number;
  /** Overrides the idle (not-yet-copied) icon. */
  icon?: React.ReactNode;
  /** Called after a successful copy, in addition to the built-in feedback. */
  onCopy?: () => void;
}

/**
 * An `ActionIcon` that copies `value` to the clipboard on click and swaps
 * its icon to a checkmark for a couple of seconds as feedback (reverting on
 * its own -- see `@mantine/hooks`' `useClipboard` timeout).
 */
export function CopyActionIcon({
  value,
  label,
  copiedLabel = 'Copied!',
  tooltipPosition = 'bottom',
  iconSize = 16,
  icon,
  onCopy,
  ...actionIconProps
}: CopyActionIconProps) {
  const clipboard = useClipboard();
  const tooltipLabel = clipboard.copied ? copiedLabel : label;

  return (
    <Tooltip
      label={tooltipLabel}
      position={tooltipPosition}
      disabled={!tooltipLabel}
      withArrow
    >
      <ActionIcon
        variant="subtle"
        color="gray"
        {...actionIconProps}
        aria-label="copy to clipboard"
        onClick={event => {
          event.stopPropagation();
          clipboard.copy(value);
          onCopy?.();
        }}
      >
        {clipboard.copied ? (
          <Icons.check size={iconSize} />
        ) : (
          (icon ?? <Icons.copy size={iconSize} />)
        )}
      </ActionIcon>
    </Tooltip>
  );
}

export interface CopyButtonProps extends Omit<ButtonProps, 'children'> {
  /** The text written to the clipboard when clicked. */
  value: string;
  /** Button label. Defaults to `value` itself (handy for copyable snippets). */
  children?: React.ReactNode;
  /** Tooltip shown while the copied feedback is active. @default 'Copied!' */
  copiedLabel?: string;
  /** Tooltip position. @default 'bottom' */
  tooltipPosition?: FloatingPosition;
  /**
   * Code-chip styling: monospace label on the raised `bg.level3` surface
   * slot with normal text color -- scheme-aware through the kit tokens, no
   * per-scheme conditionals. Any explicit Button prop overrides it.
   * @default false
   */
  codeStyle?: boolean;
  /** Overrides the idle (not-yet-copied) right-section icon. */
  icon?: React.ReactNode;
  /** Icon size in px, matching CopyActionIcon's default. @default 16 */
  iconSize?: number;
  /** Called after a successful copy, in addition to the built-in feedback. */
  onCopy?: () => void;
}

/**
 * A labeled copy-to-clipboard `Button`: the label (children, defaulting to
 * `value`) with a copy icon in the right section that swaps to a checkmark
 * while the copied feedback is active (same `useClipboard`-timeout pattern
 * as `CopyActionIcon`), plus a feedback tooltip that only opens while
 * copied. For an icon-only trigger, use `CopyActionIcon` instead.
 *
 * This is a deliberate shadow of `@mantine/core`'s headless render-prop
 * `CopyButton`: importing `CopyButton` from `@mattstack/app-kit/core` gets this
 * batteries-included component (the named export wins over the star
 * re-export, exactly like `Table`/`TextInput`).
 */
export function CopyButton({
  value,
  children,
  copiedLabel = 'Copied!',
  tooltipPosition = 'bottom',
  codeStyle = false,
  icon,
  iconSize = 16,
  onCopy,
  ...buttonProps
}: CopyButtonProps) {
  const clipboard = useClipboard();
  const { bg, text } = useSchemeColors();

  const codeStyleProps: Partial<ButtonProps> = codeStyle
    ? {
        radius: 'sm',
        size: 'sm',
        ff: 'monospace',
        fw: 'normal',
        c: text.normal,
        bg: bg.level3,
      }
    : {};

  return (
    <Tooltip
      label={copiedLabel}
      position={tooltipPosition}
      opened={clipboard.copied}
      withArrow
    >
      <Button
        variant="default"
        {...codeStyleProps}
        {...buttonProps}
        rightSection={
          clipboard.copied ? (
            <Icons.check size={iconSize} />
          ) : (
            (icon ?? <Icons.copy size={iconSize} />)
          )
        }
        onClick={event => {
          event.stopPropagation();
          clipboard.copy(value);
          onCopy?.();
        }}
      >
        {children ?? value}
      </Button>
    </Tooltip>
  );
}
