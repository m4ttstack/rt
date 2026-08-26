import { useState } from 'react';
import { Box, Button, Text } from '@mantine/core';
import type { MantineColor } from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { PageShell } from '../page-shell/PageShell';
import { Notch } from './Notch';

// No `component` on `meta` -- every story is a plain `render` demo (see the
// PageShell stories for the same convention). A Notch's home is PageShell's
// `topNotch` slot: it squares its own top corners and omits its top border
// because it hangs from the content area's top edge just under the shell
// header, so each story mounts it there (free-floating, the missing top
// edge would read as a rendering bug) with a toggle to show the slide.
const meta = {
  title: 'Core/Notch',
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

function NotchInShell({
  color,
  withCloseButton,
  message,
}: {
  color?: MantineColor;
  withCloseButton?: boolean;
  message: string;
}) {
  const [opened, setOpened] = useState(true);

  return (
    <Box h="100vh">
      <PageShell
        title="Gear library"
        topNotch={{
          content: (
            <Notch
              color={color}
              withCloseButton={withCloseButton}
              onClose={() => setOpened(false)}
            >
              <Text size="sm">{message}</Text>
            </Notch>
          ),
          opened,
        }}
      >
        <Box p="lg">
          <Button onClick={() => setOpened(current => !current)}>
            Toggle notch
          </Button>
        </Box>
      </PageShell>
    </Box>
  );
}

export const Default: Story = {
  render: () => (
    <NotchInShell message="You're on the free plan. Upgrade for more features." />
  ),
};

export const CustomColor: Story = {
  render: () => (
    <NotchInShell color="orange" message="Something needs your attention." />
  ),
};

export const WithoutCloseButton: Story = {
  render: () => (
    <NotchInShell
      withCloseButton={false}
      message="This notch can't be dismissed from the strip itself. Use the toggle below."
    />
  ),
};
