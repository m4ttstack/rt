import { useState } from 'react';
import { Paper, SimpleGrid, Stack, Text } from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { TextInput } from '@mattstack/app-kit/core';
import { ICON_NAMES, Icons } from './Icons';

const meta = {
  title: 'Icons/Registry',
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

function IconGrid() {
  const [search, setSearch] = useState('');
  const names = ICON_NAMES.filter(name =>
    name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Stack p="lg">
      <TextInput
        label="Search"
        placeholder="Filter icons..."
        value={search}
        onChange={event => setSearch(event.currentTarget.value)}
        w={300}
      />
      <Text size="sm" c="dimmed">
        {names.length} of {ICON_NAMES.length} icons
      </Text>
      <SimpleGrid cols={{ base: 3, xs: 4, sm: 6, md: 8 }} spacing="md">
        {names.map(name => {
          const IconComponent = Icons[name];
          return (
            <Paper key={name} withBorder p="md">
              <Stack gap="xs" align="center">
                <IconComponent size={24} />
                <Text size="xs" ta="center" lineClamp={1}>
                  {name}
                </Text>
              </Stack>
            </Paper>
          );
        })}
      </SimpleGrid>
    </Stack>
  );
}

export const Registry: Story = {
  render: () => <IconGrid />,
};
