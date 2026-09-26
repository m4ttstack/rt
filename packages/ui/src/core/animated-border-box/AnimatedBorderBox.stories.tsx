import { Stack, Text } from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { AnimatedBorderBox } from './AnimatedBorderBox';

// No `component` on `meta` -- these are plain `render` demos, not
// args-driven (see PageShell.stories.tsx for why).
const meta = {
  title: 'Core/AnimatedBorderBox',
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <AnimatedBorderBox w={320}>
      <Stack p="lg" gap={4}>
        <Text fw={500}>Promoted feature</Text>
        <Text size="sm" c="dimmed">
          A slowly-rotating conic-gradient border, pure CSS via a registered
          `@property --border-angle` custom property. Hover to pause it.
        </Text>
      </Stack>
    </AnimatedBorderBox>
  ),
};

export const CustomColors: Story = {
  render: () => (
    <AnimatedBorderBox w={320} colors={['teal', 'lime']} shade={5}>
      <Stack p="lg" gap={4}>
        <Text fw={500}>Teal / lime variant</Text>
      </Stack>
    </AnimatedBorderBox>
  ),
};

export const FillOverride: Story = {
  name: 'Fill override (--abb-fill)',
  render: () => (
    <AnimatedBorderBox
      w={320}
      style={
        {
          // The static fill defaults to the kit's --ui-bg-2 surface slot; an
          // app that remaps the slots to role-based surfaces re-points the
          // fill here instead of overriding the kit stylesheet.
          '--abb-fill': 'var(--mantine-color-indigo-9)',
        } as React.CSSProperties
      }
    >
      <Stack p="lg" gap={4}>
        <Text fw={500} c="white">
          Custom fill surface
        </Text>
        <Text size="sm" c="gray.3">
          The static interior fill is re-pointed via the --abb-fill custom
          property, leaving the kit&apos;s default --ui-bg-2 surface alone.
        </Text>
      </Stack>
    </AnimatedBorderBox>
  ),
};

export const RunsOnce: Story = {
  name: 'loop={false} (single rotation)',
  render: () => (
    <AnimatedBorderBox w={320} loop={false}>
      <Stack p="lg" gap={4}>
        <Text fw={500}>Plays once, then stops</Text>
      </Stack>
    </AnimatedBorderBox>
  ),
};

export const Disabled: Story = {
  render: () => (
    <AnimatedBorderBox w={320} enabled={false}>
      <Stack p="lg" gap={4}>
        <Text>Renders unwrapped when `enabled` is false.</Text>
      </Stack>
    </AnimatedBorderBox>
  ),
};
