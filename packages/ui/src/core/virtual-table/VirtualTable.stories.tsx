import { useRef } from 'react';
import { Badge, Box, Text } from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useVirtualizer } from '@tanstack/react-virtual';

import { Table } from '../table/Table';
import {
  VirtualTable,
  VirtualTableHeader,
  VirtualTableShell,
} from './VirtualTable';

const meta = {
  title: 'Core/VirtualTable',
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

interface Row {
  id: number;
  name: string;
  status: 'ok' | 'error';
}

const rows: Row[] = Array.from({ length: 5_000 }, (_, i) => ({
  id: i,
  name: `resource-${i.toString().padStart(5, '0')}`,
  status: i % 17 === 0 ? 'error' : 'ok',
}));

export const FiveThousandRows: Story = {
  render: () => (
    <Box p="lg" maw={560}>
      <Text size="sm" mb="sm" c="dimmed">
        {rows.length.toLocaleString()} rows -- header stays put
        (`stickyHeader`), body only mounts the visible window.
      </Text>
      <VirtualTable
        items={rows}
        maxHeight="20rem"
        estimateSize={() => 40}
        getRowKey={row => row.id}
        columns={[
          { key: 'id', header: 'ID', cell: row => row.id, width: 80 },
          { key: 'name', header: 'Resource', cell: row => row.name },
          {
            key: 'status',
            header: 'Status',
            width: 100,
            cell: row => (
              <Badge color={row.status === 'ok' ? 'green' : 'red'}>
                {row.status}
              </Badge>
            ),
          },
        ]}
      />
    </Box>
  ),
};

// Inversion-of-control shape: the caller owns the virtualizer (via
// `useVirtualizer`) and renders rows itself, using `VirtualTableHeader` +
// `VirtualTableShell` instead of the declarative `items`/`columns` API
// above. Useful when row rendering needs full control, or the virtualizer
// is shared with other UI.
function IoCShellDemo() {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 40,
    overscan: 10,
    getItemKey: index => rows[index].id,
  });

  return (
    <Box p="lg" maw={560}>
      <Text size="sm" mb="sm" c="dimmed">
        Same {rows.length.toLocaleString()} rows, caller-owned virtualizer:
        `VirtualTableHeader` above `VirtualTableShell`.
      </Text>
      <VirtualTableHeader>
        <Table.Tr>
          <Table.Th style={{ width: 80 }}>ID</Table.Th>
          <Table.Th>Resource</Table.Th>
          <Table.Th style={{ width: 100 }}>Status</Table.Th>
        </Table.Tr>
      </VirtualTableHeader>
      <VirtualTableShell
        ref={scrollRef}
        virtualizer={virtualizer}
        maxHeight="20rem"
      >
        {virtualizer.getVirtualItems().map(virtualRow => {
          const row = rows[virtualRow.index];
          return (
            <Table.Tr
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
            >
              <Table.Td style={{ width: 80 }}>{row.id}</Table.Td>
              <Table.Td>{row.name}</Table.Td>
              <Table.Td style={{ width: 100 }}>
                <Badge color={row.status === 'ok' ? 'green' : 'red'}>
                  {row.status}
                </Badge>
              </Table.Td>
            </Table.Tr>
          );
        })}
      </VirtualTableShell>
    </Box>
  );
}

export const InversionOfControlShell: Story = {
  render: () => <IoCShellDemo />,
};
