import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Badge, Checkbox, Group, Text } from '@mantine/core';
import { useUncontrolled } from '@mantine/hooks';
import clsx from 'clsx';

import { TextInput } from '../text-input/TextInput';
import { VirtualList } from '../virtual-list/VirtualList';
import classes from './SelectableList.module.css';

export interface SelectableListItemProps {
  /** Stable identity for the item -- selection state is tracked by this key. */
  key: string;
  /** Text shown for the item, also matched against the search filter. */
  label: string;
  /** Optional custom rendering for the row, instead of the plain `label`. */
  displayElement?: ReactNode;
}

export interface SelectableListProps<T> {
  items: T[];
  /** Extracts the key/label (and optional custom rendering) for an item. */
  getItemProps: (item: T) => SelectableListItemProps;
  /**
   * Called with the full set of currently-selected items (resolved against
   * the current search filter) whenever the user changes the selection.
   * Fires in both controlled and uncontrolled modes.
   */
  onSelect?: (selectedItems: T[]) => void;
  /**
   * Controlled selection, as item keys. Omit to let the list manage its own
   * selection state.
   */
  selectedKeys?: string[];
  /**
   * Called with the next key set whenever selection changes -- the
   * controlled companion to `selectedKeys` (also fires in uncontrolled
   * mode, alongside `onSelect`).
   */
  onSelectionChange?: (keys: string[]) => void;
  /** Shown instead of the list when `items` is empty. @default 'No items.' */
  noItemsMessage?: string;
  /** Extra content in the header row, next to the search box. */
  headerItem?: ReactNode;
  /** Max height of the scrollable row area. @default '20rem' */
  maxHeight?: string | number;
  /** Extra class for the root element (merged with the kit surface styles). */
  className?: string;
  /** Inline style for the root element. */
  style?: React.CSSProperties;
}

/**
 * A searchable, checkbox-selectable, virtualized list: a header row (select
 * all, item count, search box) over a windowed body of rows, each with its
 * own checkbox. A row's text is the checkbox's own label (stretched across
 * the row), so clicking it toggles natively and the label stays plain
 * default-color text against the row tints.
 *
 * Brings its own kit surface (see SelectableList.module.css): a `bg.level2`
 * background behind header and rows, a default-border hairline, the theme
 * radius, and clipped overflow -- so it reads as a distinct surface without
 * a wrapping `Paper`. Row states are tokens only: selected rows use
 * Mantine's calm `--mantine-primary-color-light` tint (its `-light-hover`
 * companion while hovered), unselected hover uses the `--ui-bg-3` slot.
 *
 * Composes this kit's `VirtualList` (a flex-row windowed list) rather than
 * a table-specific `VirtualTable`, keeping it decoupled and lightweight.
 * Rows are plain flex `Group`s, not table rows.
 *
 * Selection is uncontrolled by default; pass `selectedKeys` (with
 * `onSelectionChange`) to control it from the parent. Either way,
 * `onSelect` keeps firing with the resolved item objects after every user
 * toggle, so existing uncontrolled callers are unaffected.
 */
export function SelectableList<T>({
  items: unfilteredItems,
  onSelect,
  selectedKeys: selectedKeysProp,
  onSelectionChange,
  getItemProps,
  noItemsMessage = 'No items.',
  maxHeight = '20rem',
  headerItem,
  className,
  style,
}: SelectableListProps<T>) {
  // Mantine's controlled/uncontrolled bridge: with `selectedKeys` set the
  // parent owns the state and `setSelectedKeys` only reports through
  // `onSelectionChange`; without it the list keeps its own state (and
  // `onSelectionChange` still reports).
  const [selectedKeys, setSelectedKeys] = useUncontrolled<string[]>({
    value: selectedKeysProp,
    finalValue: [],
    onChange: onSelectionChange,
  });
  const [filter, setFilter] = useState('');

  const selectedKeySet = useMemo(() => new Set(selectedKeys), [selectedKeys]);

  const items = useMemo(
    () =>
      unfilteredItems.filter(item =>
        getItemProps(item).label.toLowerCase().includes(filter.toLowerCase())
      ),
    [unfilteredItems, getItemProps, filter]
  );

  const emitSelection = (keys: Set<string>) => {
    setSelectedKeys([...keys]);
    onSelect?.(items.filter(item => keys.has(getItemProps(item).key)));
  };

  const toggleItem = (key: string) => {
    const next = new Set(selectedKeySet);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    emitSelection(next);
  };

  const allSelected =
    items.length > 0 &&
    items.every(item => selectedKeySet.has(getItemProps(item).key));

  const toggleSelectAll = () => {
    emitSelection(
      allSelected
        ? new Set()
        : new Set(items.map(item => getItemProps(item).key))
    );
  };

  if (unfilteredItems.length === 0) {
    // Same surface wrapper as the populated list, so `className`/`style`
    // land on the same element in both states.
    return (
      <div className={clsx(classes.list, className)} style={style}>
        <Text c="dimmed" size="sm" px="sm" py="xs">
          {noItemsMessage}
        </Text>
      </div>
    );
  }

  return (
    <div className={clsx(classes.list, className)} style={style}>
      <Group
        justify="space-between"
        wrap="nowrap"
        px="sm"
        py="xs"
        style={{
          borderBottom: '1px solid var(--mantine-color-default-border)',
        }}
      >
        <Group gap="xs" wrap="nowrap">
          <Checkbox
            checked={allSelected}
            onChange={toggleSelectAll}
            aria-label="Select all"
          />
          <Text size="sm">
            Items <Badge>{items.length}</Badge>
          </Text>
        </Group>
        {headerItem}
        <TextInput
          placeholder="Search..."
          value={filter}
          onChange={event => setFilter(event.currentTarget.value)}
          size="xs"
        />
      </Group>
      <VirtualList
        items={items}
        estimateSize={() => 48}
        maxHeight={maxHeight}
        getItemKey={item => getItemProps(item).key}
        renderRow={item => {
          const { key, label, displayElement } = getItemProps(item);
          return (
            <Group
              wrap="nowrap"
              px="sm"
              py={4}
              className={clsx(
                classes.row,
                selectedKeySet.has(key) && classes.rowSelected
              )}
            >
              {/* One Checkbox owns the box AND the row text as its `label`
                  (a native label-for association): clicking the text toggles
                  through the label element, so only the checkbox's own
                  onChange ever fires -- one toggle per click, no row-level
                  onClick to double it -- and the label renders as plain
                  default-color text instead of a primary-tinted button
                  fighting the row tints. */}
              <Checkbox
                checked={selectedKeySet.has(key)}
                onChange={() => toggleItem(key)}
                label={displayElement ?? label}
                classNames={{
                  root: classes.rowCheckbox,
                  labelWrapper: classes.rowCheckboxLabelWrapper,
                  label: classes.rowCheckboxLabel,
                }}
              />
            </Group>
          );
        }}
      />
    </div>
  );
}
