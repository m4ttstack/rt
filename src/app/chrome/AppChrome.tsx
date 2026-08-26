import {
  Group,
  Rail,
  RailEntry,
  RailShell,
  Text,
  useRailState,
} from '@ui/core';
import { useColorScheme } from '@ui/hooks';
import { AppMark } from './AppMark';
import { useSiteHeaderProps } from './layout';

/** Height of the app's slim fixed header, in px. */
export const APP_HEADER_HEIGHT = 64;

/**
 * The app's rail: a single "Rooms" entry (the only destination this
 * walking skeleton has -- a room list replaces the placeholder home
 * content in a later task, not this entry), with the color-scheme toggle
 * pinned to the rail's bottom.
 */
function AppRail({
  expanded,
  onToggleExpanded,
  onNavigate,
}: {
  expanded: boolean;
  onToggleExpanded: () => void;
  onNavigate: () => void;
}) {
  const { computedColorScheme, setColorScheme } = useColorScheme();
  const isDark = computedColorScheme === 'dark';

  return (
    <Rail
      label="App sections"
      expanded={expanded}
      onToggleExpanded={onToggleExpanded}
      pinBottom={
        <RailEntry
          icon={isDark ? 'sun' : 'moon'}
          label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          expanded={expanded}
          onClick={() => setColorScheme(isDark ? 'light' : 'dark')}
        />
      }
    >
      <RailEntry
        icon="users"
        label="Rooms"
        expanded={expanded}
        active
        onClick={onNavigate}
      />
    </Rail>
  );
}

/**
 * The app's chrome: the kit's `RailShell` (68px mini icon rail, expandable)
 * under a slim 64px fixed header carrying the wordmark. The rail stays
 * always-on -- for shell consistency with console -- even though there is
 * only one destination behind it today.
 */
export function AppChrome({ children }: { children: React.ReactNode }) {
  const headerProps = useSiteHeaderProps();
  const rail = useRailState();

  return (
    <RailShell
      headerHeight={APP_HEADER_HEIGHT}
      headerProps={headerProps}
      header={
        <Group wrap="nowrap" gap="xs" w="100%">
          {/* Same recipe as console's header: a 30px mark, sm gap, 22px/700
              wordmark on line-height 1. */}
          <Group gap="sm" wrap="nowrap">
            <AppMark size={30} />
            <Text fw={700} fz={22} lh={1} style={{ whiteSpace: 'nowrap' }}>
              chat
            </Text>
          </Group>
        </Group>
      }
      rail={
        <AppRail
          expanded={rail.effectiveExpanded}
          onToggleExpanded={rail.toggleExpanded}
          onNavigate={rail.close}
        />
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
