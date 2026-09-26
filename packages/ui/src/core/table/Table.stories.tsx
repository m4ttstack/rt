import type { Meta, StoryObj } from '@storybook/react-vite';

import { Table } from './Table';

// No `component` on `meta` -- these are plain `render` demos, not
// args-driven (see PageShell.stories.tsx for why).
const meta = {
  title: 'Core/Table',
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

const rows = [
  { name: 'camera_kit', category: 'Video', weight: '2.1 kg' },
  { name: 'field_recorder', category: 'Audio', weight: '0.6 kg' },
  { name: 'tripod_carbon', category: 'Support', weight: '1.4 kg' },
];

function DemoRows() {
  return (
    <>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Name</Table.Th>
          <Table.Th>Category</Table.Th>
          <Table.Th>Weight</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {rows.map(row => (
          <Table.Tr key={row.name}>
            <Table.Td>{row.name}</Table.Td>
            <Table.Td>{row.category}</Table.Td>
            <Table.Td>{row.weight}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </>
  );
}

export const Default: Story = {
  name: 'Default (Paper surface + header accent)',
  render: () => (
    <Table>
      <DemoRows />
    </Table>
  ),
};

export const NoPaper: Story = {
  name: 'noPaper (bare table)',
  render: () => (
    <Table noPaper>
      <DemoRows />
    </Table>
  ),
};

export const PlainHeader: Story = {
  name: 'headerAccent={false}',
  render: () => (
    <Table headerAccent={false}>
      <DemoRows />
    </Table>
  ),
};

export const BorderedAndShadowed: Story = {
  name: 'withTableBorder + shadow',
  render: () => (
    <Table withTableBorder shadow>
      <DemoRows />
    </Table>
  ),
};
