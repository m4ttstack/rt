import { useState } from 'react';

import { Anchor, Button, Group, Text } from '@ui/core';
import { Icons } from '@ui/icons';
import { notifications, TimedRingProgress } from '@ui/notifications';
import { Link } from '../../../router/Link';
import { ComponentDoc } from '../../ComponentDoc';
import { DocSection } from '../../DocPage';
import { docsPath } from '../../docsNav';

const USAGE = [
  "import { notifications } from '@ui/notifications';",
  '',
  '// The signature use: a notification that visibly counts down to its',
  '// own dismissal -- pass countdown (ms) and the icon becomes the ring.',
  'notifications.success({',
  "  title: 'Closing in 5 seconds',",
  "  message: 'This notification carries its own countdown icon.',",
  '  countdown: 5000,',
  '});',
  '',
  '// Or standalone, with the raw component:',
  "import { TimedRingProgress } from '@ui/notifications';",
  '<TimedRingProgress duration={5000} icon={icon} onFinish={dismiss} />;',
].join('\n');

// Rows transcribed from src/ui/notifications/TimedRingProgress.tsx
// (TimedRingProgressProps).
const PROPS_ROWS = [
  {
    name: 'duration',
    type: 'number',
    note: 'Required. Total countdown length, in milliseconds. The ring fills smoothly over this span.',
  },
  {
    name: 'onFinish',
    type: '() => void',
    note: 'Required. Called once when the ring completes (guarded against StrictMode double-effects; always the latest callback identity).',
  },
  {
    name: 'icon',
    type: 'ReactNode',
    note: 'Required. Rendered in a themed circle at the center of the ring.',
  },
  {
    name: 'color?',
    type: 'MantineColor',
    note: "Ring and center color. Default 'blue'.",
  },
];

function TimedRingProgressDemo() {
  // Remount key: each run mounts a fresh countdown (the component counts
  // down once and stays complete).
  const [run, setRun] = useState(0);

  return (
    <Group gap="lg" align="center">
      <Button variant="light" onClick={() => setRun(current => current + 1)}>
        {run === 0 ? 'Start a 5s ring' : 'Restart the ring'}
      </Button>
      {run > 0 && (
        <TimedRingProgress
          key={run}
          duration={5000}
          icon={<Icons.check size={18} />}
          onFinish={() => notifications.info('Ring finished -- onFinish')}
        />
      )}
      <Button
        variant="default"
        onClick={() =>
          notifications.success({
            title: 'Closing in 5 seconds',
            message: 'A notification carrying its own countdown icon.',
            countdown: 5000,
          })
        }
      >
        Try the countdown notification
      </Button>
    </Group>
  );
}

export function TimedRingProgressPage() {
  return (
    <ComponentDoc
      title="TimedRingProgress"
      lead="A countdown ring: fills smoothly over its duration, shows an icon in a themed circle at its center, and calls onFinish once when it completes -- built to signal an auto-dismiss ('closing in Ns') rather than as a generic progress indicator."
      demoIntro="Start the inline ring and watch it fill (onFinish fires a notification when it completes), or run the real thing: a notification carrying its own countdown icon that hides itself (the countdown option on notifications.show)."
      demo={<TimedRingProgressDemo />}
      usage={USAGE}
      usageMinHeight={300}
      propsTables={[{ title: 'Props', rows: PROPS_ROWS }]}
    >
      <DocSection title="Notes">
        <Text size="sm">
          The ring counts down once per mount: it never restarts itself, so
          re-running means remounting with a fresh key (as the demo does).
          onFinish delivery is exactly-once by construction -- a ref guard
          survives React StrictMode&apos;s dev-only double-mounted effects, and
          the callback is read through a ref so a new function identity per
          render neither restarts the interval nor goes stale.
        </Text>
        <Text size="sm" c="dimmed">
          It ships from @ui/notifications because the countdown-notification
          recipe is its home use;{' '}
          <Anchor
            component={Link}
            href={docsPath('notifications')}
            size="sm"
            fw={500}
          >
            the Notifications guide
          </Anchor>{' '}
          covers the facade and the countdown option around it.
        </Text>
      </DocSection>
    </ComponentDoc>
  );
}
