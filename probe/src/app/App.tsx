import { useRoute } from 'wouter';

import {
  DaemonBanner,
  MattstackShell,
  NotFoundPage,
  useDaemonHealth,
} from '@mattstack/app-kit/app';
import { Stack, Text, Title } from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import { RailLink, useHash } from '@mattstack/app-kit/router';

function Home() {
  const hash = useHash();
  return (
    <Stack p="md" data-testid="home">
      <Title order={2}>probe</Title>
      <Text c="accent">accent text</Text>
      <Icon name="probe" data-testid="probe-icon" />
      <Text data-testid="hash">{hash || '(no hash)'}</Text>
    </Stack>
  );
}

export function App({
  initialState,
}: { initialState?: { daemonReachable?: boolean } } = {}) {
  const daemon = useDaemonHealth(initialState?.daemonReachable);
  const [isHome] = useRoute('/');
  const [isAbout] = useRoute('/about');
  return (
    <MattstackShell name="probe">
      <MattstackShell.Rail>
        <RailLink icon="layers" label="Home" href="/" />
        <RailLink icon="probe" label="About" href="/about" />
      </MattstackShell.Rail>
      <DaemonBanner
        reachable={daemon.reachable}
        downSince={daemon.downSince}
        probeCount={daemon.probeCount}
        lastAnsweredAt={daemon.lastAnsweredAt}
        onProbeNow={daemon.probeNow}
      />
      {isHome ? (
        <Home />
      ) : isAbout ? (
        <Text p="md">about</Text>
      ) : (
        <NotFoundPage />
      )}
    </MattstackShell>
  );
}
