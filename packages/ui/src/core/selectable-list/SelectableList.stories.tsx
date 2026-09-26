import { useState } from 'react';
import { Badge, Box, Button, Code, Group, Stack, Text } from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { SelectableList } from './SelectableList';

const meta = {
  title: 'Core/SelectableList',
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

interface DemoItem {
  id: string;
  name: string;
}

const items: DemoItem[] = Array.from({ length: 24 }, (_, i) => ({
  id: `item-${i}`,
  name: `Object ${i + 1}`,
}));

// No wrapping Paper: the list brings its own kit surface (bg.level2 +
// hairline border + theme radius), so wrapping it in another surface would
// double-decorate it.
function SelectableListDemo() {
  const [selected, setSelected] = useState<DemoItem[]>([]);

  return (
    <Stack w={420} gap="sm">
      <SelectableList
        items={items}
        getItemProps={item => ({ key: item.id, label: item.name })}
        onSelect={setSelected}
        maxHeight="16rem"
      />
      <Text size="sm">
        Selected: <Badge>{selected.length}</Badge>{' '}
        {selected.length > 0 && (
          <Code>{selected.map(i => i.name).join(', ')}</Code>
        )}
      </Text>
    </Stack>
  );
}

export const Default: Story = {
  render: () => <SelectableListDemo />,
};

// Controlled mode: the parent owns the keys via selectedKeys +
// onSelectionChange, so selection can be driven from outside the list
// (onSelect still fires with the resolved items on user toggles).
function ControlledSelectableListDemo() {
  const [keys, setKeys] = useState<string[]>([items[0].id, items[2].id]);

  return (
    <Stack w={420} gap="sm">
      <Group gap="xs">
        <Button
          size="xs"
          variant="default"
          onClick={() => setKeys(items.map(item => item.id))}
        >
          Select all externally
        </Button>
        <Button size="xs" variant="default" onClick={() => setKeys([])}>
          Clear externally
        </Button>
      </Group>
      <SelectableList
        items={items}
        getItemProps={item => ({ key: item.id, label: item.name })}
        selectedKeys={keys}
        onSelectionChange={setKeys}
        maxHeight="16rem"
      />
      <Text size="sm">
        Selected keys: <Badge>{keys.length}</Badge>{' '}
        {keys.length > 0 && <Code>{keys.join(', ')}</Code>}
      </Text>
    </Stack>
  );
}

export const Controlled: Story = {
  name: 'Controlled (selectedKeys + onSelectionChange)',
  render: () => <ControlledSelectableListDemo />,
};

export const Empty: Story = {
  render: () => (
    <Box w={420}>
      <SelectableList
        items={[]}
        getItemProps={() => ({ key: '', label: '' })}
        onSelect={() => {}}
        noItemsMessage="No objects to select."
      />
    </Box>
  ),
};
