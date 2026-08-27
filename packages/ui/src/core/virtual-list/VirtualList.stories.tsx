import { Box, Group, Paper, Text } from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { VirtualList } from './VirtualList';

const meta = {
  title: 'Core/VirtualList',
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

const items = Array.from({ length: 10_000 }, (_, i) => ({
  id: i,
  label: `Row ${i + 1}`,
}));

export const TenThousandRows: Story = {
  render: () => (
    <Box p="lg" maw={420}>
      <Text size="sm" mb="sm" c="dimmed">
        {items.length.toLocaleString()} rows in `items`, but only the ones
        scrolled into view are ever mounted -- inspect the DOM and scroll to see
        rows mount/unmount live.
      </Text>
      <Paper withBorder>
        <VirtualList
          items={items}
          estimateSize={() => 40}
          maxHeight="20rem"
          renderRow={item => (
            <Group
              px="sm"
              py="xs"
              wrap="nowrap"
              style={{ borderBottom: '1px solid var(--mantine-color-gray-2)' }}
            >
              <Text>{item.label}</Text>
            </Group>
          )}
        />
      </Paper>
    </Box>
  ),
};
