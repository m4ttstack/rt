import type { MantineColor } from '@mattstack/app-kit/core';
import { Group } from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';

const STAGE_STATUS_COLOR: Record<string, MantineColor> = {
  done: 'ok',
  failed: 'bad',
  running: 'accent',
};

/** A segment's fill. Exported so the row and its tests agree on the ramp
    shade without repeating the CSS. */
export const segmentColor = (color: MantineColor) =>
  `light-dark(var(--mantine-color-${color}-6), var(--mantine-color-${color}-4))`;

export interface StageSummary {
  name: string;
  status: string;
}

export interface StageProgressProps {
  stages?: StageSummary[];
}

export function StageProgress({ stages }: StageProgressProps) {
  const { border } = useSchemeColors();
  if (!stages || stages.length === 0) return null;

  return (
    <Group gap={4} wrap="nowrap" data-testid="stage-progress">
      {stages.map((stage, i) => {
        const color = STAGE_STATUS_COLOR[stage.status];
        return (
          <div
            key={`${stage.name}-${i}`}
            data-status={stage.status}
            style={{
              width: 26,
              height: 4,
              borderRadius: 2,
              // Mid-ramp, not `highContrast`: at 4px tall the deepest shade
              // reads as one dark bar and the running stage stops being
              // distinguishable from the done ones beside it.
              backgroundColor: color ? segmentColor(color) : border.default,
            }}
          />
        );
      })}
    </Group>
  );
}
