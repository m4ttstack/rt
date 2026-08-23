import { Button, SearchableMenu, Text } from '@ui/core';
import { Icon } from '@ui/icons';
import { notifications } from '@ui/notifications';
import { ComponentDoc } from '../../ComponentDoc';
import { DocSection } from '../../DocPage';

const USAGE = [
  "import { SearchableMenu } from '@ui/core';",
  '',
  '<SearchableMenu',
  '  menuTrigger={<Button variant="light">Browse gear</Button>}',
  '  title="Gear"',
  '  items={gear}',
  '  itemTitle={item => item.name}',
  '  itemSubtitle={item => item.category}',
  "  showItemBadge={item => item.status !== 'available'}",
  '  itemBadgeText={item => item.status}',
  '  onItemClick={item => openGearItem(item)}',
  '  // Search matches name AND location, not just the title.',
  "  filterKey={['name', 'location']}",
  '  // On-loan items sort first and show a pin icon.',
  "  isItemPinned={item => item.status === 'on loan'}",
  '/>;',
  '',
  '// Router-agnostic linking: render each row as your link component.',
  '<SearchableMenu',
  '  // ...',
  '  component={Link}',
  '  getItemProps={item => ({ href: `/gear/${item.id}` })}',
  '/>;',
].join('\n');

// Rows transcribed from src/ui/core/searchable-menu/SearchableMenu.tsx
// (SearchableMenuProps).
const PROPS_ROWS = [
  {
    name: 'menuTrigger',
    type: 'ReactNode',
    note: 'Required. The element that opens the menu (passed to Menu.Target).',
  },
  {
    name: 'title',
    type: 'string',
    note: 'Required. Title-bar text; also seeds the default search placeholder and empty messages.',
  },
  {
    name: 'titleIcon?',
    type: 'ReactNode',
    note: 'Icon rendered before the title in the title bar.',
  },
  {
    name: 'items',
    type: 'T[]',
    note: 'Required. The full item list; the search box filters it by itemTitle.',
  },
  {
    name: 'itemTitle',
    type: '(item: T) => string',
    note: "Required. An item's primary text -- also the string the filter matches against.",
  },
  {
    name: 'itemSubtitle?',
    type: '(item: T, filterKeyword?: string) => ReactNode',
    note: 'Dimmed second line under the title; also receives the current search text.',
  },
  {
    name: 'isSelectedItem?',
    type: '(item: T) => boolean',
    note: "Tints the row with the theme's calm primary -light tint (same as SelectableList's selected rows).",
  },
  {
    name: 'showItemBadge? / itemBadgeText? / itemBadgeColor?',
    type: 'per-item fns (text also plain string)',
    note: 'Optional right-aligned Badge per row: whether it shows, its text, and its Mantine color.',
  },
  {
    name: 'onItemClick?',
    type: '(item: T) => void',
    note: 'Called when a row is clicked.',
  },
  {
    name: 'renderItem?',
    type: '(item: T, index: number) => ReactNode',
    note: "Escape hatch #1: fully own a row's rendering (e.g. wrap it in a router Link). Replaces the built-in Menu.Item row entirely for every item.",
  },
  {
    name: 'component? / getItemProps?',
    type: 'ElementType / (item) => props',
    note: 'Escape hatch #2: the element type each Menu.Item renders as (Mantine\'s Menu.Item is polymorphic) plus extra per-item props -- e.g. component="a" with { href }, or a router Link with { to }.',
  },
  {
    name: 'onViewAllClick?',
    type: '() => void',
    note: 'Shows a "View All" button in the title bar; clicking it closes the menu.',
  },
  {
    name: 'hideTitleBar?',
    type: 'boolean',
    note: 'Drops the title row entirely. Default false.',
  },
  {
    name: 'loading?',
    type: 'boolean',
    note: 'Disables the search box and replaces the list with a centered Loader. Default false.',
  },
  {
    name: 'emptyMessage?',
    type: 'string',
    note: 'Overrides the built-in "No <title>." / "No <title> found." empty states.',
  },
  {
    name: 'position?',
    type: "MenuProps['position']",
    note: "Dropdown position. Default 'bottom-start'.",
  },
  {
    name: 'filterPlaceholder?',
    type: '(title: string) => string',
    note: "Custom search placeholder. Default 'Search <title>...'.",
  },
  {
    name: 'filterKey?',
    type: 'string | string[]',
    note: 'Field(s) to search instead of itemTitle (dot paths allowed, e.g. "location.building"). Matched substrings render highlighted in the title.',
  },
  {
    name: 'isItemPinned?',
    type: '(item: T) => boolean',
    note: 'Pinned items sort before unpinned ones and show a pin icon on their row.',
  },
  {
    name: 'toolbar?',
    type: 'ReactNode',
    note: 'Slot rendered at the top of the dropdown, above the title bar.',
  },
  {
    name: 'withChevron?',
    type: 'boolean',
    note: 'Renders an AnimatedChevron next to menuTrigger that flips when the menu opens. Default false.',
  },
  {
    name: 'transitionProps?',
    type: "MenuProps['transitionProps']",
    note: "Open/close transition. Default { duration: 100, timingFunction: 'ease', transition: 'pop-top-left' }.",
  },
  {
    name: 'virtualListProps?',
    type: 'Partial<VirtualListProps<T>>',
    note: 'Passthrough to the inner VirtualList (e.g. to override estimateSize or maxHeight).',
  },
];

const DEMO_GEAR = [
  {
    name: 'field_camera_a',
    category: 'Cameras',
    location: 'Media lab',
    status: 'available',
  },
  {
    name: 'studio_camera',
    category: 'Cameras',
    location: 'Media lab',
    status: 'on loan',
  },
  {
    name: 'podcast_mic_kit',
    category: 'Audio',
    location: 'Storage room',
    status: 'available',
  },
  {
    name: 'field_recorder',
    category: 'Audio',
    location: 'Storage room',
    status: 'on loan',
  },
  {
    name: 'light_panel_a',
    category: 'Lighting',
    location: 'Front desk',
    status: 'repair due',
  },
  {
    name: 'ring_light',
    category: 'Lighting',
    location: 'Media lab',
    status: 'available',
  },
  {
    name: 'tripod_a',
    category: 'Support',
    location: 'Storage room',
    status: 'available',
  },
  {
    name: 'slider_rig',
    category: 'Support',
    location: 'Front desk',
    status: 'available',
  },
];

function SearchableMenuDemo() {
  return (
    <SearchableMenu
      menuTrigger={<Button variant="light">Browse gear</Button>}
      withChevron
      title="Gear"
      titleIcon={<Icon name="package" />}
      items={DEMO_GEAR}
      itemTitle={item => item.name}
      itemSubtitle={item => item.location}
      showItemBadge={item => item.status !== 'available'}
      itemBadgeText={item => item.status}
      itemBadgeColor={() => 'orange'}
      // Matches on name OR location -- try "media" or "storage".
      filterKey={['name', 'location']}
      // On-loan gear sorts first and gets a pin icon.
      isItemPinned={item => item.status === 'on loan'}
      toolbar={
        <Text size="xs" c="dimmed" px={4} pb={4}>
          On-loan items are pinned to the top.
        </Text>
      }
      onItemClick={item => notifications.info(`Opened ${item.name}`)}
      onViewAllClick={() => notifications.info('View All clicked')}
    />
  );
}

export function SearchableMenuPage() {
  return (
    <ComponentDoc
      title="SearchableMenu"
      lead="A search-filterable dropdown menu: click the trigger to open a dropdown with a search box over a virtualized result list, with optional per-row subtitles, badges, pinning, and selected tints."
      demoIntro="Open the menu and type in the search box (try 'media' or 'storage' -- it matches name and location, and highlights the match). On-loan gear is pinned to the top with a pin icon."
      demo={<SearchableMenuDemo />}
      usage={USAGE}
      usageMinHeight={480}
      propsTables={[{ title: 'Props', rows: PROPS_ROWS }]}
    >
      <DocSection title="Notes">
        <Text size="sm">
          Filtering matches itemTitle case-insensitively by default; pass
          filterKey (a field name, dot path, or array of them) to match against
          other item fields instead -- the matched substring still renders
          highlighted in the title via Mantine&apos;s Highlight. The result list
          is windowed through the kit&apos;s VirtualList (capped at 70dvh), so a
          long item set stays cheap. The component is router-agnostic by design:
          renderItem fully owns a row, or component/getItemProps plug a link
          element into the built-in row -- with a typed router, wrap through
          createLink() per AGENTS.md section 10.
        </Text>
      </DocSection>
    </ComponentDoc>
  );
}
