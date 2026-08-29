import { useLayoutEffect, useState } from 'react';
import { Box, Button, Group, Text } from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { Notch } from '../notch/Notch';
import { TabBar } from './components/TabBar';
import { usePageShellContext } from './hooks';
import { PageShell } from './PageShell';

// No `component` on `meta` -- every story here is a plain `render` demo (not
// args-driven), and `StoryObj<typeof meta>` requires an `args` object
// whenever `meta.component` is set (matching this kit's `LazyLoader`/
// `HoverWrappers` stories, which do the same for the same reason).
const meta = {
  title: 'Core/PageShell',
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

function SomeContent() {
  return (
    <Box p="lg">
      {Array.from({ length: 20 }, (_, i) => (
        <Text key={i} mb="sm">
          Content row {i + 1}
        </Text>
      ))}
    </Box>
  );
}

export const Default: Story = {
  render: () => (
    <Box h="100vh">
      <PageShell title="Dashboard" actions={<Button>New item</Button>}>
        <SomeContent />
      </PageShell>
    </Box>
  ),
};

export const NoActions: Story = {
  render: () => (
    <Box h="100vh">
      <PageShell title="Settings">
        <SomeContent />
      </PageShell>
    </Box>
  ),
};

export const TitleOnlyActionsBar: Story = {
  name: 'Actions only (no title)',
  render: () => (
    <Box h="100vh">
      <PageShell
        actions={
          <Group gap="sm">
            <Button variant="default">Cancel</Button>
            <Button>Save</Button>
          </Group>
        }
      >
        <SomeContent />
      </PageShell>
    </Box>
  ),
};

export const NoHeader: Story = {
  render: () => (
    <Box h="100vh">
      <PageShell>
        <SomeContent />
      </PageShell>
    </Box>
  ),
};

function WithNotchDemo() {
  const [opened, setOpened] = useState(true);

  return (
    <Box h="100vh">
      <PageShell
        title="Dashboard"
        actions={
          <Button
            variant="light"
            onClick={() => setOpened(current => !current)}
          >
            Toggle notch
          </Button>
        }
        topNotch={{
          content: (
            <Notch onClose={() => setOpened(false)}>
              <Text size="sm">
                A dismissible banner riding in the topNotch slot, docked under
                the header row.
              </Text>
            </Notch>
          ),
          opened,
        }}
      >
        <SomeContent />
      </PageShell>
    </Box>
  );
}

export const WithNotch: Story = {
  render: () => <WithNotchDemo />,
};

function WithTabsDemo() {
  const [activeTab, setActiveTab] = useState('inventory');

  const tab = (id: string, label: string) => ({
    id,
    label,
    active: activeTab === id,
    onClick: () => setActiveTab(id),
  });

  return (
    <Box h="100vh">
      <PageShell
        title={activeTab === 'inventory' ? 'Inventory' : 'Activity'}
        tabs={[tab('inventory', 'Inventory'), tab('activity', 'Activity')]}
      >
        <SomeContent />
      </PageShell>
    </Box>
  );
}

export const WithTabs: Story = {
  name: 'Tabs (page-level tab bar above the body)',
  render: () => <WithTabsDemo />,
};

function WithTabIconsAndColorDemo() {
  const [activeTab, setActiveTab] = useState('inventory');

  return (
    <Box h="100vh">
      <PageShell>
        <PageShell.Main>
          {/* Composed directly inside Main (not via the root's `tabs`
              prop) to reach the TabBar-level `color`/`radius`, and to show
              `iconRight`/`labelComponent` -- the root's `tabs` shorthand
              only threads the tab shape, not these bar-level knobs. */}
          <TabBar
            color="grape"
            radius="md"
            tabs={[
              {
                id: 'inventory',
                label: 'Inventory',
                iconRight: 'chevronRight',
                active: activeTab === 'inventory',
                onClick: () => setActiveTab('inventory'),
              },
              {
                id: 'activity',
                label: 'Activity',
                labelComponent: (
                  <Group gap={4} wrap="nowrap">
                    <Text size="sm" fw={500}>
                      Activity
                    </Text>
                    <Text size="xs" c="dimmed">
                      (12)
                    </Text>
                  </Group>
                ),
                active: activeTab === 'activity',
                onClick: () => setActiveTab('activity'),
              },
            ]}
          />
          <PageShell.Header
            title={activeTab === 'inventory' ? 'Inventory' : 'Activity'}
          />
          <PageShell.Content>
            <SomeContent />
          </PageShell.Content>
        </PageShell.Main>
      </PageShell>
    </Box>
  );
}

function WithTabBarTitleAndActionsDemo() {
  const [activeTab, setActiveTab] = useState('pipeline');

  const tab = (id: string, label: string) => ({
    id,
    label,
    active: activeTab === id,
    onClick: () => setActiveTab(id),
  });

  return (
    <Box h="100vh">
      <PageShell tabBarHeight={40}>
        <PageShell.Main>
          {/* One row standing in for the header: the page title leads the
              tabs and the page's actions trail them, for a page with no
              sidebar for a root-level tab bar to span. */}
          <PageShell.TabBar
            title="Wiring"
            tabs={[tab('pipeline', 'Pipeline'), tab('surface', 'Surface')]}
            actions={<Button size="xs">Open pack</Button>}
          />
          <PageShell.Content>
            <SomeContent />
          </PageShell.Content>
        </PageShell.Main>
      </PageShell>
    </Box>
  );
}

export const WithTabBarTitleAndActions: Story = {
  name: 'TabBar title + actions (the tab row as the header row)',
  render: () => <WithTabBarTitleAndActionsDemo />,
};

export const WithTabIconsAndColor: Story = {
  name: 'Tabs (iconRight, labelComponent, color, radius)',
  render: () => <WithTabIconsAndColorDemo />,
};

export const WithSideBarHeaderBg: Story = {
  name: 'sideBarHeaderBg (override the shared sidebar/header surface)',
  render: () => (
    <Box h="100vh">
      <PageShell
        sidebarWidth={260}
        sideBarHeaderBg="var(--mantine-color-grape-light)"
      >
        <PageShell.Sidebar>
          <Box p="md">
            <Text size="sm">Filters</Text>
          </Box>
        </PageShell.Sidebar>
        <PageShell.Main>
          <PageShell.Header title="Gear library" />
          <PageShell.Content>
            <SomeContent />
          </PageShell.Content>
        </PageShell.Main>
      </PageShell>
    </Box>
  ),
};

function CustomTabRow() {
  // A consumer rendering their OWN tab row (instead of the root's `tabs`
  // prop) registers it into the shell's height math the same way the
  // built-in TabBar does: `setHasTabBar` in a layout effect on mount, with
  // a matching cleanup on unmount.
  const { setHasTabBar } = usePageShellContext();

  useLayoutEffect(() => {
    setHasTabBar(true);
    return () => setHasTabBar(false);
  }, [setHasTabBar]);

  return (
    <Group h={46} px="md" bg="var(--ui-bg-2)" style={{ flexShrink: 0 }}>
      <Text size="sm" c="dimmed">
        A hand-rolled tab row, registered via setHasTabBar
      </Text>
    </Group>
  );
}

export const WithCustomTabBar: Story = {
  name: 'setHasTabBar (a custom tab row registers its own presence)',
  render: () => (
    <Box h="100vh">
      <PageShell>
        <PageShell.Main>
          <CustomTabRow />
          <PageShell.Header title="Dashboard" />
          <PageShell.Content>
            <SomeContent />
          </PageShell.Content>
        </PageShell.Main>
      </PageShell>
    </Box>
  ),
};

export const WithTopOffset: Story = {
  name: 'topOffset (clears an external fixed header)',
  render: () => (
    <Box h="100vh">
      <PageShell title="Dashboard" topOffset={48}>
        <SomeContent />
      </PageShell>
    </Box>
  ),
};

export const Compound: Story = {
  name: 'Compound (collapsible sidebar + header + content)',
  render: () => (
    <Box h="100vh">
      <PageShell sidebarWidth={260}>
        <PageShell.Sidebar>
          <Box p="md">
            {Array.from({ length: 12 }, (_, i) => (
              <Text key={i} size="sm" mb="xs">
                Filter {i + 1}
              </Text>
            ))}
          </Box>
        </PageShell.Sidebar>
        <PageShell.Main>
          <PageShell.Header
            title="Gear library"
            actions={<Button>Add item</Button>}
          />
          <PageShell.Content>
            <SomeContent />
          </PageShell.Content>
        </PageShell.Main>
      </PageShell>
    </Box>
  ),
};

export const CompoundScrollClamp: Story = {
  name: 'Compound (scrollClamp inner-scroll layout)',
  render: () => (
    <Box h="100vh">
      <PageShell scrollClamp sidebarWidth={260}>
        <PageShell.Sidebar>
          <Box p="md">
            <Text size="sm">Filters</Text>
          </Box>
        </PageShell.Sidebar>
        <PageShell.Main>
          <PageShell.Header title="Gear library" />
          <PageShell.Content>
            {() => (
              <Box flex={1} mih={0} style={{ overflowY: 'auto' }} p="lg">
                {Array.from({ length: 60 }, (_, i) => (
                  <Text key={i} mb="sm">
                    Inner-scrolled row {i + 1}
                  </Text>
                ))}
              </Box>
            )}
          </PageShell.Content>
        </PageShell.Main>
      </PageShell>
    </Box>
  ),
};
