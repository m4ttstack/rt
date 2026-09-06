import type { ReactNode } from 'react';

import { Tooltip as MantineTooltip } from '@mattstack/app-kit/core';

/**
 * Thin wrapper over Mantine's Tooltip so call sites keep the simple
 * `<Tooltip content={...}>trigger</Tooltip>` shape used across the table, cards, and rail.
 * Mantine's Tooltip needs no provider ancestor, unlike the Radix primitive this replaces.
 */
export function Tooltip({
  content,
  children,
}: {
  content: ReactNode;
  children: ReactNode;
}) {
  return (
    <MantineTooltip
      label={content}
      multiline
      w={260}
      withArrow
      events={{ hover: true, focus: true, touch: false }}
    >
      <span
        tabIndex={0}
        style={{
          cursor: 'help',
          textDecoration: 'underline dotted',
          textUnderlineOffset: 4,
          textDecorationColor: 'var(--ui-text-dimmed)',
          outline: 'none',
        }}
      >
        {children}
      </span>
    </MantineTooltip>
  );
}
