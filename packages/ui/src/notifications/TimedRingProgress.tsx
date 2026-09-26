import { useEffect, useRef, useState } from 'react';
import { Center, RingProgress, ThemeIcon } from '@mantine/core';
import type { MantineColor } from '@mantine/core';
import { useInterval } from 'react-interval-hook';

export interface TimedRingProgressProps {
  /** Total countdown length, in milliseconds. */
  duration: number;
  /** Called once, when the ring completes. */
  onFinish: () => void;
  /** Rendered in the center of the ring (inside a themed circle). */
  icon: React.ReactNode;
  /** Ring + center color. @default 'blue' */
  color?: MantineColor;
}

const SIZE = 44;
const THICKNESS = 4;

/**
 * A countdown ring that fills over `duration` ms and calls `onFinish` when
 * full, with `icon` shown in a themed circle at its center. Used as a
 * notification's icon slot to visualize an auto-dismiss countdown (see the
 * `countdown` option on `notifications.show`).
 */
export function TimedRingProgress({
  duration,
  onFinish,
  icon,
  color = 'blue',
}: TimedRingProgressProps) {
  // Fill in 400 steps over `duration` for a smooth sweep, matching the
  // 0.25%-per-tick cadence the ring was designed around.
  const [progress, setProgress] = useState(0);

  // Read `onFinish` through a ref so a new identity each render doesn't
  // restart the interval or change when the completion effect fires.
  const onFinishRef = useRef(onFinish);
  useEffect(() => {
    onFinishRef.current = onFinish;
  });

  // Exactly-once completion guard (survives StrictMode's simulated remount).
  const completedRef = useRef(false);

  const interval = useInterval(
    () => setProgress(prev => Math.min(prev + 0.25, 100)),
    duration / 400
  );

  useEffect(() => {
    if (progress < 100) return;
    if (completedRef.current) return;
    completedRef.current = true;
    interval.stop();
    onFinishRef.current();
    // `interval` is a stable controller; only reaching 100 matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress]);

  return (
    <RingProgress
      size={SIZE}
      thickness={THICKNESS}
      sections={[{ value: progress, color }]}
      label={
        <Center>
          <ThemeIcon radius="50%" color={color}>
            {icon}
          </ThemeIcon>
        </Center>
      }
    />
  );
}
