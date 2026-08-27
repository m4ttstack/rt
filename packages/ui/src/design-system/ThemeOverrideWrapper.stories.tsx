import { Button, Group, Stack, Text } from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { ThemeOverrideWrapper } from './ThemeOverrideWrapper';

const meta = {
  title: 'Design System/ThemeOverrideWrapper',
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const PrimaryColorOverride: Story = {
  render: () => (
    <Stack maw={480}>
      <Text size="sm" c="dimmed">
        The wrapper merges a partial theme onto the ancestor MantineProvider for
        its subtree only -- the first button keeps the kit indigo, the wrapped
        one goes teal. It ADDS a treatment; to render a subtree in a different
        theme wholesale (or to get the kit&apos;s look back inside a branded
        app), use ThemeIsland.
      </Text>
      <Group>
        <Button>Kit primary</Button>
        <ThemeOverrideWrapper theme={{ primaryColor: 'teal' }}>
          <Button>Subtree primary</Button>
        </ThemeOverrideWrapper>
      </Group>
    </Stack>
  ),
};

export const ComponentDefaultOverride: Story = {
  render: () => (
    <Group>
      <Button>Theme radius</Button>
      <ThemeOverrideWrapper theme={{ defaultRadius: 'xl' }}>
        <Button>Pill radius subtree</Button>
      </ThemeOverrideWrapper>
    </Group>
  ),
};
