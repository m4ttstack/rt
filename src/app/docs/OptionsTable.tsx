import { Table, Text } from '@ui/core';

export interface OptionRow {
  name: string;
  type: string;
  note: string;
}

/** Option/prop reference table shared by the docs pages (modals,
 * notifications, forms). Rows are transcribed from the actual source under
 * src/ui/** -- keep them in sync when the kit surface changes. */
export function OptionsTable({ rows }: { rows: OptionRow[] }) {
  return (
    <Table.ScrollContainer minWidth={520}>
      <Table>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Option</Table.Th>
            <Table.Th>Type</Table.Th>
            <Table.Th>Behavior</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map(({ name, type, note }) => (
            <Table.Tr key={name}>
              <Table.Td>
                <Text size="sm" ff="monospace">
                  {name}
                </Text>
              </Table.Td>
              <Table.Td>
                <Text size="sm" ff="monospace" c="dimmed">
                  {type}
                </Text>
              </Table.Td>
              <Table.Td>
                <Text size="sm">{note}</Text>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}
