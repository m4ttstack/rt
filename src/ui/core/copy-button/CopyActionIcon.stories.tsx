import { Group, Text } from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { CopyActionIcon } from './CopyButton';

const meta = {
  component: CopyActionIcon,
  title: 'Core/CopyActionIcon',
} satisfies Meta<typeof CopyActionIcon>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    value: 'npm install chat',
    label: 'Copy install command',
  },
  render: args => (
    <Group>
      <Text ff="monospace">{args.value}</Text>
      <CopyActionIcon {...args} />
    </Group>
  ),
};
