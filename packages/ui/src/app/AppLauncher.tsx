import { useEffect, useMemo } from 'react';
import { ActionIcon, Anchor, Image, Popover, Text } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';

import { Icon } from '@mattstack/app-kit/icons';
import classes from './AppLauncher.module.css';
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
      target="_blank"
      rel="noopener noreferrer"
      underline="never"
      data-current={current}
      aria-label={app.displayName}
      className={classes.tile}
    >
      <div className={classes.iconWrap}>
        {app.icon ? (
          <Image src={app.icon} w={40} h={40} alt="" />
        ) : (
          <MattstackMark size={40} decorative />
        )}
        {current && (
          <span data-testid="current-app-marker" className={classes.badge}>
            <Icon name="check" size={10} />
          </span>
        )}
      </div>
      <span className={classes.label} data-current={current}>
        {app.displayName}
      </span>
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
  const ordered = useMemo(() => sortApps(apps, currentApp), [apps, currentApp]);

  // Preload the app list on mount so the popover opens fully-sized on first
  // click, instead of painting an empty sliver and popping the tiles in when
  // the fetch lands. `refresh` is `deckBase`-stable and the hook's 30s cache
  // makes the `onOpen` refresh a no-op within the window (a freshness refetch
  // after it), so this adds one fetch per page load, not per open.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!base) return null;

  return (
    <Popover
      opened={opened}
      onChange={o => (o ? handlers.open() : handlers.close())}
      onOpen={refresh}
      position="bottom-end"
      withArrow
      shadow="md"
      classNames={{ dropdown: classes.dropdown, arrow: classes.arrow }}
    >
      <Popover.Target>
        <ActionIcon
          variant="subtle"
          size={40}
          aria-label="Apps"
          onClick={handlers.toggle}
        >
          <MattstackMark size={30} />
        </ActionIcon>
      </Popover.Target>
      <Popover.Dropdown>
        {loaded && ordered.length === 0 ? (
          <Text size="sm" c="dimmed" p="xs">
            No apps
          </Text>
        ) : (
          <div className={classes.grid}>
            {ordered.map(app => (
              <Tile
                key={app.name}
                app={app}
                current={app.name === currentApp}
              />
            ))}
          </div>
        )}
      </Popover.Dropdown>
    </Popover>
  );
}
