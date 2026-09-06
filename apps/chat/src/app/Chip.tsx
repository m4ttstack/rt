import { forwardRef, type CSSProperties, type ReactNode } from 'react';
import { Badge } from '@mattstack/app-kit/core';

export type ChipTone = 'muted' | 'dm' | 'warn' | 'ok' | 'accent';

/** The one border/text colour per tone. `muted` is the plain hairline chip;
    the rest tint a 45%-transparent border to match their text. */
const TONE_COLOR: Record<ChipTone, string | null> = {
  muted: null,
  dm: 'var(--tk-purple)',
  warn: 'var(--mantine-color-warn-text)',
  ok: 'var(--mantine-color-ok-text)',
  accent: 'var(--mantine-color-accent-text)',
};

export interface ChipProps {
  children?: ReactNode;
  tone?: ChipTone;
  /** A status dot or icon, rendered before the label. */
  leftSection?: ReactNode;
  rightSection?: ReactNode;
  testId?: string;
  title?: string;
  /** Renders the chip as a `button` and wires its click (the members chip). */
  onClick?: () => void;
  ariaLabel?: string;
  /** The interactive chip's hover/open wash. */
  highlighted?: boolean;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

/**
 * The app's one chip: a Mantine `Badge` pinned to the design's compact spec
 * (16px tall, fs-4xs, sm radius). Every chip -- the context labels on cards
 * and the reader strip, the inbox summary pills, the page bar's presence
 * chips -- is this component, so they read as one thing and Badge centres the
 * label rather than a hand-aligned box. Pass `onClick` to render it as a
 * button (the members chip opens its roster that way); `forwardRef` so it can
 * be a `Popover.Target`.
 */
export const Chip = forwardRef<HTMLDivElement, ChipProps>(function Chip(
  {
    children,
    tone = 'muted',
    leftSection,
    rightSection,
    testId,
    title,
    onClick,
    ariaLabel,
    highlighted = false,
    onMouseEnter,
    onMouseLeave,
  },
  ref
) {
  const color = TONE_COLOR[tone];
  const interactive = onClick !== undefined;
  const root: CSSProperties = {
    height: 16,
    minHeight: 16,
    gap: 4,
    fontSize: 'var(--tk-fs-4xs)',
    fontWeight: 600,
    textTransform: 'none',
    paddingLeft: 6,
    paddingRight: 6,
    borderRadius: 'var(--mantine-radius-sm)',
    border: `1px solid ${
      color
        ? `color-mix(in srgb, ${color} 45%, transparent)`
        : 'var(--tk-border-soft)'
    }`,
    color: color ?? 'var(--tk-muted-text)',
    background: highlighted ? 'var(--ui-bg-4)' : 'transparent',
    cursor: interactive ? 'pointer' : undefined,
  };
  return (
    <Badge
      // Badge's ref type switches to button under `component="button"`; the
      // element is the same DOM node either way, so cast past the union.
      ref={ref as never}
      {...(interactive
        ? {
            component: 'button',
            type: 'button',
            onClick,
            'aria-label': ariaLabel,
          }
        : {})}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      data-testid={testId}
      title={title}
      leftSection={leftSection}
      rightSection={rightSection}
      styles={{
        root,
        // Badge's label ships an 18px line-height that overflows the 16px
        // chip and drops the text low; a 14px line box (the content height
        // inside the 1px borders) centres it. `overflow: visible` lets the
        // whole label show rather than ellipsis inside a fixed Badge width.
        label: { overflow: 'visible', lineHeight: '14px' },
        section: { marginInline: 0 },
      }}
    >
      {children}
    </Badge>
  );
});
