import { Stack } from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { CopyButton } from './CopyButton';

const meta = {
  component: CopyButton,
  title: 'Core/CopyButton',
} satisfies Meta<typeof CopyButton>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    value: 'bun create-cli/create.ts my-app',
    children: 'Copy scaffold command',
  },
};

export const CodeStyle: Story = {
  args: {
    value: 'bun install',
    codeStyle: true,
  },
  render: args => (
    <Stack align="flex-start" gap="sm">
      {/* No children: the value doubles as the monospace label. */}
      <CopyButton {...args} />
    </Stack>
  ),
};
