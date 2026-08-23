import { Badge, Button, Card, Group, Stack, Text } from '@mantine/core';
import { createTheme } from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { baseTheme } from './base-theme';
import { ThemeIsland } from './ThemeIsland';

const meta = {
  title: 'Design System/ThemeIsland',
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

// Stands in for a consuming app's brand: heavy enough that "make this subtree
// look like the kit again" is visibly a different thing from "tweak it".
const brandTheme = createTheme({
  primaryColor: 'orange',
  defaultRadius: 0,
  components: {
    Card: { defaultProps: { withBorder: true, shadow: 'none' } },
    Badge: { styles: { root: { textTransform: 'uppercase' } } },
  },
});

const Sample = ({ label }: { label: string }) => (
  <Card p="md" maw={260}>
    <Stack gap="sm">
      <Text fw={600}>{label}</Text>
      <Group>
        <Badge>status</Badge>
        <Button size="xs">Action</Button>
      </Group>
    </Stack>
  </Card>
);

export const KitLookInsideABrandedApp: Story = {
  name: 'baseTheme island inside a branded app',
  render: () => (
    <ThemeIsland theme={brandTheme}>
      <Stack p="md">
        <Text size="sm" c="dimmed">
          The outer island carries a heavy brand (square corners, orange,
          bordered cards, shouting badges). The inner one restores the kit&apos;s
          own defaults with `theme={'{baseTheme}'}` -- one import, no
          transcription. A merge-based override could not express this: merging
          only adds, so every brand treatment would have to be individually
          restated to be removed.
        </Text>
        <Group align="flex-start">
          <Sample label="App brand" />
          <ThemeIsland theme={baseTheme} baseSurfaces>
            <Sample label="Kit default" />
          </ThemeIsland>
        </Group>
      </Stack>
    </ThemeIsland>
  ),
};

export const ScopedEmission: Story = {
  name: 'Variables stay inside the island',
  render: () => (
    <Stack p="md">
      <Text size="sm" c="dimmed">
        The island emits its CSS variables against its own scope class rather
        than `:root`, so the surrounding page keeps the kit theme. A bare
        nested MantineProvider defaults that selector to `:root` and repaints
        the whole document.
      </Text>
      <Group align="flex-start">
        <Sample label="Page theme" />
        <ThemeIsland theme={brandTheme}>
          <Sample label="Island theme" />
        </ThemeIsland>
      </Group>
    </Stack>
  ),
};
