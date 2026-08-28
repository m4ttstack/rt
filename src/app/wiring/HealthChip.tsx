import type { MantineColor } from '@mattstack/app-kit/core';
import { Group, Text } from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import type { WiringHealth } from './outline';

/** Only the two states a reader has to act on carry an intent color.
    `in-sync` is the quiet answer, and `unknown` is rt having said nothing --
    neither earns one. Shared by every health-facing surface (the slim row,
    the panel header, the summary strip) so a color can never drift between
    two supposedly-identical labels. */
export const HEALTH_COLOR: Partial<Record<WiringHealth, MantineColor>> = {
  'in-sync': 'ok',
  'source-newer': 'warn',
  'never-compiled': 'bad',
  orphaned: 'purple',
};

/** Every health state's label, including the two silent ones
    (`in-sync`/`unknown`) that a status BADGE never speaks for -- a chip
    states health on every line instead of leaving healthy/unmeasured rows
    blank. */
export const HEALTH_LABEL: Record<WiringHealth, string> = {
  'in-sync': 'in sync',
  'source-newer': 'source newer',
  'never-compiled': 'never compiled',
  orphaned: 'orphaned',
  unknown: 'unmeasured',
};

export interface HealthChipProps {
  health: WiringHealth;
  /** Font size/weight are parity-anchored per call site (the slim row's
      `Main.dc.html` value differs from the summary strip's `.fact` value) --
      the shared component takes them rather than picking one. */
  fz?: number | string;
  fw?: number;
  testId?: string;
}

/**
 * A colored dot beside its label for a measured health state, muted text
 * alone for `unknown` -- rt having said nothing is not the same as healthy,
 * so it earns no dot. Shared by the slim spine row, the detail panel header,
 * and the summary strip's pack-health fact, so the three never word or color
 * the same status differently.
 */
export function HealthChip({
  health,
  fz = 'sm',
  fw = 500,
  testId = 'health-badge',
}: HealthChipProps) {
  const { text } = useSchemeColors();
  const color = HEALTH_COLOR[health];
  const label = HEALTH_LABEL[health];

  if (!color) {
    return (
      <Text
        fz={fz}
        fw={fw}
        c={text.muted}
        data-testid={testId}
        style={{ flex: 'none' }}
      >
        {label}
      </Text>
    );
  }

  return (
    <Group gap={6} wrap="nowrap" data-testid={testId} style={{ flex: 'none' }}>
      <div
        aria-hidden
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          flex: 'none',
          background: text.highContrast(color),
        }}
      />
      <Text fz={fz} fw={fw} c={text.highContrast(color)}>
        {label}
      </Text>
    </Group>
  );
}
