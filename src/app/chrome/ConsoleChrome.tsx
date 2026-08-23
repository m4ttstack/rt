import {
  Group,
  Rail,
  RailEntry,
  RailShell,
  Text,
  useRailState,
} from '@ui/core';
import { useColorScheme } from '@ui/hooks';
import { Link } from '../router/Link';

export const CONSOLE_HEADER_HEIGHT = 64;

export type ConsoleSection = 'runs' | 'search';

export function ConsoleChrome({
  section,
  children,
}: {
  section: ConsoleSection | null;
  children: React.ReactNode;
}) {
  const rail = useRailState();
  const { computedColorScheme, setColorScheme } = useColorScheme();
  const isDark = computedColorScheme === 'dark';

  return (
    <RailShell
      headerHeight={CONSOLE_HEADER_HEIGHT}
      header={
        <Group gap="xs" wrap="nowrap">
          <Text fw={700}>console</Text>
        </Group>
      }
      rail={
        <Rail
          label="Console sections"
          expanded={rail.effectiveExpanded}
          onToggleExpanded={rail.toggleExpanded}
          pinBottom={
            <RailEntry
              icon={isDark ? 'sun' : 'moon'}
              label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              expanded={rail.effectiveExpanded}
              onClick={() => setColorScheme(isDark ? 'light' : 'dark')}
            />
          }
        >
          <RailEntry
            icon="layers"
            label="Runs"
            component={Link}
            href="/"
            expanded={rail.effectiveExpanded}
            active={section === 'runs'}
            onClick={rail.close}
          />
          <RailEntry
            icon="search"
            label="Search"
            component={Link}
            href="/search"
            expanded={rail.effectiveExpanded}
            active={section === 'search'}
            onClick={rail.close}
          />
        </Rail>
      }
      railExpanded={rail.effectiveExpanded}
      railOpened={rail.opened}
      onToggleRail={rail.toggleOpened}
      onCloseRail={rail.close}
    >
      {children}
    </RailShell>
  );
}
