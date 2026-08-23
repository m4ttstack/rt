import type { ReactNode } from 'react';

import { Badge } from '@ui/core';
import { useSchemeColors } from '@ui/hooks';

/**
 * The spine's non-health label: a hairline outline in muted text, for the
 * facts that qualify a row without saying anything is wrong (`orchestrator`,
 * `internal`, `3 sites`, `same wiring as stage 7`).
 *
 * Deliberately NOT `variant="outline" color="gray"`. tokyo-theme.css re-points
 * `gray-3`/`gray-4` at its two BORDER weights, and Mantine's outline variant
 * reads that same ramp for its TEXT colour -- in dark scheme the label lands
 * at `--tk-border` on a `--tk-panel` surface and disappears. `default` is the
 * one variant whose three colours the theme sets explicitly.
 */
export function QuietBadge({ children }: { children: ReactNode }) {
  const { text } = useSchemeColors();
  return (
    <Badge size="xs" variant="default" c={text.muted}>
      {children}
    </Badge>
  );
}
