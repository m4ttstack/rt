import { Box, Button, Group, NavLink, Stack, Text } from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { SiteShell } from './SiteShell';

// No `component` on `meta` -- every story here is a plain `render` demo (not
// args-driven), matching PageShell.stories.tsx. `layout: 'fullscreen'`
// because the shell owns the whole viewport (fixed header + offset main).
const meta = {
  title: 'Core/SiteShell',
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

function DemoHeader() {
  return (
    <Group justify="space-between" wrap="nowrap" h="100%" px="md">
      <Text fw={700}>my-site</Text>
      <Group gap="xs" wrap="nowrap">
        <Button variant="subtle" size="compact-sm">
          Docs
        </Button>
        <Button variant="default" size="compact-sm">
          Sign in
        </Button>
      </Group>
    </Group>
  );
}

function SomeContent() {
  return (
    <Box p="lg">
      {Array.from({ length: 40 }, (_, i) => (
        <Text key={i} mb="sm">
          Content row {i + 1} -- scroll to see the fixed header stay put.
        </Text>
      ))}
    </Box>
  );
}

export const Default: Story = {
  render: () => (
    <SiteShell header={<DemoHeader />}>
      <SomeContent />
    </SiteShell>
  ),
};

export const TallerHeader: Story = {
  name: 'headerHeight (taller header)',
  render: () => (
    <SiteShell header={<DemoHeader />} headerHeight={80}>
      <SomeContent />
    </SiteShell>
  ),
};

export const TranslucentHeader: Story = {
  name: 'headerProps (translucent blurred header)',
  render: () => (
    <SiteShell
      header={<DemoHeader />}
      headerProps={{
        style: {
          backgroundColor:
            'color-mix(in srgb, var(--ui-bg-2) 88%, transparent)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
        },
      }}
    >
      <SomeContent />
    </SiteShell>
  ),
};

function DemoNavbar() {
  return (
    <Stack gap={2} p="sm">
      {Array.from({ length: 30 }, (_, i) => (
        <NavLink
          key={i}
          label={`Section ${i + 1}`}
          active={i === 2}
          onClick={() => {}}
        />
      ))}
    </Stack>
  );
}

export const WithNavbar: Story = {
  name: 'navbar (fixed sidebar layout)',
  render: () => (
    <SiteShell header={<DemoHeader />} navbar={<DemoNavbar />}>
      <SomeContent />
    </SiteShell>
  ),
};

export const NarrowCollapsibleNavbar: Story = {
  name: 'navbarWidth / navbarBreakpoint (collapses below md)',
  render: () => (
    <SiteShell
      header={<DemoHeader />}
      navbar={<DemoNavbar />}
      navbarWidth={200}
      navbarBreakpoint="md"
      navbarCollapsed={{ mobile: true }}
    >
      <SomeContent />
    </SiteShell>
  ),
};
