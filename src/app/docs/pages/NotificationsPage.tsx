import { Anchor, Badge, Button, Group, Table, Text } from '@ui/core';
import { notifications } from '@ui/notifications';
import { CodeBlock } from '../../components/CodeBlock';
import { Link } from '../../router/Link';
import { DocPage, DocSection } from '../DocPage';
import { docsPath } from '../docsNav';

const SHORTHANDS_SNIPPET = [
  "import { notifications } from '@ui/notifications';",
  '',
  "notifications.success('Gear item saved');",
  "notifications.error('Checkout failed'); // sticks until dismissed",
  "notifications.warning('Heads up, check this');",
  "notifications.info('Just so you know');",
  '',
  '// Each shorthand also takes a full props object, and color/icon/autoClose',
  '// can still be overridden per call:',
  "notifications.success({ title: 'Saved', message: 'Gear item updated' });",
].join('\n');

const COUNTDOWN_SNIPPET = [
  "import { notifications } from '@ui/notifications';",
  '',
  '// countdown turns the icon into a ring that dismisses the toast when full.',
  'notifications.success({',
  "  title: 'Closing in 5 seconds',",
  "  message: 'This notification carries its own countdown icon.',",
  '  countdown: 5000,',
  '});',
].join('\n');

// Type defaults transcribed from src/ui/notifications/notifications.tsx.
const NOTIFICATION_TYPES = [
  { level: 'success', color: 'green', icon: 'check' },
  { level: 'info', color: 'blue', icon: 'info' },
  { level: 'warning', color: 'orange', icon: 'warning (triangle)' },
  { level: 'error', color: 'red', icon: 'close (x)' },
];

function trySuccess() {
  notifications.success({
    title: 'Saved',
    message: 'This is notifications.success with its level defaults.',
  });
}

function tryCountdown() {
  notifications.success({
    title: 'Closing in 5 seconds',
    message:
      'The countdown option renders a timed ring as the icon, dismissing the toast when it completes.',
    countdown: 5000,
  });
}

export function NotificationsPage() {
  return (
    <DocPage
      title="Notifications"
      lead="The @ui/notifications facade re-exports the full notifications object (show/hide/update/clean) as typed pass-throughs, and adds per-type shorthands that pick a type-appropriate icon and color. autoClose follows Mantine's provider default unless overridden."
    >
      <DocSection title="Try it live">
        <Text size="sm">
          These buttons are live docs, wired to the real facade:
        </Text>
        <Group gap="sm">
          <Button variant="light" color="green" onClick={trySuccess}>
            Try notifications.success
          </Button>
          <Button variant="light" onClick={tryCountdown}>
            Try a countdown notification
          </Button>
        </Group>
      </DocSection>

      <DocSection title="Per-level shorthands">
        <CodeBlock code={SHORTHANDS_SNIPPET} language="tsx" minHeight={236} />
        <Table.ScrollContainer minWidth={420}>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Type</Table.Th>
                <Table.Th>Color</Table.Th>
                <Table.Th>Icon</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {NOTIFICATION_TYPES.map(({ level, color, icon }) => (
                <Table.Tr key={level}>
                  <Table.Td>
                    <Text size="sm" ff="monospace">
                      {level}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge color={color} variant="light" size="sm">
                      {color}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{icon}</Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        <Text size="xs" c="dimmed">
          Each shorthand also takes a plain string (used as the message) or a
          full props object; color, icon, and autoClose can all be overridden
          per call.
        </Text>
      </DocSection>

      <DocSection title="Countdown notifications: TimedRingProgress">
        <Text size="sm">
          Pass a countdown (ms) to any notification and its icon becomes a timed
          ring that dismisses the toast when it completes -- backed by
          TimedRingProgress (also exported from @ui/notifications for standalone
          use, taking duration/onFinish/icon/color).
        </Text>
        <CodeBlock code={COUNTDOWN_SNIPPET} language="tsx" minHeight={256} />
        <Text size="sm" c="dimmed">
          <Anchor
            component={Link}
            href={docsPath('components/timed-ring-progress')}
            size="sm"
            fw={500}
          >
            TimedRingProgress&apos;s reference page
          </Anchor>{' '}
          has the props table, the exactly-once onComplete contract, and a live
          inline ring.
        </Text>
      </DocSection>
    </DocPage>
  );
}
