import { useEffect } from 'react';

import { Center, Stack, Text } from '@ui/core';
import { AppChrome } from './chrome/AppChrome';
import { PageShellDemoPage } from './demo/PageShellDemoPage';
import { NotFoundPage } from './NotFoundPage';
import { usePath } from './router/navigation';
import { matchRoute } from './routes';

/** Placeholder home content: no chat feature exists yet, so the rail's
 * single Rooms entry has nothing to list. A room list replaces this in a
 * later task. */
function RoomsPlaceholder() {
  return (
    <Center mih="60dvh">
      <Stack align="center" gap={4}>
        <Text fw={600}>No rooms yet</Text>
        <Text size="sm" c="dimmed">
          The chat feature hasn&apos;t landed here yet.
        </Text>
      </Stack>
    </Center>
  );
}

/**
 * The whole app, today: the fixed rail + header chrome (`AppChrome`)
 * around the Rooms placeholder, routed by the hand-rolled history router in
 * ./router (no router dependency). The kit's full-screen PageShell demo
 * stays reachable at '/demo' -- inherited scaffold content, unrelated to
 * chat, and it bypasses the chrome entirely the same way it always has.
 */
export function App() {
  const path = usePath();
  const route = matchRoute(path);

  // Each route change starts at the top of the new page.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [path]);

  if (route.name === 'demo-page-shell') {
    return <PageShellDemoPage />;
  }

  return (
    <AppChrome>
      {route.name === 'home' ? <RoomsPlaceholder /> : <NotFoundPage />}
    </AppChrome>
  );
}
