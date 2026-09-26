import { Code, ScrollArea } from '@mattstack/app-kit/core';

/** Shared with FieldGrid's extra-property display, the same raw-JSON look
    at any size. `width`/`maxWidth` keep the value from setting its own
    box's width from content: without them a value whose lines do not wrap
    reports its natural width to every ancestor doing intrinsic sizing. */
export const BLOCK_STYLE = {
  background: 'var(--tk-inset)',
  fontSize: 12,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  width: '100%',
  maxWidth: '100%',
} as const;

// `contain` stops this ScrollArea's own box from reporting the JSON's
// natural width upward: Mantine's ScrollArea content wrapper is `min-width:
// min-content` otherwise, which widens every ancestor up to the page
// instead of the value scrolling inside its own block.
const AUTOSIZE_STYLE = {
  width: '100%',
  maxWidth: '100%',
  minWidth: 0,
  contain: 'inline-size',
} as const;

/** A stored JSON value in full: two-space indent, wrapping, scrolling
    inside a capped block so one long value never pushes the page. */
export function JsonBlock({
  value,
  maxHeight = 320,
}: {
  value: unknown;
  maxHeight?: number;
}) {
  return (
    <ScrollArea.Autosize
      mah={maxHeight}
      type="auto"
      data-testid="json-block"
      style={AUTOSIZE_STYLE}
    >
      <Code block style={BLOCK_STYLE}>
        {JSON.stringify(value, null, 2)}
      </Code>
    </ScrollArea.Autosize>
  );
}
