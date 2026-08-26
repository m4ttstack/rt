import { Badge, Box, NavLink, Stack, Text } from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { PageShell } from '../page-shell/PageShell';
import { Rail } from './Rail';
import { RailEntry } from './RailEntry';
import { RailShell } from './RailShell';
import { useRailState } from './useRailState';

// No `component` on `meta` -- every story here is a plain `render` demo (not
// args-driven), matching SiteShell.stories.tsx. `layout: 'fullscreen'`
// because the shell owns the whole viewport (fixed header + alt-layout rail).
const meta = {
  title: 'Core/RailShell',
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

const HEADER_HEIGHT = 64;

function DemoRail({
  expanded,
  onToggleExpanded,
}: {
  expanded: boolean;
  onToggleExpanded: () => void;
}) {
  return (
    <Rail
      label="Demo navigation"
      expanded={expanded}
      onToggleExpanded={onToggleExpanded}
      pinBottom={
        <RailEntry
          icon="settings"
          label="Settings"
          expanded={expanded}
          onClick={() => {}}
        />
      }
    >
      <RailEntry
        icon="package"
        label="Inventory"
        expanded={expanded}
        active
        onClick={() => {}}
      />
      <RailEntry
        icon="users"
        label="Members"
        expanded={expanded}
        onClick={() => {}}
      />
      <RailEntry
        icon="wrench"
        label="Maintenance"
        expanded={expanded}
        disabled
      />
    </Rail>
  );
}

function DemoContent() {
  return (
    <Box p="lg" pt={HEADER_HEIGHT + 16}>
      {Array.from({ length: 30 }, (_, i) => (
        <Text key={i} mb="sm">
          Content row {i + 1} -- expand the rail from its trigger to see the
          labels slide in while icons stay put.
        </Text>
      ))}
    </Box>
  );
}

function RailShellDemo({ defaultExpanded }: { defaultExpanded?: boolean }) {
  const rail = useRailState({ defaultExpanded });

  return (
    <RailShell
      headerHeight={HEADER_HEIGHT}
      header={<Text fw={600}>Gear library</Text>}
      rail={
        <DemoRail
          expanded={rail.effectiveExpanded}
          onToggleExpanded={rail.toggleExpanded}
        />
      }
      railExpanded={rail.effectiveExpanded}
      railOpened={rail.opened}
      onToggleRail={rail.toggleOpened}
      onCloseRail={rail.close}
    >
      <DemoContent />
    </RailShell>
  );
}

export const Default: Story = {
  render: () => <RailShellDemo />,
};

export const Expanded: Story = {
  name: 'useRailState defaultExpanded (starts labeled)',
  render: () => <RailShellDemo defaultExpanded />,
};

function DoubleNavDemo() {
  const rail = useRailState();

  return (
    <RailShell
      headerHeight={HEADER_HEIGHT}
      header={<Text fw={600}>Gear library</Text>}
      rail={
        <DemoRail
          expanded={rail.effectiveExpanded}
          onToggleExpanded={rail.toggleExpanded}
        />
      }
      railExpanded={rail.effectiveExpanded}
      railOpened={rail.opened}
      onToggleRail={rail.toggleOpened}
      onCloseRail={rail.close}
    >
      {/* No topOffset: a hosted PageShell defaults it to the rail's
          headerHeight, so the double-nav geometry cannot drift. */}
      <PageShell sidebarWidth={240}>
        <PageShell.Sidebar>
          <Stack gap={2} p="md" component="nav" aria-label="Categories">
            {['All gear', 'Cameras', 'Audio', 'Lighting'].map((label, i) => (
              <NavLink
                key={label}
                component="button"
                label={label}
                active={i === 0}
                rightSection={
                  <Badge size="sm" variant="light" color="gray">
                    {8 - i}
                  </Badge>
                }
                onClick={() => {}}
              />
            ))}
          </Stack>
        </PageShell.Sidebar>
        <PageShell.Main>
          <PageShell.Header title="Inventory" />
          <PageShell.Content>
            <Box p="lg">
              {Array.from({ length: 20 }, (_, i) => (
                <Text key={i} mb="sm">
                  Row {i + 1} -- the app-level rail and the page-level sidebar
                  collapse independently (the double-nav geometry).
                </Text>
              ))}
            </Box>
          </PageShell.Content>
        </PageShell.Main>
      </PageShell>
    </RailShell>
  );
}

export const WithPageShell: Story = {
  name: 'with PageShell (double-nav geometry)',
  render: () => <DoubleNavDemo />,
};
