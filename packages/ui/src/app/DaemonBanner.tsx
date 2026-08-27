import { ActionIcon, Group, Stack, Text } from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import { formatElapsed } from './format-elapsed';

export interface DaemonBannerProps {
  /** The daemon's own health verdict, relayed through `/api/daemon`. Renders nothing when true. */
  reachable: boolean;
  /** When the current outage started, so the banner can show how long it has run. */
  downSince?: number;
  /** Probes attempted since the outage started. */
  probeCount?: number;
  /** The last time a probe succeeded, for the "Last answered HH:MM:SS" sentence. Omitted from the copy when unknown. */
  lastAnsweredAt?: number;
  /** Where nothing is answering, so the reader knows WHERE, not just THAT. */
  sockPath?: string;
  onProbeNow?: () => void;
  /** Injectable for tests; defaults to the real clock. */
  now?: number;
}

const DEFAULT_SOCK_PATH = '~/.mattstack/rt/rt.sock';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function formatClock(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * DaemonDown.dc.html's `.alert`: icon, title+body stack, and a trailing
 * probe-now button as three flex siblings. Built from plain primitives
 * rather than `<Alert>` -- Alert's own title/message live inside one shared
 * body slot with no room for a trailing action, so reproducing the real
 * anatomy means the plain building blocks, not the packaged component.
 *
 * `role="status"` (not Alert's default `"alert"`) is what lets this banner
 * supersede every buddy status: a screen reader announces the outage the
 * same way it would announce any other status region, without the
 * interrupting urgency of `role="alert"`.
 */
export function DaemonBanner({
  reachable,
  downSince,
  probeCount = 0,
  lastAnsweredAt,
  sockPath = DEFAULT_SOCK_PATH,
  onProbeNow,
  now = Date.now(),
}: DaemonBannerProps) {
  if (reachable) return null;

  const elapsed = formatElapsed(
    downSince !== undefined ? Math.max(now - downSince, 0) : 0
  );
  const lastAnswered =
    lastAnsweredAt !== undefined
      ? ` Last answered ${formatClock(lastAnsweredAt)}.`
      : '';

  return (
    <Group
      role="status"
      data-testid="daemon-banner"
      align="flex-start"
      wrap="nowrap"
      gap="md"
      py="md"
      px="lg"
      mb="lg"
      style={{
        borderRadius: 'var(--mantine-radius-md)',
        // The artboard's `.alert`, exactly: the danger token washed over the
        // page at the scheme's own alpha. Mantine's generic `red` light
        // surface is a different, much heavier pink -- the tokyo `bad` ramp
        // is what the design was drawn against.
        background:
          'color-mix(in srgb, var(--mantine-color-bad-text) var(--tk-wash), transparent)',
        color: 'var(--mantine-color-bad-text)',
      }}
    >
      <span style={{ flex: 'none', marginTop: 1 }}>
        <Icon name="warning" size={14} />
      </span>
      <Stack gap={1} style={{ flex: 1, minWidth: 0 }}>
        <Text size="sm" fw={600}>
          rt daemon unreachable: down {elapsed} · {probeCount} probe
          {probeCount === 1 ? '' : 's'}
        </Text>
        <Text size="xs">
          The transcript has gone quiet because nothing is answering at{' '}
          {sockPath}, not because every agent is idle. Statuses are withheld
          until it answers; counts below are last known.{lastAnswered}
        </Text>
      </Stack>
      <ActionIcon
        aria-label="Probe now"
        data-testid="daemon-banner-probe"
        variant="subtle"
        size={28}
        radius={6}
        style={{ color: 'var(--mantine-color-bad-text)' }}
        onClick={onProbeNow}
      >
        <Icon name="refresh" size={16} />
      </ActionIcon>
    </Group>
  );
}
