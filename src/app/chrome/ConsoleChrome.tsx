import { Link } from 'wouter';

import {
  Group,
  HybridMenu,
  Rail,
  RailEntry,
  RailShell,
  Text,
  useRailState,
} from '@mattstack/app-kit/core';
import { useColorScheme } from '@mattstack/app-kit/hooks';
import { WiringRailEntry } from '../wiring/WiringRailEntry';

export const CONSOLE_HEADER_HEIGHT = 64;

export type ConsoleSection = 'runs' | 'search' | 'wiring';

// Matches `MantineColorScheme` structurally without importing it -- the
// `@mantine/core` import wall requires going through `@mattstack/app-kit/*`,
// which doesn't re-export this type.
type ColorSchemePreference = 'auto' | 'light' | 'dark';

const COLOR_SCHEME_OPTIONS: { label: string; value: ColorSchemePreference }[] =
  [
    { label: 'System', value: 'auto' },
    { label: 'Light', value: 'light' },
    { label: 'Dark', value: 'dark' },
  ];

function ColorSchemeControl({ expanded }: { expanded: boolean }) {
  const { colorScheme, computedColorScheme, setColorScheme } = useColorScheme();
  const isDark = computedColorScheme === 'dark';

  return (
    <HybridMenu
      options={COLOR_SCHEME_OPTIONS}
      value={colorScheme}
      onChange={value => setColorScheme(value as ColorSchemePreference)}
      target={
        <RailEntry
          icon={isDark ? 'sun' : 'moon'}
          label="Color scheme"
          expanded={expanded}
        />
      }
    />
  );
}

export function ConsoleChrome({
  section,
  children,
}: {
  section: ConsoleSection | null;
  children: React.ReactNode;
}) {
  const rail = useRailState();

  return (
    <RailShell
      headerHeight={CONSOLE_HEADER_HEIGHT}
      header={
        <Group gap="sm" wrap="nowrap">
          <img
            src="/favicon.svg"
            alt=""
            width={30}
            height={30}
            style={{ display: 'block', flex: 'none' }}
          />
          <Text fw={700} fz={22} lh={1}>
            console
          </Text>
        </Group>
      }
      rail={
        <Rail
          label="Console sections"
          expanded={rail.effectiveExpanded}
          onToggleExpanded={rail.toggleExpanded}
          pinBottom={<ColorSchemeControl expanded={rail.effectiveExpanded} />}
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
          <WiringRailEntry
            expanded={rail.effectiveExpanded}
            active={section === 'wiring'}
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
