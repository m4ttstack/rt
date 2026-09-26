import { useMemo, useState } from 'react';
import type { ComponentType, ElementType, ReactNode } from 'react';
import {
  Badge,
  Button,
  Center,
  Flex,
  Group,
  Highlight,
  Loader,
  Menu,
  Text,
} from '@mantine/core';
import type { BadgeProps, MenuProps } from '@mantine/core';

import { AnimatedChevron, Icons } from '@mattstack/app-kit/icons';
import { TextInput } from '../text-input/TextInput';
import { VirtualList } from '../virtual-list';
import type { VirtualListProps } from '../virtual-list';

// `Menu.Item` is one of `@mantine/core`'s polymorphic "factory" components:
// its overloaded call signature only resolves for a `component` value known
// at the JSX call site, not one held in a variable typed as the broader
// `ElementType` (this component's own public `component` prop). Widening
// the local reference to accept arbitrary props sidesteps that, without
// affecting `SearchableMenuProps['component']`'s own (properly typed)
// public surface.
// PURE-wrapped: a bare top-level `Menu.Item` property read counts as a
// side effect to the bundler and would pin this module when unused.
const PolymorphicMenuItem = /* @__PURE__ */ (() =>
  Menu.Item as ComponentType<Record<string, unknown>>)();

/**
 * Reads a (possibly dot-nested) field path off an item, returning the
 * string at that path or `undefined` if any segment along the way isn't a
 * plain object. Never throws on a missing/short path.
 */
function readFieldPath(item: Record<string, unknown>, path: string): unknown {
  let value: unknown = item;
  for (const segment of path.split('.')) {
    if (value === null || typeof value !== 'object') return undefined;
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

/** Multi-key substring search: true if ANY of `keys` (string fields, dot
 * paths allowed) on `item` contains `needle` (already lower-cased). */
function matchesFilterKeys<T extends Record<string, unknown>>(
  item: T,
  keys: string[],
  needle: string
): boolean {
  return keys.some(key => {
    const value = readFieldPath(item, key);
    return typeof value === 'string' && value.toLowerCase().includes(needle);
  });
}

export interface SearchableMenuProps<T extends Record<string, unknown>> {
  /** The element that opens the menu (passed to `Menu.Target`). */
  menuTrigger: ReactNode;
  title: string;
  titleIcon?: ReactNode;
  items: T[];
  itemTitle: (item: T) => string;
  itemSubtitle?: (item: T, filterKeyword?: string) => ReactNode;
  isSelectedItem?: (item: T) => boolean;
  showItemBadge?: (item: T) => boolean;
  itemBadgeText?: ((item: T) => string) | string;
  itemBadgeColor?: (item: T) => BadgeProps['color'];
  onItemClick?: (item: T) => void;
  /**
   * Router-agnostic escape hatch #1: fully own an item row's rendering
   * (e.g. wrap it in your own router's `Link`). When given, this replaces
   * the built-in `Menu.Item` row entirely for every item.
   */
  renderItem?: (item: T, index: number) => ReactNode;
  /**
   * Router-agnostic escape hatch #2: the element type each item's
   * `Menu.Item` renders as (Mantine's `Menu.Item` is polymorphic). Pass a
   * plain `"a"`, or a consuming app's router `Link` component.
   */
  component?: ElementType;
  /** Extra per-item props passed to `component` (e.g. `{ href }` for `"a"`, `{ to }` for a router `Link`). */
  getItemProps?: (item: T) => Record<string, unknown>;
  onViewAllClick?: () => void;
  hideTitleBar?: boolean;
  loading?: boolean;
  emptyMessage?: string;
  position?: MenuProps['position'];
  filterPlaceholder?: (title: string) => string;
  /**
   * Field(s) to filter on (dot paths allowed for nested fields). When
   * omitted, filtering falls back to matching `itemTitle(item)`.
   */
  filterKey?: string | string[];
  /** Slot rendered at the top of the dropdown, above the title bar. */
  toolbar?: ReactNode;
  /** Marks an item as pinned: pinned items sort first and show a pin icon. */
  isItemPinned?: (item: T) => boolean;
  transitionProps?: MenuProps['transitionProps'];
  /** Extra props passed through to the inner `VirtualList`. */
  virtualListProps?: Partial<VirtualListProps<T>>;
  /** Renders an `AnimatedChevron` next to `menuTrigger`. @default false */
  withChevron?: boolean;
}

/**
 * A search-filterable menu of items: click the trigger to open a dropdown
 * with a search box and a virtualized (`VirtualList`) result list.
 *
 * Router-agnostic: uses polymorphism (`renderItem` for full control, or
 * `component`/`getItemProps` to plug in whatever link component the
 * consuming app uses) instead of hardcoding a router library.
 *
 * Filtering is done directly on the caller-supplied `itemTitle` string,
 * keeping the prop surface simple.
 */
export function SearchableMenu<T extends Record<string, unknown>>({
  menuTrigger,
  title,
  titleIcon,
  items: unsortedItems,
  itemTitle,
  itemSubtitle,
  isSelectedItem,
  showItemBadge,
  itemBadgeText,
  itemBadgeColor,
  onItemClick,
  renderItem,
  component,
  getItemProps,
  onViewAllClick,
  hideTitleBar = false,
  loading = false,
  emptyMessage,
  position = 'bottom-start',
  filterPlaceholder,
  filterKey,
  toolbar,
  isItemPinned,
  transitionProps,
  virtualListProps,
  withChevron = false,
}: SearchableMenuProps<T>) {
  const [filterKeyword, setFilterKeyword] = useState('');
  const [opened, setOpened] = useState(false);

  // Pinned items sort first; the pin flag never changes the item set, just
  // its order.
  const items = useMemo(() => {
    if (!isItemPinned) return unsortedItems;
    const pinned = unsortedItems.filter(item => isItemPinned(item));
    const unpinned = unsortedItems.filter(item => !isItemPinned(item));
    return [...pinned, ...unpinned];
  }, [unsortedItems, isItemPinned]);

  const filteredItems = useMemo(() => {
    if (!filterKeyword) return items;
    const needle = filterKeyword.toLowerCase();
    if (filterKey) {
      const keys = Array.isArray(filterKey) ? filterKey : [filterKey];
      return items.filter(item => matchesFilterKeys(item, keys, needle));
    }
    return items.filter(item => itemTitle(item).toLowerCase().includes(needle));
  }, [items, itemTitle, filterKeyword, filterKey]);

  const handleOpenChange = (isOpen: boolean) => {
    setOpened(isOpen);
    if (!isOpen) setFilterKeyword('');
  };

  const renderMenuItem = (item: T, index: number) => {
    if (renderItem) return renderItem(item, index);

    const itemTitleText = itemTitle(item);

    return (
      <PolymorphicMenuItem
        key={`${itemTitleText}-${index}`}
        component={component}
        {...getItemProps?.(item)}
        onClick={() => onItemClick?.(item)}
        // Selected tint follows the theme's primary color (same calm
        // `-light` tint SelectableList uses for its selected rows), not a
        // hardcoded palette color.
        bg={
          isSelectedItem?.(item)
            ? 'var(--mantine-primary-color-light)'
            : undefined
        }
        rightSection={<Icons.chevronRight size={16} />}
        p="xs"
        mb={4}
      >
        <Group gap="xs">
          {isItemPinned?.(item) && <Icons.pin />}
          <Flex justify="space-between" align="center" flex={1} mih={30}>
            <Flex direction="column">
              {itemTitleText && (
                <Highlight
                  truncate="end"
                  maw="16rem"
                  title={itemTitleText}
                  fw={500}
                  highlight={filterKeyword}
                  color="blue"
                >
                  {itemTitleText}
                </Highlight>
              )}
              {itemSubtitle?.(item, filterKeyword) && (
                <Text size="sm" c="dimmed">
                  {itemSubtitle(item, filterKeyword)}
                </Text>
              )}
            </Flex>
            {showItemBadge?.(item) && (
              <Badge color={itemBadgeColor?.(item)}>
                {typeof itemBadgeText === 'string'
                  ? itemBadgeText
                  : itemBadgeText?.(item)}
              </Badge>
            )}
          </Flex>
        </Group>
      </PolymorphicMenuItem>
    );
  };

  return (
    <Menu
      opened={opened}
      onChange={handleOpenChange}
      shadow="lg"
      width="28rem"
      position={position}
      portalProps={{ style: { zIndex: 9999 } }}
      transitionProps={{
        duration: 100,
        timingFunction: 'ease',
        transition: 'pop-top-left',
        ...transitionProps,
      }}
    >
      <Menu.Target>
        {withChevron ? (
          <Group gap={4}>
            {menuTrigger}
            <AnimatedChevron
              fill="var(--mantine-color-gray-text)"
              style={{ cursor: 'pointer' }}
              opened={opened}
            />
          </Group>
        ) : (
          menuTrigger
        )}
      </Menu.Target>
      <Menu.Dropdown p="sm">
        {toolbar}
        {!hideTitleBar && (
          <Flex px={4} py={4} align="center" justify="space-between">
            <Center fz="sm" style={{ gap: 8 }}>
              {titleIcon}
              <Text>{title}</Text>
            </Center>
            {onViewAllClick && (
              <Button
                variant="subtle"
                fz="sm"
                rightSection={<Icons.arrowRight size={14} />}
                onClick={() => {
                  onViewAllClick();
                  setOpened(false);
                }}
              >
                View All
              </Button>
            )}
          </Flex>
        )}
        <TextInput
          my={8}
          value={filterKeyword}
          disabled={loading}
          onChange={event => setFilterKeyword(event.currentTarget.value)}
          placeholder={filterPlaceholder?.(title) ?? `Search ${title}...`}
          leftSection={<Icons.search size={14} />}
        />
        {loading ? (
          <Center>
            <Loader my="md" />
          </Center>
        ) : filteredItems.length === 0 ? (
          <Menu.Label>
            <Text c="dimmed">
              {emptyMessage ??
                (items.length === 0
                  ? `No ${title.toLowerCase()}.`
                  : `No ${title.toLowerCase()} found.`)}
            </Text>
          </Menu.Label>
        ) : (
          <VirtualList
            items={filteredItems}
            renderRow={renderMenuItem}
            estimateSize={() => 70}
            maxHeight="70dvh"
            minHeight="100px"
            overscan={5}
            {...virtualListProps}
          />
        )}
      </Menu.Dropdown>
    </Menu>
  );
}
