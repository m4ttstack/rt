import { Paper, Stack, Text } from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { useSchemeColors } from '@mattstack/app-kit/hooks';

const meta = {
  title: 'Design System/Theme',
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

function BackgroundLevels() {
  const { bg } = useSchemeColors();

  return (
    <Stack gap={0} w={320}>
      {(['level1', 'level2', 'level3', 'level4'] as const).map(level => (
        <Paper
          key={level}
          bg={bg[level]}
          p="lg"
          radius={0}
          withBorder={false}
          shadow="none"
        >
          <Text fw={600}>{level}</Text>
          <Text size="sm" c="dimmed">
            {bg[level]}
          </Text>
        </Paper>
      ))}
    </Stack>
  );
}

function TextTokens() {
  const { text } = useSchemeColors();

  return (
    <Stack gap="xs" w={320}>
      {(['normal', 'muted', 'dimmed'] as const).map(token => (
        <Text key={token} c={text[token]}>
          text.{token} -- {text[token]}
        </Text>
      ))}
    </Stack>
  );
}

export const BgLevels: Story = {
  render: () => <BackgroundLevels />,
};

export const TextTokensStory: Story = {
  name: 'Text tokens',
  render: () => <TextTokens />,
};
