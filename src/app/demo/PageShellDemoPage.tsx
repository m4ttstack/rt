import { useState } from 'react';
import { Link } from 'wouter';

import {
  Badge,
  Box,
  Button,
  NavLink,
  Notch,
  PageShell,
  Rail,
  RailEntry,
  RailShell,
  Stack,
  Switch,
  Table,
  Text,
  useRailState,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';

const APP_HEADER_HEIGHT = 64;

type GearStatus = 'available' | 'on loan' | 'repair due';

interface GearItem {
  id: string;
  name: string;
  category: string;
  location: string;
  status: GearStatus;
}

const GEAR_CATEGORIES = ['Cameras', 'Audio', 'Lighting', 'Support'] as const;

const GEAR_ITEMS: GearItem[] = [
  ['field_camera_a', 'Cameras', 'Media lab', 'available'],
  ['field_camera_b', 'Cameras', 'Media lab', 'on loan'],
  ['studio_camera', 'Cameras', 'Storage room', 'available'],
  ['action_cam', 'Cameras', 'Front desk', 'repair due'],
  ['lens_kit_35mm', 'Cameras', 'Storage room', 'available'],
  ['podcast_mic_kit', 'Audio', 'Media lab', 'on loan'],
  ['lav_mic_pair', 'Audio', 'Storage room', 'available'],
  ['field_recorder', 'Audio', 'Media lab', 'available'],
  ['boom_pole', 'Audio', 'Storage room', 'available'],
  ['monitor_headphones', 'Audio', 'Front desk', 'on loan'],
  ['light_panel_a', 'Lighting', 'Storage room', 'available'],
  ['light_panel_b', 'Lighting', 'Media lab', 'repair due'],
  ['ring_light', 'Lighting', 'Front desk', 'available'],
  ['softbox_kit', 'Lighting', 'Storage room', 'available'],
  ['color_gel_set', 'Lighting', 'Storage room', 'available'],
  ['travel_tripod', 'Support', 'Front desk', 'on loan'],
  ['heavy_tripod', 'Support', 'Storage room', 'available'],
  ['monopod', 'Support', 'Storage room', 'available'],
  ['slider_rail', 'Support', 'Media lab', 'repair due'],
  ['gimbal_rig', 'Support', 'Media lab', 'available'],
].map(([name, category, location, status]) => ({
  id: name,
  name,
  category,
  location,
  status: status as GearStatus,
}));

const STATUS_COLOR: Record<GearStatus, string> = {
  available: 'green',
  'on loan': 'blue',
  'repair due': 'orange',
};

/** The rail content riding the shell's navbar slot: the kit `Rail` with
 * the gear-library sections (only Inventory is live in this demo). */
function MiniRail({
  expanded,
  onToggleExpanded,
}: {
  expanded: boolean;
  onToggleExpanded: () => void;
}) {
  return (
    <Rail
      label="Gear app navigation"
      expanded={expanded}
      onToggleExpanded={onToggleExpanded}
    >
      <RailEntry icon="package" label="Inventory" expanded={expanded} active />
      <RailEntry
        icon="users"
        label="Borrow requests"
        expanded={expanded}
        disabled
      />
      <RailEntry
        icon="wrench"
        label="Maintenance"
        expanded={expanded}
        disabled
      />
      <RailEntry
        icon="settings"
        label="Settings"
        expanded={expanded}
        disabled
      />
    </Rail>
  );
}

/** The category filter list living in the PageShell's own sidebar. */
function CategoryNav({
  selected,
  onSelect,
}: {
  selected: string | null;
  onSelect: (category: string | null) => void;
}) {
  const countFor = (category: string | null) =>
    category === null
      ? GEAR_ITEMS.length
      : GEAR_ITEMS.filter(item => item.category === category).length;

  const entries: { label: string; value: string | null }[] = [
    { label: 'All gear', value: null },
    ...GEAR_CATEGORIES.map(category => ({ label: category, value: category })),
  ];

  return (
    <Stack gap={2} p="md" component="nav" aria-label="Gear categories">
      <Text size="xs" fw={700} c="dimmed" tt="uppercase" px="sm" pb={4}>
        Categories
      </Text>
      {entries.map(({ label, value }) => (
        <NavLink
          key={label}
          component="button"
          label={label}
          active={selected === value}
          onClick={() => onSelect(value)}
          rightSection={
            <Badge size="sm" variant="light" color="gray">
              {countFor(value)}
            </Badge>
          }
          style={{ borderRadius: 'var(--mantine-radius-md)' }}
        />
      ))}
    </Stack>
  );
}

function GearTable({ items }: { items: GearItem[] }) {
  // ScrollContainer keeps narrow (mobile) viewports from growing a
  // page-level horizontal scrollbar: the four columns scroll inside the
  // table's own frame instead.
  return (
    <Table.ScrollContainer minWidth={480}>
      <Table stickyHeader verticalSpacing="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Item</Table.Th>
            <Table.Th>Category</Table.Th>
            <Table.Th>Location</Table.Th>
            <Table.Th>Status</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {items.map(item => (
            <Table.Tr key={item.id}>
              <Table.Td>{item.name}</Table.Td>
              <Table.Td>{item.category}</Table.Td>
              <Table.Td>{item.location}</Table.Td>
              <Table.Td>
                <Badge color={STATUS_COLOR[item.status]}>{item.status}</Badge>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

/**
 * The full-screen compound-PageShell showcase ('/demo/page-shell'),
 * rendered without the site's chrome. Double-nav geometry:
 * an app-level mini icon rail (`RailShell`, the same shell the site chrome
 * rides, animating between slim and expanded) wrapping a page-level
 * PageShell with its own collapsible category sidebar (deliberately not
 * persisted: the showcase opens expanded on every visit).
 *
 * The scroll-mode switch in the shell header flips between the content
 * area's own capped scroll frame (default) and `scrollClamp`, where the
 * table manages its inner scrolling against the render-prop height.
 */
export function PageShellDemoPage() {
  const rail = useRailState();
  const [category, setCategory] = useState<string | null>(null);
  const [bannerOpened, setBannerOpened] = useState(true);
  const [scrollClamp, setScrollClamp] = useState(false);

  const items =
    category === null
      ? GEAR_ITEMS
      : GEAR_ITEMS.filter(item => item.category === category);

  return (
    <RailShell
      headerHeight={APP_HEADER_HEIGHT}
      headerPx="sm"
      header={
        <>
          <Text fw={600}>Gear library</Text>
          <Text size="sm" c="dimmed" visibleFrom="sm">
            full-screen PageShell demo
          </Text>
          <Button
            component={Link}
            href="/docs/components"
            variant="default"
            size="sm"
            ml="auto"
            leftSection={<Icon name="minimize" size={16} />}
          >
            Exit full screen
          </Button>
        </>
      }
      rail={
        <MiniRail
          expanded={rail.effectiveExpanded}
          onToggleExpanded={rail.toggleExpanded}
        />
      }
      railExpanded={rail.effectiveExpanded}
      railOpened={rail.opened}
      onToggleRail={rail.toggleOpened}
      onCloseRail={rail.close}
    >
      <PageShell
        topOffset={APP_HEADER_HEIGHT}
        sidebarWidth={280}
        scrollClamp={scrollClamp}
      >
        <PageShell.Sidebar>
          <CategoryNav selected={category} onSelect={setCategory} />
        </PageShell.Sidebar>
        <PageShell.Main>
          <PageShell.Header
            title="Inventory"
            actions={
              <>
                {!bannerOpened && (
                  <Button
                    // The header row is a fixed-height nowrap Group; on
                    // phone widths this reopen affordance would clip the
                    // clamp switch (the screen's core control) out of it.
                    visibleFrom="sm"
                    variant="light"
                    size="sm"
                    onClick={() => setBannerOpened(true)}
                  >
                    Show notice
                  </Button>
                )}
                <Switch
                  label="Clamp scroll"
                  checked={scrollClamp}
                  onChange={event =>
                    setScrollClamp(event.currentTarget.checked)
                  }
                />
              </>
            }
          />
          <PageShell.Content
            topNotch={{
              content: (
                <Notch onClose={() => setBannerOpened(false)}>
                  <Text size="sm">
                    Inventory audit runs Friday. Items marked repair due are
                    pulled from circulation until the maintenance pass wraps.
                  </Text>
                </Notch>
              ),
              opened: bannerOpened,
            }}
          >
            {() =>
              scrollClamp ? (
                // Clamp mode: the content frame is fixed-height and
                // overflow-hidden, so the table brings its own scroll.
                <Box
                  p="lg"
                  flex={1}
                  mih={0}
                  style={{ overflowY: 'auto' }}
                  data-testid="clamped-scroll-frame"
                >
                  <GearTable items={items} />
                </Box>
              ) : (
                // Scroll mode: Content's own ContentContainer supplies the
                // padded, capped column, so the table needs no wrapper.
                <GearTable items={items} />
              )
            }
          </PageShell.Content>
        </PageShell.Main>
      </PageShell>
    </RailShell>
  );
}
