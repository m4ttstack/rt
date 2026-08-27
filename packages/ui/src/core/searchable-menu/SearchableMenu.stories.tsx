import { Badge, Box, Button, Code, Text } from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { SearchableMenu } from './SearchableMenu';

const meta = {
  title: 'Core/SearchableMenu',
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

// A `type` (not `interface`): `SearchableMenu`'s item generic is bound to
// `Record<string, unknown>` (so `filterKey` can read arbitrary fields), and
// only object-literal `type`s -- not `interface`s, which lack an implicit
// string index signature -- are structurally assignable to that.
type GearItem = {
  id: string;
  name: string;
  location: string;
  onLoan: boolean;
};

const gearItems: GearItem[] = [
  { id: '1', name: 'camera_kit', location: 'Media lab', onLoan: true },
  { id: '2', name: 'tripod_a', location: 'Storage room', onLoan: false },
  { id: '3', name: 'projector_2', location: 'Media lab', onLoan: true },
  { id: '4', name: 'mic_kit', location: 'Storage room', onLoan: false },
  { id: '5', name: 'light_panel', location: 'Front desk', onLoan: false },
];

export const Default: Story = {
  render: () => (
    <Box p="xl">
      <SearchableMenu
        menuTrigger={<Button>Jump to item</Button>}
        title="Gear"
        items={gearItems}
        itemTitle={item => item.name}
        itemSubtitle={item => item.location}
        showItemBadge={item => item.onLoan}
        itemBadgeText="On loan"
      />
    </Box>
  ),
};

// Router-agnostic delta: no router package dependency anywhere in this kit,
// so each item's link component is supplied polymorphically -- here, a
// plain `<a>`. A consuming app would instead pass its own router's `Link`.
export const WithCustomLinkComponent: Story = {
  render: () => (
    <Box p="xl">
      <SearchableMenu
        menuTrigger={<Button>Jump to item (linked)</Button>}
        title="Gear"
        items={gearItems}
        itemTitle={item => item.name}
        component="a"
        getItemProps={item => ({ href: `#/gear/${item.id}` })}
      />
      <Text size="sm" mt="md" c="dimmed">
        Each item is a real <Code>{'<a href>'}</Code>, not a click handler --
        inspect the rendered DOM.
      </Text>
    </Box>
  ),
};

export const WithBadgesAndPin: Story = {
  render: () => (
    <Box p="xl">
      <SearchableMenu
        menuTrigger={
          <Button>
            Gear <Badge ml="xs">{gearItems.length}</Badge>
          </Button>
        }
        title="Gear"
        items={gearItems}
        itemTitle={item => item.name}
        isSelectedItem={item => item.id === '1'}
        showItemBadge={() => true}
        itemBadgeColor={item => (item.onLoan ? 'orange' : 'gray')}
        itemBadgeText={item => (item.onLoan ? 'on loan' : 'available')}
      />
    </Box>
  ),
};

// `filterKey` widens the search past `itemTitle` to other fields (here,
// `location` too) -- try typing "media" or "storage". Matched substrings,
// wherever they occur, render highlighted in the title.
export const WithMultiFieldFilterAndHighlight: Story = {
  render: () => (
    <Box p="xl">
      <SearchableMenu
        menuTrigger={<Button>Search name or location</Button>}
        title="Gear"
        items={gearItems}
        itemTitle={item => item.name}
        itemSubtitle={item => item.location}
        filterKey={['name', 'location']}
      />
      <Text size="sm" mt="md" c="dimmed">
        Type &quot;media&quot; or &quot;storage&quot; -- it matches{' '}
        <Code>location</Code>, not just <Code>name</Code>.
      </Text>
    </Box>
  ),
};

// `isItemPinned` sorts matching items first and marks them with a pin icon;
// `toolbar` renders a slot above the title bar.
export const WithPinningAndToolbar: Story = {
  render: () => (
    <Box p="xl">
      <SearchableMenu
        menuTrigger={<Button>Gear (on-loan pinned)</Button>}
        title="Gear"
        items={gearItems}
        itemTitle={item => item.name}
        itemSubtitle={item => item.location}
        isItemPinned={item => item.onLoan}
        toolbar={
          <Text size="xs" c="dimmed" px={4} pb={4}>
            On-loan items are pinned to the top.
          </Text>
        }
      />
    </Box>
  ),
};

// `withChevron` renders the kit's `AnimatedChevron` next to the trigger,
// flipping open/closed with the menu.
export const WithChevron: Story = {
  render: () => (
    <Box p="xl">
      <SearchableMenu
        menuTrigger={<Button>Gear</Button>}
        withChevron
        title="Gear"
        items={gearItems}
        itemTitle={item => item.name}
      />
    </Box>
  ),
};
