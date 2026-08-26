import { useState } from 'react';
import { ActionIcon, Group, Text } from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { AnimatedChevron } from './AnimatedChevron';

const meta = {
  component: AnimatedChevron,
  title: 'Icons/AnimatedChevron',
  args: {
    opened: false,
  },
} satisfies Meta<typeof AnimatedChevron>;

export default meta;

type Story = StoryObj<typeof meta>;

function ToggleDemo() {
  const [opened, setOpened] = useState(false);

  return (
    <Group gap="md">
      <ActionIcon
        size="lg"
        variant="subtle"
        aria-label="toggle chevron"
        onClick={() => setOpened(current => !current)}
      >
        <AnimatedChevron size={26} opened={opened} />
      </ActionIcon>
      <Text size="sm" c="dimmed">
        {opened ? 'opened' : 'closed'} -- click to toggle
      </Text>
    </Group>
  );
}

export const Default: Story = {};

export const ToggleOpenClosed: Story = {
  render: () => <ToggleDemo />,
};
