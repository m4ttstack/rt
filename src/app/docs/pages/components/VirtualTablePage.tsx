import { useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

import {
  Stack,
  Table,
  Text,
  VirtualTable,
  VirtualTableHeader,
  VirtualTableShell,
} from '@ui/core';
import type { VirtualTableColumn } from '@ui/core';
import { ComponentDoc } from '../../ComponentDoc';
import { DocSection } from '../../DocPage';

const USAGE = [
  '// Declarative (default) -- VirtualTable owns the virtualizer.',
  "import { VirtualTable, type VirtualTableColumn } from '@ui/core';",
  '',
  'const columns: VirtualTableColumn<Row>[] = [',
  "  { key: 'name', header: 'Name', cell: row => row.name },",
  "  { key: 'value', header: 'Value', cell: row => row.value,",
  "    align: 'right', width: 120 },",
  '];',
  '',
  '<VirtualTable',
  '  items={rows}',
  '  columns={columns}',
  '  getRowKey={row => row.id}',
  '  maxHeight="12rem"',
  '/>',
  '',
  '// Inversion of control -- the caller owns the virtualizer and rows.',
  "import { Table, VirtualTableHeader, VirtualTableShell } from '@ui/core';",
  "import { useVirtualizer } from '@tanstack/react-virtual';",
  '',
  'const virtualizer = useVirtualizer({',
  '  count: rows.length,',
  '  getScrollElement: () => scrollRef.current,',
  '  estimateSize: () => 40,',
  '});',
  '',
  '<VirtualTableHeader>',
  '  <Table.Tr><Table.Th>Name</Table.Th></Table.Tr>',
  '</VirtualTableHeader>',
  '<VirtualTableShell ref={scrollRef} virtualizer={virtualizer} maxHeight="12rem">',
  '  {virtualizer.getVirtualItems().map(row => (',
  '    <Table.Tr key={row.key} data-index={row.index}',
  '      ref={virtualizer.measureElement}>',
  '      <Table.Td>{rows[row.index].name}</Table.Td>',
  '    </Table.Tr>',
  '  ))}',
  '</VirtualTableShell>',
].join('\n');

// Rows transcribed from src/ui/core/virtual-table/VirtualTable.tsx
// (VirtualTableProps<T>).
const PROPS_ROWS = [
  { name: 'items', type: 'T[]', note: 'Required. The full row set.' },
  {
    name: 'columns',
    type: 'VirtualTableColumn<T>[]',
    note: 'Required. Typed column definitions (see below).',
  },
  {
    name: 'estimateSize?',
    type: '(index) => number',
    note: 'Estimated row height in px, used before a row is actually measured. Default () => 40.',
  },
  {
    name: 'overscan?',
    type: 'number',
    note: 'Rows to render above/below the visible window. Default 10.',
  },
  {
    name: 'maxHeight?',
    type: 'string | number',
    note: "Max height of the scrollable body. Default '20vh'.",
  },
  {
    name: 'getRowKey?',
    type: '(item, index) => string | number',
    note: 'Key for each row; defaults to its index.',
  },
  {
    name: 'containerProps?',
    type: 'div props',
    note: 'Extra props for the outer scroll container -- a plain scrollable div here, not a Mantine ScrollArea, hence the different name from VirtualList. A style merges over maxHeight/overflow.',
  },
];

// Rows transcribed from the same file (VirtualTableColumn<T>).
const COLUMN_ROWS = [
  {
    name: 'key',
    type: 'string',
    note: 'Required. Stable column identity.',
  },
  {
    name: 'header',
    type: 'ReactNode',
    note: 'Required. Header cell content.',
  },
  {
    name: 'cell',
    type: '(item) => ReactNode',
    note: 'Required. Body cell content for a row.',
  },
  {
    name: 'width?',
    type: 'number | string',
    note: 'Fixed column width.',
  },
  {
    name: 'align?',
    type: "'left' | 'center' | 'right'",
    note: 'Text alignment for header and body cells.',
  },
];

// Rows transcribed from VirtualTableHeaderProps.
const HEADER_ROWS = [
  {
    name: 'children',
    type: 'ReactNode',
    note: 'Required. Header row content, e.g. a Table.Tr of Table.Ths.',
  },
];

// Rows transcribed from VirtualTableShellProps.
const SHELL_ROWS = [
  {
    name: 'children',
    type: 'ReactNode',
    note: "Required. Caller-rendered row content for the virtualizer's current window.",
  },
  {
    name: 'virtualizer',
    type: 'Virtualizer<HTMLDivElement, Element>',
    note: 'Required. The caller-owned @tanstack/react-virtual virtualizer driving this shell.',
  },
  {
    name: 'maxHeight?',
    type: 'string',
    note: "Max height of the scrollable body. Default '20vh'.",
  },
];

const VIRTUAL_ROWS = Array.from({ length: 5000 }, (_, index) => ({
  id: index,
  name: `row-${index}`,
  value: Math.round(Math.sin(index) * 1000),
}));

function DeclarativeDemo() {
  const columns = useMemo<VirtualTableColumn<(typeof VIRTUAL_ROWS)[number]>[]>(
    () => [
      { key: 'name', header: 'Name', cell: row => row.name },
      {
        key: 'value',
        header: 'Value',
        cell: row => row.value,
        align: 'right',
        width: 120,
      },
    ],
    []
  );

  return (
    <Stack gap="sm">
      <Text size="sm" c="dimmed">
        Declarative (default): {VIRTUAL_ROWS.length.toLocaleString()} rows
        behind a sticky header; spacer rows keep the scrollbar honest about the
        full count.
      </Text>
      <VirtualTable
        items={VIRTUAL_ROWS}
        columns={columns}
        maxHeight="12rem"
        getRowKey={row => row.id}
      />
    </Stack>
  );
}

function IoCShellDemo() {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: VIRTUAL_ROWS.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 40,
    getItemKey: index => VIRTUAL_ROWS[index].id,
  });

  return (
    <Stack gap="sm">
      <Text size="sm" c="dimmed">
        Inversion of control: the caller owns the virtualizer and renders rows,
        via VirtualTableHeader above VirtualTableShell.
      </Text>
      <VirtualTableHeader>
        <Table.Tr>
          <Table.Th>Name</Table.Th>
          <Table.Th style={{ width: 120, textAlign: 'right' }}>Value</Table.Th>
        </Table.Tr>
      </VirtualTableHeader>
      <VirtualTableShell
        ref={scrollRef}
        virtualizer={virtualizer}
        maxHeight="12rem"
      >
        {virtualizer.getVirtualItems().map(virtualRow => {
          const row = VIRTUAL_ROWS[virtualRow.index];
          return (
            <Table.Tr
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
            >
              <Table.Td>{row.name}</Table.Td>
              <Table.Td style={{ width: 120, textAlign: 'right' }}>
                {row.value}
              </Table.Td>
            </Table.Tr>
          );
        })}
      </VirtualTableShell>
    </Stack>
  );
}

function VirtualTableDemo() {
  return (
    <Stack gap="xl">
      <DeclarativeDemo />
      <IoCShellDemo />
    </Stack>
  );
}

export function VirtualTablePage() {
  return (
    <ComponentDoc
      title="VirtualTable"
      lead="A windowed table on @tanstack/react-virtual, composed with the kit's Table shadow: the header renders in full and stays stuck to the top, while the body only mounts the rows currently scrolled into view. Ships as two shapes: a self-contained declarative default, and a lower-level inversion-of-control pair for callers that need full row control."
      demo={<VirtualTableDemo />}
      usage={USAGE}
      usageMinHeight={520}
      propsTables={[
        { title: 'VirtualTable props', rows: PROPS_ROWS },
        { title: 'VirtualTableColumn', rows: COLUMN_ROWS },
        { title: 'VirtualTableHeader props', rows: HEADER_ROWS },
        { title: 'VirtualTableShell props', rows: SHELL_ROWS },
      ]}
    >
      <DocSection title="Notes">
        <Text size="sm">
          The declarative VirtualTable pads its body above and below with two
          spacer rows so the native scrollbar reflects the full row count. It
          owns its own virtualizer given items/columns, which makes it directly
          testable but less flexible than a bare virtualization primitive. For
          full control over row rendering, or a virtualizer shared with other
          UI, use VirtualTableHeader + VirtualTableShell instead: the caller
          owns the virtualizer (via useVirtualizer) and renders rows itself.
          Reach for VirtualList when the rows aren&apos;t tabular.
        </Text>
      </DocSection>
    </ComponentDoc>
  );
}
