import { Group, Text } from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { IconTooltip } from './IconTooltip';

const meta = {
  component: IconTooltip,
  title: 'Core/IconTooltip',
} satisfies Meta<typeof IconTooltip>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    label: 'This field accepts a comma-separated list of tags.',
  },
  render: args => (
    <Group gap={4}>
      <Text size="sm">Tags</Text>
      <IconTooltip {...args} />
    </Group>
  ),
};

export const CustomIcon: Story = {
  args: {
    label: 'This action cannot be undone.',
    name: 'warning',
  },
  render: args => (
    <Group gap={4}>
      <Text size="sm">Danger zone</Text>
      <IconTooltip {...args} />
    </Group>
  ),
};
