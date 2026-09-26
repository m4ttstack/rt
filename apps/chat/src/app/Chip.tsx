import { forwardRef, type CSSProperties, type ReactNode } from 'react';
import { Badge } from '@mattstack/app-kit/core';

export type ChipTone = 'muted' | 'dm' | 'warn' | 'ok' | 'accent';

/** The border-wash colour per tone. `muted` is the plain hairline chip; the
    rest tint a 45%-transparent border to match their text. */
const TONE_COLOR: Record<ChipTone, string | null> = {
  muted: null,
  dm: 'var(--tk-fill-purple)',
  warn: 'var(--mantine-color-warn-text)',
  ok: 'var(--mantine-color-ok-text)',
  accent: 'var(--mantine-color-accent-text)',
};

/** The label's own text colour per tone. Only `dm` differs from
    `TONE_COLOR`: a hue's fill and its small-band text step are different
    role tokens, so a chip's border wash and its label can no longer share
    one value. Written out rather than spread from `TONE_COLOR`, so a future
    tone added there doesn't silently inherit a fill value as its text
    colour too. */
const TONE_TEXT: Record<ChipTone, string | null> = {
  muted: null,
  dm: 'var(--tk-text-purple-small)',
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
 * The app's one chip: a Mantine `Badge` at 20px tall on the ladder's meta
 * step, sm radius. Every chip -- the context labels on cards and the reader
 * strip, the inbox summary pills, the page bar's presence chips -- is this
 * component, so they read as one thing and Badge centres the label rather
 * than a hand-aligned box. Pass `onClick` to render it as a button (the
 * members chip opens its roster that way); `forwardRef` so it can be a
 * `Popover.Target`.
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
    height: 20,
    minHeight: 20,
    gap: 4,
    fontSize: 'var(--mantine-font-size-xs)',
    fontWeight: 500,
    textTransform: 'none',
    paddingLeft: 8,
    paddingRight: 8,
    borderRadius: 'var(--mantine-radius-sm)',
    border: `1px solid ${
      color
        ? `color-mix(in srgb, ${color} 45%, transparent)`
        : 'var(--tk-border-soft)'
    }`,
    color: TONE_TEXT[tone] ?? 'var(--tk-text-4)',
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
        // Badge's own label line-height drops the text low in a fixed-height
        // chip; an 18px line box (the content height inside the 1px borders)
        // centres it. `overflow: visible` lets the whole label show rather
        // than ellipsis inside a fixed Badge width.
        label: { overflow: 'visible', lineHeight: '18px' },
        section: { marginInline: 0 },
      }}
    >
      {children}
    </Badge>
  );
});
