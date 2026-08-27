import { ActionIcon, Group, Stack, Text } from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { Icons } from '@mattstack/app-kit/icons';
import { HoverBox, HoverGroup } from './HoverWrappers';

const meta = {
  title: 'Core/HoverWrappers',
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const RowActions: Story = {
  render: () => (
    <Stack p="lg" gap={0} w={360}>
      {['Alpha', 'Bravo', 'Charlie'].map(name => (
        <HoverGroup
          key={name}
          justify="space-between"
          p="sm"
          style={{ borderBottom: '1px solid var(--mantine-color-gray-3)' }}
        >
          {hovered => (
            <>
              <Text>{name}</Text>
              <Group
                gap={4}
                style={{ visibility: hovered ? 'visible' : 'hidden' }}
              >
                <ActionIcon variant="subtle" size="sm">
                  <Icons.edit size={14} />
                </ActionIcon>
                <ActionIcon variant="subtle" color="red" size="sm">
                  <Icons.trash size={14} />
                </ActionIcon>
              </Group>
            </>
          )}
        </HoverGroup>
      ))}
    </Stack>
  ),
};

export const RevealOnHover: Story = {
  render: () => (
    <HoverBox
      p="xl"
      w={280}
      style={{
        border: '1px solid var(--mantine-color-gray-3)',
        borderRadius: 8,
      }}
    >
      {hovered => (
        <Stack align="center" gap="xs">
          <Text>Hover this card</Text>
          {hovered && (
            <Text size="sm" c="dimmed">
              Now you see me!
            </Text>
          )}
        </Stack>
      )}
    </HoverBox>
  ),
};
