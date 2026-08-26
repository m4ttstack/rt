import { ActionIcon, Box, Group, Stack, Text } from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { useDisclosure } from '@ui/hooks';
import { Icons } from '@ui/icons';
import { SlideInSidebar } from './SlideInSidebar';

// No `component` on `meta` -- these are plain `render` demos, not
// args-driven (see PageShell.stories.tsx for why).
const meta = {
  title: 'Core/SlideInSidebar',
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const CollapsibleRail: Story = {
  render: () => {
    const [opened, { toggle }] = useDisclosure(true);
    return (
      <Group gap={0} align="stretch" pos="relative" h={320}>
        <SlideInSidebar
          opened={opened}
          width={240}
          pos="relative"
          trigger={
            <ActionIcon
              size="lg"
              variant="default"
              onClick={toggle}
              aria-label="Toggle sidebar"
            >
              <Icons.arrowLeftToLine size={18} />
            </ActionIcon>
          }
        >
          <Stack p="md">
            <Text fw={500}>Inline rail</Text>
            <Text size="sm" c="dimmed">
              Stays in the layout flow and animates its width to 0 instead of
              overlaying -- content stays mounted while collapsed.
            </Text>
          </Stack>
        </SlideInSidebar>
        <Box flex={1} p="md">
          <Text size="sm">
            Page content grows into the space the rail releases.
          </Text>
        </Box>
      </Group>
    );
  },
};

export const Borderless: Story = {
  render: () => {
    const [opened, { toggle }] = useDisclosure(true);
    return (
      <Group gap={0} align="stretch" pos="relative" h={320}>
        <SlideInSidebar
          opened={opened}
          width={240}
          border={false}
          pos="relative"
          bg="var(--ui-bg-2)"
          trigger={
            <ActionIcon
              size="lg"
              variant="default"
              onClick={toggle}
              aria-label="Toggle sidebar"
            >
              <Icons.arrowLeftToLine size={18} />
            </ActionIcon>
          }
        >
          <Stack p="md">
            <Text fw={500}>Borderless rail</Text>
            <Text size="sm" c="dimmed">
              Setting border to false drops the hairline entirely -- useful when
              the rail already has its own surface contrast.
            </Text>
          </Stack>
        </SlideInSidebar>
        <Box flex={1} p="md">
          <Text size="sm">No hairline separates the rail from the page.</Text>
        </Box>
      </Group>
    );
  },
};

export const RightEdge: Story = {
  name: 'Right edge (mirrored)',
  render: () => {
    const [opened, { toggle }] = useDisclosure(true);
    return (
      <Group gap={0} align="stretch" pos="relative" h={320}>
        <Box flex={1} p="md">
          <Text size="sm">
            With side=&quot;right&quot; the hairline and trigger mirror to the
            rail&apos;s left edge.
          </Text>
        </Box>
        <SlideInSidebar
          opened={opened}
          width={240}
          side="right"
          pos="relative"
          trigger={
            <ActionIcon
              size="lg"
              variant="default"
              onClick={toggle}
              aria-label="Toggle sidebar"
            >
              <Icons.arrowLeftToLine size={18} />
            </ActionIcon>
          }
        >
          <Stack p="md">
            <Text fw={500}>Right-docked rail</Text>
          </Stack>
        </SlideInSidebar>
      </Group>
    );
  },
};
