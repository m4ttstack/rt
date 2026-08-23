import { useState } from 'react';

import { Badge, Stack, Switch, Table, Text } from '@ui/core';
import { ComponentDoc } from '../../ComponentDoc';
import { DocSection } from '../../DocPage';

const USAGE = [
  "import { Table } from '@ui/core';",
  '',
  '// The kit shadow: a Paper-wrapped table with a bg.level4 header accent.',
  '// Compound statics: Mantine-native names, plus role aliases',
  '// (Table.Header/Row/Cell/HeaderCell/Body/Footer) for either vocabulary.',
  '<Table.ScrollContainer minWidth={480}>',
  '  <Table stickyHeader>',
  '    <Table.Thead>',
  '      <Table.Tr>',
  '        <Table.Th>Item</Table.Th>',
  '        <Table.Th>Status</Table.Th>',
  '      </Table.Tr>',
  '    </Table.Thead>',
  '    <Table.Tbody>{rows}</Table.Tbody>',
  '  </Table>',
  '</Table.ScrollContainer>',
].join('\n');

// Rows transcribed from src/ui/core/table/Table.tsx (TableProps).
const PROPS_ROWS = [
  {
    name: 'noPaper?',
    type: 'boolean',
    note: 'Renders the bare <table> with no wrapping Paper surface. Default false.',
  },
  {
    name: 'headerAccent?',
    type: 'boolean',
    note: "Tints Table.Thead with the kit's bg.level4 background token instead of a flat/transparent header, and gives stickyHeader an opaque background to scroll under. Default true.",
  },
  {
    name: 'withTableBorder?',
    type: 'boolean',
    note: 'Outer border, on the Paper wrapper (or the table itself when noPaper). Default false.',
  },
  {
    name: 'shadow?',
    type: 'boolean',
    note: 'Shadow on the Paper wrapper; ignored when noPaper. Default false.',
  },
  {
    name: 'fullWidth?',
    type: 'boolean',
    note: 'Stretches the table to the width of its container. Default false.',
  },
  {
    name: 'padding? / radius?',
    type: 'MantineSpacing / MantineRadius',
    note: 'Padding and corner radius of the Paper wrapper. Ignored when noPaper.',
  },
  {
    name: 'paperChildren?',
    type: 'ReactNode',
    note: 'Extra content inside the Paper, above the table (a toolbar, caption row). Ignored when noPaper.',
  },
  {
    name: '...rest',
    type: 'MantineTableProps',
    note: "Passthrough, on top of kit defaults verticalSpacing 'sm', horizontalSpacing 'sm', withRowBorders true. stickyHeader/stickyHeaderOffset are Mantine's own props, passed through unchanged.",
  },
];

const SAMPLE_GEAR = [
  { id: 1, name: 'camera_kit', status: 'available' },
  { id: 2, name: 'tripod_a', status: 'repair due' },
  { id: 3, name: 'projector_2', status: 'available' },
] as const;

function TableDemo() {
  const [headerAccent, setHeaderAccent] = useState(true);
  const [withTableBorder, setWithTableBorder] = useState(false);

  return (
    <Stack gap="sm">
      <Table.ScrollContainer minWidth={320}>
        <Table headerAccent={headerAccent} withTableBorder={withTableBorder}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Item</Table.Th>
              <Table.Th>Status</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {SAMPLE_GEAR.map(item => (
              <Table.Tr key={item.id}>
                <Table.Td>{item.name}</Table.Td>
                <Table.Td>
                  <Badge
                    color={item.status === 'available' ? 'green' : 'orange'}
                  >
                    {item.status}
                  </Badge>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      <Switch
        label="headerAccent"
        checked={headerAccent}
        onChange={event => setHeaderAccent(event.currentTarget.checked)}
      />
      <Switch
        label="withTableBorder"
        checked={withTableBorder}
        onChange={event => setWithTableBorder(event.currentTarget.checked)}
      />
    </Stack>
  );
}

export function TablePage() {
  return (
    <ComponentDoc
      title="Table"
      lead="The kit's Table shadow: Mantine's Table wrapped in a Paper surface (rounded corners, clipped overflow) with a scheme-aware bg.level4 header accent, so a table reads as a distinct surface the way Paper/Card do elsewhere in the kit."
      demo={<TableDemo />}
      usage={USAGE}
      usageMinHeight={330}
      propsTables={[{ title: 'Props', rows: PROPS_ROWS }]}
    >
      <DocSection title="Notes">
        <Text size="sm">
          This is a shadow: importing Table from @ui/core gets this component,
          and the import wall bans reaching for Mantine&apos;s original by name
          anywhere in src/. The compound statics (Table.Thead, Table.Tr,
          Table.ScrollContainer, Table.DataRenderer, ...) mirror
          @mantine/core&apos;s completely, and the ref forwards to the
          underlying HTMLTableElement. For thousands of rows, use VirtualTable,
          which composes this shadow with windowed rendering.
        </Text>
      </DocSection>
    </ComponentDoc>
  );
}
