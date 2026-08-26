import { Box, Card, Text } from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { GradientBorder } from './GradientBorder';

// No `component` on `meta` -- these are plain `render` demos, not
// args-driven (see PageShell.stories.tsx for why).
const meta = {
  title: 'Core/GradientBorder',
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <GradientBorder>
      <Box p="lg" w={280}>
        <Text fw={500}>Featured card</Text>
        <Text size="sm" c="dimmed">
          Surface-less children sit on the default bg.level2 inner surface, so
          only the 2px indigo/grape/pink ring shows.
        </Text>
      </Box>
    </GradientBorder>
  ),
};

export const CustomColors: Story = {
  render: () => (
    <GradientBorder colors={['teal', 'cyan', 'blue']}>
      <Box p="lg" w={280}>
        <Text fw={500}>Custom gradient</Text>
      </Box>
    </GradientBorder>
  ),
};

export const CustomSurface: Story = {
  name: 'innerBg (custom inner surface)',
  render: () => (
    <GradientBorder innerBg="transparent">
      <Card p="lg" w={280} bg="var(--ui-bg-4)">
        <Text fw={500}>Child-owned surface</Text>
        <Text size="sm" c="dimmed">
          innerBg=&quot;transparent&quot; hands the surface back to the child;
          this Card brings bg.level4 itself.
        </Text>
      </Card>
    </GradientBorder>
  ),
};

export const Disabled: Story = {
  render: () => (
    <GradientBorder enabled={false}>
      <Card withBorder p="lg" w={280}>
        <Text>Renders unwrapped when `enabled` is false.</Text>
      </Card>
    </GradientBorder>
  ),
};
