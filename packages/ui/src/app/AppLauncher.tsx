import { useMemo } from 'react';
import {
  ActionIcon,
  Anchor,
  Box,
  Image,
  Popover,
  SimpleGrid,
  Stack,
  Text,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { Icon } from '@mattstack/app-kit/icons';

import { deriveDeckBase } from './deck-discovery';
import type { DiscoveryApp } from './deck-discovery';
import { MattstackMark } from './MattstackMark';
import { useDiscoveryApps } from './useDiscoveryApps';

export interface AppLauncherProps {
  /** This app's deck registry name, to mark/sort "you are here". */
  currentApp?: string;
  /** Override the derived deck base URL (dev, custom domain). */
  deckBase?: string;
}

function sortApps(apps: DiscoveryApp[], currentApp?: string) {
  return [...apps].sort((a, b) => {
    if (currentApp) {
      if (a.name === currentApp) return -1;
      if (b.name === currentApp) return 1;
    }
    return a.displayName.localeCompare(b.displayName);
  });
}

function Tile({ app, current }: { app: DiscoveryApp; current: boolean }) {
  return (
    <Anchor
      href={app.url}
      underline="never"
      data-current={current}
      aria-label={app.displayName}
    >
      <Stack align="center" gap={4} p="xs">
        {app.icon ? (
          <Image src={app.icon} w={40} h={40} alt="" />
        ) : (
          <MattstackMark size={40} decorative />
        )}
        {current && (
          <Box data-testid="current-app-marker" c="var(--mantine-primary-color-filled)">
            <Icon name="check" size={14} />
          </Box>
        )}
        <Text size="xs" ta="center" lh={1.1}>
          {app.displayName}
        </Text>
      </Stack>
    </Anchor>
  );
}

/**
 * The shared cross-app switcher. Renders nothing when no deck base resolves
 * (an unrecognized origin with no `deckBase` override), so a non-mattstack
 * surface simply has no launcher rather than a dead button.
 */
export function AppLauncher({ currentApp, deckBase }: AppLauncherProps) {
  // Read bare `location` (not `window.location`) so a test can control the
  // origin with `vi.stubGlobal('location', ...)`; jsdom's default origin is
  // `localhost`, which would otherwise always resolve a base.
  const origin = typeof location === 'undefined' ? '' : location.origin;
  const base = deriveDeckBase(origin, deckBase);
  const { apps, loaded, refresh } = useDiscoveryApps(base);
  const [opened, handlers] = useDisclosure(false);
  const ordered = useMemo(
    () => sortApps(apps, currentApp),
    [apps, currentApp]
  );

  if (!base) return null;

  return (
    <Popover
      opened={opened}
      onChange={o => (o ? handlers.open() : handlers.close())}
      onOpen={refresh}
      position="bottom-end"
      withArrow
      shadow="md"
    >
      <Popover.Target>
        <ActionIcon
          variant="subtle"
          size="lg"
          aria-label="Apps"
          onClick={handlers.toggle}
        >
          <MattstackMark size={24} />
        </ActionIcon>
      </Popover.Target>
      <Popover.Dropdown>
        {loaded && ordered.length === 0 ? (
          <Text size="sm" c="dimmed" p="xs">
            No apps
          </Text>
        ) : (
          <SimpleGrid cols={3} spacing="xs" w={240}>
            {ordered.map(app => (
              <Tile
                key={app.name}
                app={app}
                current={app.name === currentApp}
              />
            ))}
          </SimpleGrid>
        )}
      </Popover.Dropdown>
    </Popover>
  );
}
