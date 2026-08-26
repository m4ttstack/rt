import { Button, Stack, Text, Title } from '@mantine/core';
import type { ButtonProps, StackProps } from '@mantine/core';

export interface GenericErrorProps extends Omit<
  StackProps,
  'children' | 'title'
> {
  /** Optional heading above the message. */
  title?: React.ReactNode;
  /** Explanation shown under the illustration. @default 'Something went wrong.' */
  message?: React.ReactNode;
  /**
   * An action button under the message. `text` is the label; the rest are
   * `ButtonProps` (variant, color, ...). Omit to show no button.
   */
  actionButton?: ButtonProps & {
    text: React.ReactNode;
    onClick: () => void;
  };
  /**
   * Shortcut for the common "Try again" action: shows a light button with
   * that label calling this. Ignored when `actionButton` is provided.
   */
  onRetry?: () => void;
}

/**
 * A neutral placeholder for "this section failed to load" -- an inline,
 * hand-drawn illustration (a cracked pane) plus an optional title, a
 * message, and an optional action button (either the arbitrary
 * `actionButton`, or the `onRetry` "Try again" shortcut). Remaining props
 * (`className`/`style`/spacing/...) pass through to the root `Stack`.
 */
export function GenericError({
  title,
  message = 'Something went wrong.',
  actionButton,
  onRetry,
  ...stackProps
}: GenericErrorProps) {
  const { text: actionText, ...actionButtonProps } = actionButton ?? {};

  return (
    <Stack
      align="center"
      gap="sm"
      py="xl"
      data-testid="generic-error"
      {...stackProps}
    >
      <GenericErrorIllustration />
      {title && (
        <Title order={3} ta="center">
          {title}
        </Title>
      )}
      <Text c="dimmed" size="sm" ta="center" maw={320}>
        {message}
      </Text>
      {actionButton ? (
        <Button variant="light" size="sm" {...actionButtonProps}>
          {actionText}
        </Button>
      ) : (
        onRetry && (
          <Button variant="light" size="sm" onClick={onRetry}>
            Try again
          </Button>
        )
      )}
    </Stack>
  );
}

// A simple abstract "cracked pane" -- a rounded square split by a jagged
// line, with a couple of loose fragments -- drawn fresh for this kit. The
// panel itself uses the layered `--ui-bg-*` surface scale and Mantine's
// `--mantine-color-default-border` (both of which are re-pointed per
// color-scheme by `scheme-vars.css`/Mantine core), and the crack/fragments
// use `currentColor` so they pick up the dimmed text color from the
// wrapping `Text c="dimmed"` -- every stroke/fill here genuinely flips with
// the color scheme, rather than only "adapting" in one of the two schemes.
function GenericErrorIllustration() {
  return (
    <Text c="dimmed" component="span">
      <svg
        width={96}
        height={96}
        viewBox="0 0 96 96"
        fill="none"
        aria-hidden="true"
        role="presentation"
      >
        <rect
          x={10}
          y={10}
          width={76}
          height={76}
          rx={16}
          fill="var(--ui-bg-3)"
          stroke="var(--mantine-color-default-border)"
          strokeWidth={2}
        />
        <path
          d="M40 14 L52 34 L42 40 L58 58 L48 66 L60 82"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <circle cx={70} cy={28} r={4} fill="currentColor" />
        <circle cx={24} cy={68} r={3} fill="currentColor" />
      </svg>
    </Text>
  );
}
