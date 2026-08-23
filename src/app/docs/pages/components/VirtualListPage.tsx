import { Group, Stack, Text, VirtualList } from '@ui/core';
import { ComponentDoc } from '../../ComponentDoc';
import { DocSection } from '../../DocPage';

const USAGE = [
  "import { VirtualList } from '@ui/core';",
  '',
  '<VirtualList',
  '  items={rows}',
  '  getItemKey={row => row.id}',
  '  estimateSize={() => 32}',
  '  maxHeight="12rem"',
  '  renderRow={row => (',
  '    <Group justify="space-between" px="sm" py={4}>',
  '      <Text size="sm">{row.name}</Text>',
  '    </Group>',
  '  )}',
  '/>',
].join('\n');

// Rows transcribed from src/ui/core/virtual-list/VirtualList.tsx
// (VirtualListProps<T>).
const PROPS_ROWS = [
  {
    name: 'items',
    type: 'T[]',
    note: 'Required. Only the items currently in view (plus overscan) are mounted.',
  },
  {
    name: 'renderRow',
    type: '(item, index) => ReactNode',
    note: 'Required. Renders a single item.',
  },
  {
    name: 'estimateSize?',
    type: '(index) => number',
    note: 'Estimated row height in px, used before a row is actually measured; can vary per index. Default () => 45.',
  },
  {
    name: 'overscan?',
    type: 'number',
    note: 'Rows to render above/below the visible window. Default 20.',
  },
  {
    name: 'maxHeight? / minHeight?',
    type: 'string | number',
    note: "Bounds of the scrollable viewport. Defaults '20vh' / 'auto'.",
  },
  {
    name: 'getItemKey?',
    type: '(item, index) => string | number',
    note: 'Key for each item; defaults to its index.',
  },
  {
    name: 'scrollAreaProps?',
    type: 'ScrollAreaAutosizeProps',
    note: 'Extra props for the outer ScrollArea.Autosize (viewportRef excluded: the virtualizer owns the viewport ref).',
  },
];

const VIRTUAL_ROWS = Array.from({ length: 5000 }, (_, index) => ({
  id: index,
  name: `row-${index}`,
  value: Math.round(Math.sin(index) * 1000),
}));

function VirtualListDemo() {
  return (
    <Stack gap="sm">
      <Text size="sm" c="dimmed">
        {VIRTUAL_ROWS.length.toLocaleString()} rows; only the visible window is
        ever mounted, and the scrollbar still reflects the full count.
      </Text>
      <VirtualList
        items={VIRTUAL_ROWS}
        getItemKey={row => row.id}
        estimateSize={() => 32}
        maxHeight="12rem"
        renderRow={row => (
          <Group justify="space-between" px="sm" py={4}>
            <Text size="sm">{row.name}</Text>
            <Text size="sm" c="dimmed">
              {row.value}
            </Text>
          </Group>
        )}
      />
    </Stack>
  );
}

export function VirtualListPage() {
  return (
    <ComponentDoc
      title="VirtualList"
      lead="Windowed list on @tanstack/react-virtual: only the rows currently scrolled into view (plus overscan) are ever mounted, so items can hold tens of thousands of rows without tens of thousands of DOM nodes."
      demo={<VirtualListDemo />}
      usage={USAGE}
      usageMinHeight={330}
      propsTables={[{ title: 'Props', rows: PROPS_ROWS }]}
    >
      <DocSection title="Notes">
        <Text size="sm">
          Rows are measured after mount, so estimateSize only needs to be close
          -- the virtualizer corrects as rows render. For tabular data with
          typed columns and a sticky header, use VirtualTable instead.
        </Text>
      </DocSection>
    </ComponentDoc>
  );
}
