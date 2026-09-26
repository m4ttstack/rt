import { Card, Text } from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { ContentContainer } from './ContentContainer';

// No `component` on `meta` -- these are plain `render` demos, not
// args-driven (see PageShell.stories.tsx for why).
const meta = {
  title: 'Core/ContentContainer',
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <ContentContainer>
      <Card withBorder p="lg">
        <Text fw={500} mb="xs">
          Page content
        </Text>
        <Text size="sm" c="dimmed">
          The ContentContainer caps its width and centers itself, so long-form
          content stays readable even on very wide viewports.
        </Text>
      </Card>
    </ContentContainer>
  ),
};

export const OverriddenMaxWidth: Story = {
  render: () => (
    <ContentContainer maw={600}>
      <Card withBorder p="lg">
        <Text>A narrower ContentContainer, via a `maw` override.</Text>
      </Card>
    </ContentContainer>
  ),
};
