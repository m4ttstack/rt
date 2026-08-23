import { useState } from 'react';

import { Badge, Button, Group, SelectableList, Stack, Text } from '@ui/core';
import { ComponentDoc, DemoFrame } from '../../ComponentDoc';
import { DocSection } from '../../DocPage';

const USAGE = [
  "import { SelectableList } from '@ui/core';",
  '',
  '// Uncontrolled: the list owns its selection; onSelect reports the',
  '// currently-selected item objects after every toggle.',
  '<SelectableList',
  '  items={gear}',
  '  getItemProps={item => ({ key: item.id, label: item.name })}',
  '  onSelect={selected => setCheckoutCart(selected)}',
  '/>;',
  '',
  '// Controlled: the parent owns the key set via selectedKeys +',
  '// onSelectionChange (onSelect still fires with the item objects).',
  '<SelectableList',
  '  items={gear}',
  '  getItemProps={item => ({ key: item.id, label: item.name })}',
  '  selectedKeys={selectedKeys}',
  '  onSelectionChange={setSelectedKeys}',
  '/>;',
].join('\n');

// Rows transcribed from src/ui/core/selectable-list/SelectableList.tsx
// (SelectableListProps).
const PROPS_ROWS = [
  {
    name: 'items',
    type: 'T[]',
    note: 'Required. The full item list; the built-in search box filters it by label.',
  },
  {
    name: 'getItemProps',
    type: '(item: T) => SelectableListItemProps',
    note: 'Required. Extracts the key/label (and optional custom rendering) for an item.',
  },
  {
    name: 'onSelect?',
    type: '(selectedItems: T[]) => void',
    note: 'Called with the full set of currently-selected items (resolved against the current search filter) whenever the user changes the selection. Fires in both controlled and uncontrolled modes.',
  },
  {
    name: 'selectedKeys?',
    type: 'string[]',
    note: 'Controlled selection, as item keys. Omit to let the list manage its own selection state.',
  },
  {
    name: 'onSelectionChange?',
    type: '(keys: string[]) => void',
    note: 'Called with the next key set whenever selection changes -- the controlled companion to selectedKeys (also fires in uncontrolled mode, alongside onSelect).',
  },
  {
    name: 'noItemsMessage?',
    type: 'string',
    note: "Shown instead of the list when items is empty. Default 'No items.'",
  },
  {
    name: 'headerItem?',
    type: 'ReactNode',
    note: 'Extra content in the header row, next to the search box.',
  },
  {
    name: 'maxHeight?',
    type: 'string | number',
    note: "Max height of the scrollable row area. Default '20rem'.",
  },
  {
    name: 'className? / style?',
    type: 'string / CSSProperties',
    note: 'Land on the root element (merged with the kit surface styles) in both the populated and empty states.',
  },
];

// Rows transcribed from src/ui/core/selectable-list/SelectableList.tsx
// (SelectableListItemProps).
const ITEM_PROPS_ROWS = [
  {
    name: 'key',
    type: 'string',
    note: 'Required. Stable identity for the item -- selection state is tracked by this key.',
  },
  {
    name: 'label',
    type: 'string',
    note: 'Required. Text shown for the item, also matched against the search filter.',
  },
  {
    name: 'displayElement?',
    type: 'ReactNode',
    note: 'Optional custom rendering for the row, instead of the plain label.',
  },
];

const DEMO_GEAR = [
  { id: 'field_camera_a', name: 'field_camera_a', category: 'Cameras' },
  { id: 'studio_camera', name: 'studio_camera', category: 'Cameras' },
  { id: 'podcast_mic_kit', name: 'podcast_mic_kit', category: 'Audio' },
  { id: 'field_recorder', name: 'field_recorder', category: 'Audio' },
  { id: 'light_panel_a', name: 'light_panel_a', category: 'Lighting' },
  { id: 'ring_light', name: 'ring_light', category: 'Lighting' },
  { id: 'tripod_a', name: 'tripod_a', category: 'Support' },
  { id: 'slider_rig', name: 'slider_rig', category: 'Support' },
];

type DemoGearItem = (typeof DEMO_GEAR)[number];

const getDemoItemProps = (item: DemoGearItem) => ({
  key: item.id,
  label: item.name,
});

/** Uncontrolled: the list owns the key set; onSelect reports item objects. */
function UncontrolledDemo() {
  const [selected, setSelected] = useState<DemoGearItem[]>([]);

  return (
    <Stack gap="sm">
      <SelectableList
        items={DEMO_GEAR}
        getItemProps={getDemoItemProps}
        onSelect={setSelected}
        maxHeight="14rem"
      />
      <Text size="sm" c="dimmed">
        onSelect reported {selected.length} selected item
        {selected.length === 1 ? '' : 's'}
        {selected.length > 0
          ? `: ${selected.map(item => item.name).join(', ')}`
          : '.'}
      </Text>
    </Stack>
  );
}

/** Controlled: the parent owns selectedKeys and can set them from outside. */
function ControlledDemo() {
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);

  return (
    <Stack gap="sm">
      <Group gap="xs">
        <Button
          size="xs"
          variant="light"
          onClick={() =>
            setSelectedKeys(
              DEMO_GEAR.filter(item => item.category === 'Cameras').map(
                item => item.id
              )
            )
          }
        >
          Select the cameras
        </Button>
        <Button size="xs" variant="default" onClick={() => setSelectedKeys([])}>
          Clear
        </Button>
      </Group>
      <SelectableList
        items={DEMO_GEAR}
        getItemProps={getDemoItemProps}
        selectedKeys={selectedKeys}
        onSelectionChange={setSelectedKeys}
        maxHeight="14rem"
      />
      <Group gap={4}>
        <Text size="sm" c="dimmed">
          selectedKeys:
        </Text>
        {selectedKeys.length === 0 ? (
          <Text size="sm" c="dimmed">
            []
          </Text>
        ) : (
          selectedKeys.map(key => (
            <Badge key={key} variant="light" size="sm">
              {key}
            </Badge>
          ))
        )}
      </Group>
    </Stack>
  );
}

export function SelectableListPage() {
  return (
    <ComponentDoc
      title="SelectableList"
      lead="A searchable, checkbox-selectable, virtualized list: a header row (select all, item count, search box) over a windowed body of rows, each with its own checkbox. Selection is uncontrolled by default or controlled via selectedKeys/onSelectionChange."
      demoIntro="Uncontrolled mode: the list owns its selection state. Toggle rows, use the select-all checkbox, or narrow with the search box -- onSelect reports the resulting item objects below."
      demo={<UncontrolledDemo />}
      usage={USAGE}
      usageMinHeight={480}
      propsTables={[
        { title: 'Props', rows: PROPS_ROWS },
        {
          title: 'SelectableListItemProps',
          intro: 'The shape getItemProps returns for each item.',
          rows: ITEM_PROPS_ROWS,
        },
      ]}
    >
      <DocSection title="Controlled selection">
        <Text size="sm">
          Pass selectedKeys (with onSelectionChange) and the parent owns the key
          set -- external UI can change the selection and the list follows. The
          two modes share one bridge (Mantine&apos;s useUncontrolled):
          onSelectionChange fires with the next key set in both modes, and
          onSelect keeps firing with the resolved item objects after every user
          toggle, so an uncontrolled caller can later adopt selectedKeys without
          rewiring its handlers.
        </Text>
        <DemoFrame>
          <ControlledDemo />
        </DemoFrame>
      </DocSection>
      <DocSection title="Notes">
        <Text size="sm">
          Select-all and onSelect resolve against the currently-filtered rows:
          with a search filter active, select-all selects only the visible
          matches, and onSelect reports only selected items that match the
          filter. Rows are windowed through the kit&apos;s VirtualList, so long
          lists mount only their visible rows. The component brings its own
          bg.level2 surface (hairline border, theme radius) -- no wrapping Paper
          needed -- and row tints are tokens only: the primary -light tint for
          selected rows, the bg.level3 slot for unselected hover.
        </Text>
      </DocSection>
    </ComponentDoc>
  );
}
