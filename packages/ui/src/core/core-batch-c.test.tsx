import { useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  AcceptableList,
  HybridMenu,
  RangePicker,
  SearchableMenu,
  SelectableList,
  Table,
  VirtualList,
  VirtualTable,
  VirtualTableHeader,
  VirtualTableShell,
} from '@mattstack/app-kit/core';
import { renderWithProviders } from '@mattstack/app-kit/test-utils';

// --- VirtualList -----------------------------------------------------------
//
// jsdom does no real layout: every element reports 0x0 unless a size is
// forced. @tanstack/react-virtual measures its scroll container's size via
// plain `offsetWidth`/`offsetHeight` (see `getRect` in
// @tanstack/virtual-core), NOT `getBoundingClientRect` and NOT
// `ResizeObserver` for the *first* measurement -- it calls `getRect` once
// synchronously on mount regardless of `ResizeObserver` support, then only
// uses `ResizeObserver` (if present) for subsequent updates. So the fix is
// to stub `offsetHeight`/`offsetWidth` on `HTMLElement.prototype` to a fixed
// non-zero size before rendering, giving the virtualizer a real viewport to
// compute a windowed range against. Restored after each test in this
// section so it doesn't leak into other components' tests.
const ORIGINAL_OFFSET_HEIGHT = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'offsetHeight'
);
const ORIGINAL_OFFSET_WIDTH = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'offsetWidth'
);

function stubElementSize(height: number, width = 600) {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    value: height,
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    value: width,
  });
}

function restoreElementSize() {
  if (ORIGINAL_OFFSET_HEIGHT)
    Object.defineProperty(
      HTMLElement.prototype,
      'offsetHeight',
      ORIGINAL_OFFSET_HEIGHT
    );
  if (ORIGINAL_OFFSET_WIDTH)
    Object.defineProperty(
      HTMLElement.prototype,
      'offsetWidth',
      ORIGINAL_OFFSET_WIDTH
    );
}

describe('VirtualList', () => {
  afterEach(() => {
    restoreElementSize();
  });

  test('renders only a window of 10k items, not all of them', () => {
    stubElementSize(400);
    const items = Array.from({ length: 10_000 }, (_, i) => ({
      id: i,
      label: `Row ${i}`,
    }));

    const { container } = renderWithProviders(
      <VirtualList
        items={items}
        estimateSize={() => 40}
        renderRow={item => (
          <div data-testid={`row-${item.id}`}>{item.label}</div>
        )}
      />
    );

    const renderedRows = container.querySelectorAll('[data-testid^="row-"]');
    expect(renderedRows.length).toBeGreaterThan(0);
    expect(renderedRows.length).toBeLessThan(100);
    expect(renderedRows.length).toBeLessThan(items.length);
  });

  test('scrollAreaProps reaches the outer ScrollArea container', () => {
    stubElementSize(400);
    const { container } = renderWithProviders(
      <VirtualList
        items={[{ id: 0, label: 'Row 0' }]}
        renderRow={item => <div>{item.label}</div>}
        scrollAreaProps={{ className: 'probe', 'aria-label': 'row scroller' }}
      />
    );

    const scrollArea = container.querySelector('.probe') as HTMLElement;
    expect(scrollArea).not.toBeNull();
    expect(scrollArea.getAttribute('aria-label')).toBe('row scroller');
    // The probe landed on the scroll container itself: the rows render
    // inside it.
    expect(scrollArea.textContent).toContain('Row 0');
  });
});

// --- VirtualTable ------------------------------------------------------------

describe('VirtualTable', () => {
  afterEach(() => {
    restoreElementSize();
  });

  test('renders its header and a window of rows, not all of them', () => {
    stubElementSize(400);
    const items = Array.from({ length: 10_000 }, (_, i) => ({
      id: i,
      name: `Item ${i}`,
    }));

    const { container } = renderWithProviders(
      <VirtualTable
        items={items}
        estimateSize={() => 40}
        getRowKey={item => item.id}
        columns={[
          { key: 'name', header: 'Name', cell: item => item.name },
          { key: 'id', header: 'ID', cell: item => item.id },
        ]}
      />
    );

    expect(screen.getByText('Name')).toBeTruthy();
    expect(screen.getByText('ID')).toBeTruthy();

    const renderedRows = container.querySelectorAll('tbody tr[data-index]');
    expect(renderedRows.length).toBeGreaterThan(0);
    expect(renderedRows.length).toBeLessThan(100);
  });

  test('containerProps reaches the scroll div, with style merged over the defaults', () => {
    stubElementSize(400);
    renderWithProviders(
      <VirtualTable
        items={[{ id: 0, name: 'Item 0' }]}
        columns={[{ key: 'name', header: 'Name', cell: item => item.name }]}
        maxHeight={240}
        containerProps={{
          className: 'probe',
          'aria-label': 'table scroller',
          style: { border: '1px solid red' },
        }}
      />
    );

    const scrollDiv = screen.getByTestId('virtual-table-scroll');
    expect(scrollDiv.className).toBe('probe');
    expect(scrollDiv.getAttribute('aria-label')).toBe('table scroller');
    // Caller style merges on top without clobbering the scroll frame.
    expect(scrollDiv.style.border).toBe('1px solid red');
    expect(scrollDiv.style.maxHeight).toBe('240px');
    expect(scrollDiv.style.overflow).toBe('auto');
  });

  // The inversion-of-control shape: the caller owns the virtualizer and
  // renders rows itself, instead of VirtualTable owning both given
  // items/columns.
  test('VirtualTableShell renders caller children in a scroll container sized by the caller-owned virtualizer, and VirtualTableHeader renders its header row', () => {
    stubElementSize(400);

    function Harness() {
      const scrollRef = useRef<HTMLDivElement | null>(null);
      const virtualizer = useVirtualizer({
        count: 3,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => 40,
      });

      return (
        <div>
          <VirtualTableHeader>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
            </Table.Tr>
          </VirtualTableHeader>
          <VirtualTableShell
            ref={scrollRef}
            virtualizer={virtualizer}
            maxHeight="120px"
          >
            {virtualizer.getVirtualItems().map(row => (
              <Table.Tr key={row.key} data-index={row.index}>
                <Table.Td>Row {row.index}</Table.Td>
              </Table.Tr>
            ))}
          </VirtualTableShell>
        </div>
      );
    }

    const { container } = renderWithProviders(<Harness />);

    expect(screen.getByText('Name')).toBeTruthy();

    const scrollDiv = screen.getByTestId('virtual-table-shell-scroll');
    expect(scrollDiv.style.maxHeight).toBe('120px');
    expect(scrollDiv.style.overflow).toBe('auto');

    const renderedRows = container.querySelectorAll('tbody tr[data-index]');
    expect(renderedRows.length).toBeGreaterThan(0);
    expect(renderedRows.length).toBeLessThanOrEqual(3);
  });
});

// --- SelectableList ----------------------------------------------------------

describe('SelectableList', () => {
  afterEach(() => {
    restoreElementSize();
  });

  // Row text is the checkbox's own label (no subtle Button wrapping it
  // anymore), so clicking the text toggles through the native label-for
  // association.
  test('fires onSelect with the toggled item, then again with it removed', async () => {
    stubElementSize(400);
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const items = [
      { id: 'a', name: 'Alpha' },
      { id: 'b', name: 'Bravo' },
    ];

    renderWithProviders(
      <SelectableList
        items={items}
        onSelect={onSelect}
        getItemProps={item => ({ key: item.id, label: item.name })}
      />
    );

    expect(screen.queryByRole('button', { name: 'Alpha' })).toBeNull();

    await user.click(screen.getByText('Alpha'));
    expect(onSelect).toHaveBeenLastCalledWith([items[0]]);

    await user.click(screen.getByText('Alpha'));
    expect(onSelect).toHaveBeenLastCalledWith([]);
  });

  test('passes className/style through to the list surface root', () => {
    stubElementSize(400);
    const { container } = renderWithProviders(
      <SelectableList
        items={[{ id: 'a', name: 'Alpha' }]}
        onSelect={() => {}}
        getItemProps={item => ({ key: item.id, label: item.name })}
        className="probe"
        style={{ margin: 3 }}
      />
    );

    const root = container.querySelector('.probe') as HTMLElement;
    expect(root).not.toBeNull();
    expect(root.style.margin).toBe('3px');
  });

  // Clicking the checkbox input directly must toggle exactly once: only the
  // checkbox's own onChange fires (the label click path is the same native
  // association, and there is no row-level onClick that could double it).
  test('clicking the checkbox itself toggles exactly once', async () => {
    stubElementSize(400);
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const items = [
      { id: 'a', name: 'Alpha' },
      { id: 'b', name: 'Bravo' },
    ];

    renderWithProviders(
      <SelectableList
        items={items}
        onSelect={onSelect}
        getItemProps={item => ({ key: item.id, label: item.name })}
      />
    );

    await user.click(screen.getByRole('checkbox', { name: 'Alpha' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenLastCalledWith([items[0]]);

    await user.click(screen.getByText('Alpha'));
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenLastCalledWith([]);
  });

  test('toggles from the keyboard: the checkbox is focusable and Space toggles', async () => {
    stubElementSize(400);
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const items = [{ id: 'a', name: 'Alpha' }];

    renderWithProviders(
      <SelectableList
        items={items}
        onSelect={onSelect}
        getItemProps={item => ({ key: item.id, label: item.name })}
      />
    );

    screen.getByRole('checkbox', { name: 'Alpha' }).focus();
    await user.keyboard(' ');
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenLastCalledWith([items[0]]);
  });

  test('renders the noItemsMessage when given an empty list', () => {
    renderWithProviders(
      <SelectableList
        items={[]}
        onSelect={vi.fn()}
        getItemProps={() => ({ key: '', label: '' })}
        noItemsMessage="Nothing here"
      />
    );

    expect(screen.getByText('Nothing here')).toBeTruthy();
  });

  test('empty state renders inside the same surface wrapper, so className/style still apply', () => {
    const { container } = renderWithProviders(
      <SelectableList
        items={[]}
        onSelect={vi.fn()}
        getItemProps={() => ({ key: '', label: '' })}
        noItemsMessage="Nothing here"
        className="probe"
        style={{ margin: 3 }}
      />
    );

    const root = container.querySelector('.probe') as HTMLElement;
    expect(root).not.toBeNull();
    // Same hash-scoped surface class the populated list's root carries.
    expect(root.className).toContain('list');
    expect(root.style.margin).toBe('3px');
    expect(root.textContent).toContain('Nothing here');
  });

  // Controlled harness: the parent owns the keys; external buttons drive
  // the same state the list reports into.
  function ControlledList({
    onSelect,
  }: {
    onSelect?: (items: unknown[]) => void;
  }) {
    const [keys, setKeys] = useState<string[]>([]);
    return (
      <>
        <button type="button" onClick={() => setKeys(['a', 'b'])}>
          external select all
        </button>
        <button type="button" onClick={() => setKeys([])}>
          external clear
        </button>
        <SelectableList
          items={[
            { id: 'a', name: 'Alpha' },
            { id: 'b', name: 'Bravo' },
          ]}
          getItemProps={item => ({ key: item.id, label: item.name })}
          selectedKeys={keys}
          onSelectionChange={setKeys}
          onSelect={onSelect}
        />
        <div data-testid="keys-readout">{keys.join(',')}</div>
      </>
    );
  }

  test('controlled round-trip: list toggles report keys out, parent-driven keys render in', async () => {
    stubElementSize(400);
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderWithProviders(<ControlledList onSelect={onSelect} />);

    const readout = () => screen.getByTestId('keys-readout').textContent;
    const checkbox = (label: string) =>
      screen.getByRole('checkbox', { name: label }) as HTMLInputElement;

    // User toggle flows out through onSelectionChange, and onSelect keeps
    // firing with the resolved items.
    await user.click(screen.getByText('Alpha'));
    expect(readout()).toBe('a');
    expect(checkbox('Alpha').checked).toBe(true);
    expect(onSelect).toHaveBeenLastCalledWith([{ id: 'a', name: 'Alpha' }]);

    await user.click(screen.getByText('Alpha'));
    expect(readout()).toBe('');
    expect(checkbox('Alpha').checked).toBe(false);

    // Select-all from the header round-trips through the parent too.
    await user.click(screen.getByLabelText('Select all'));
    expect(readout()).toBe('a,b');
    expect(checkbox('Bravo').checked).toBe(true);

    // Parent-driven changes render without any list interaction.
    await user.click(screen.getByText('external clear'));
    expect(checkbox('Alpha').checked).toBe(false);
    expect(checkbox('Bravo').checked).toBe(false);

    await user.click(screen.getByText('external select all'));
    expect(checkbox('Alpha').checked).toBe(true);
    expect(checkbox('Bravo').checked).toBe(true);
  });

  test('uncontrolled mode still reports through onSelectionChange', async () => {
    stubElementSize(400);
    const user = userEvent.setup();
    const onSelectionChange = vi.fn();

    renderWithProviders(
      <SelectableList
        items={[{ id: 'a', name: 'Alpha' }]}
        getItemProps={item => ({ key: item.id, label: item.name })}
        onSelectionChange={onSelectionChange}
      />
    );

    await user.click(screen.getByText('Alpha'));
    expect(onSelectionChange).toHaveBeenLastCalledWith(['a']);
    // And the list kept its own state: the row is checked.
    expect(
      (screen.getByRole('checkbox', { name: 'Alpha' }) as HTMLInputElement)
        .checked
    ).toBe(true);
  });

  // Vitest compiles CSS modules through Vite, so the classes from
  // SelectableList.module.css come out hash-scoped but keep their source
  // name as a substring (`_list_<hash>`, `_rowSelected_<hash>`). These
  // assert the essential ones: `list` carries the kit surface
  // (bg.level2 + hairline + radius + clipped overflow), `rowSelected`
  // carries the --mantine-primary-color-light selection tint.
  test('renders its own kit surface and tints only the selected row', async () => {
    stubElementSize(400);
    const user = userEvent.setup();
    const items = [
      { id: 'a', name: 'Alpha' },
      { id: 'b', name: 'Bravo' },
    ];

    renderWithProviders(
      <SelectableList
        items={items}
        onSelect={vi.fn()}
        getItemProps={item => ({ key: item.id, label: item.name })}
      />
    );

    // The surface class sits on the outer wrapper, above the header row.
    expect(
      screen.getByLabelText('Select all').closest('div[class*="list"]')
    ).not.toBeNull();

    // `_row_<hash>` (underscore-delimited) so the checkbox's own
    // `_rowCheckbox_<hash>` class can't match the ancestor query.
    const rowOf = (label: string) =>
      screen.getByLabelText(label).closest('div[class*="_row_"]');
    expect(rowOf('Alpha')?.className).not.toContain('rowSelected');

    await user.click(screen.getByText('Alpha'));
    expect(rowOf('Alpha')?.className).toContain('rowSelected');
    expect(rowOf('Bravo')?.className).not.toContain('rowSelected');
  });
});

// --- AcceptableList ----------------------------------------------------------

describe('AcceptableList', () => {
  test('fires onAccept/onDecline with the item that was clicked', async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn();
    const onDecline = vi.fn();
    const items = [
      { id: '1', name: 'First' },
      { id: '2', name: 'Second' },
    ];

    renderWithProviders(
      <AcceptableList
        items={items}
        getItemId={item => item.id}
        renderItemDetail={item => <span>{item.name}</span>}
        onAccept={onAccept}
        onDecline={onDecline}
      />
    );

    const acceptButtons = screen.getAllByRole('button', { name: 'Accept' });
    await user.click(acceptButtons[0]);
    expect(onAccept).toHaveBeenCalledWith(items[0]);

    const declineButtons = screen.getAllByRole('button', { name: 'Decline' });
    await user.click(declineButtons[1]);
    expect(onDecline).toHaveBeenCalledWith(items[1]);
  });

  test('renders the Accept All button and fires onAcceptAll', async () => {
    const user = userEvent.setup();
    const onAcceptAll = vi.fn();

    renderWithProviders(
      <AcceptableList
        items={[{ id: '1', name: 'First' }]}
        getItemId={item => item.id}
        renderItemDetail={item => <span>{item.name}</span>}
        onAccept={vi.fn()}
        onDecline={vi.fn()}
        onAcceptAll={onAcceptAll}
      />
    );

    await user.click(screen.getByTestId('acceptable-list-accept-all'));
    expect(onAcceptAll).toHaveBeenCalled();
  });

  test('shows a no-items message when the list is empty', () => {
    renderWithProviders(
      <AcceptableList
        items={[]}
        getItemId={(item: { id: string }) => item.id}
        renderItemDetail={() => null}
        onAccept={vi.fn()}
        onDecline={vi.fn()}
      />
    );

    expect(screen.getByText('No items to display')).toBeTruthy();
  });
});

// --- SearchableMenu ----------------------------------------------------------
//
// Router-agnostic: SearchableMenu takes a component prop instead of
// importing any router's Link directly. Item rendering is polymorphic:
// `component` (an ElementType, e.g. a plain `"a"` or a caller's own router
// `Link`) plus `getItemProps` supplies whatever per-item props that component
// needs (`href`, `to`, ...). No router package import anywhere.

describe('SearchableMenu', () => {
  const items = [
    { id: '1', name: 'Alpha project' },
    { id: '2', name: 'Bravo project' },
    { id: '3', name: 'Charlie project' },
  ];

  // Same jsdom-has-no-layout issue as `VirtualList` above: the menu's
  // result list is itself a `VirtualList`, which renders nothing at all
  // (not even an overscan window) when its measured viewport is 0px --
  // see `@tanstack/virtual-core`'s `calculateRange` short-circuit.
  afterEach(() => {
    restoreElementSize();
  });

  test('filters items by query', async () => {
    stubElementSize(300);
    const user = userEvent.setup();
    renderWithProviders(
      <SearchableMenu
        menuTrigger={<button type="button">Open menu</button>}
        title="Projects"
        items={items}
        itemTitle={item => item.name}
      />
    );

    await user.click(screen.getByText('Open menu'));
    // Item titles render through `Highlight`, which always wraps its text in
    // child `<mark>`/`<span>` chunks -- so the title's own element has no
    // direct text-node children once a search term is typed and can't be
    // matched with `getByText`. `title` (the same string, set for
    // `truncate="end"` tooltips) is the stable, un-split query.
    expect(await screen.findByTitle('Alpha project')).toBeTruthy();
    expect(screen.getByTitle('Bravo project')).toBeTruthy();

    await user.type(screen.getByPlaceholderText('Search Projects...'), 'Bravo');

    await waitFor(() => {
      expect(screen.queryByTitle('Alpha project')).toBeNull();
    });
    expect(screen.getByTitle('Bravo project')).toBeTruthy();
  });

  test('renders items through a custom link component (plain <a>), no router', async () => {
    stubElementSize(300);
    const user = userEvent.setup();
    const { container } = renderWithProviders(
      <SearchableMenu
        menuTrigger={<button type="button">Open menu</button>}
        title="Projects"
        items={items}
        itemTitle={item => item.name}
        component="a"
        getItemProps={item => ({ href: `/projects/${item.id}` })}
      />
    );

    await user.click(screen.getByText('Open menu'));
    await screen.findByText('Alpha project');

    const link = container.querySelector('a[href="/projects/1"]');
    expect(link).toBeTruthy();
    expect(link?.textContent).toContain('Alpha project');
  });

  test('filters across multiple fields via filterKey', async () => {
    stubElementSize(300);
    const user = userEvent.setup();
    const gear = [
      { id: '1', name: 'Camera', location: 'Media lab' },
      { id: '2', name: 'Tripod', location: 'Storage room' },
      { id: '3', name: 'Projector', location: 'Media lab' },
    ];

    renderWithProviders(
      <SearchableMenu
        menuTrigger={<button type="button">Open menu</button>}
        title="Gear"
        items={gear}
        itemTitle={item => item.name}
        filterKey={['name', 'location']}
      />
    );

    await user.click(screen.getByText('Open menu'));
    await screen.findByText('Camera');

    // "Media lab" only matches the location field, not any item's name.
    await user.type(screen.getByPlaceholderText('Search Gear...'), 'Media lab');

    await waitFor(() => {
      expect(screen.queryByText('Tripod')).toBeNull();
    });
    expect(screen.getByText('Camera')).toBeTruthy();
    expect(screen.getByText('Projector')).toBeTruthy();
  });

  test('sorts pinned items first', async () => {
    stubElementSize(300);
    const user = userEvent.setup();
    const gear = [
      { id: '1', name: 'Camera' },
      { id: '2', name: 'Tripod' },
      { id: '3', name: 'Projector' },
    ];

    const { container } = renderWithProviders(
      <SearchableMenu
        menuTrigger={<button type="button">Open menu</button>}
        title="Gear"
        items={gear}
        itemTitle={item => item.name}
        isItemPinned={item => item.id === '3'}
      />
    );

    await user.click(screen.getByText('Open menu'));
    await screen.findByText('Camera');

    const rows = Array.from(container.querySelectorAll('[data-index]')).map(
      row => row.textContent
    );
    expect(rows[0]).toContain('Projector');
  });

  test('highlights the matched substring in the item title', async () => {
    stubElementSize(300);
    const user = userEvent.setup();
    const gear = [
      { id: '1', name: 'Camera kit' },
      { id: '2', name: 'Tripod' },
    ];

    const { container } = renderWithProviders(
      <SearchableMenu
        menuTrigger={<button type="button">Open menu</button>}
        title="Gear"
        items={gear}
        itemTitle={item => item.name}
      />
    );

    await user.click(screen.getByText('Open menu'));
    await screen.findByText('Tripod');

    await user.type(screen.getByPlaceholderText('Search Gear...'), 'cam');

    await waitFor(() => {
      expect(container.querySelector('mark')).toBeTruthy();
    });
    expect(container.querySelector('mark')?.textContent?.toLowerCase()).toBe(
      'cam'
    );
  });

  test('renders a toolbar slot in the dropdown', async () => {
    stubElementSize(300);
    const user = userEvent.setup();

    renderWithProviders(
      <SearchableMenu
        menuTrigger={<button type="button">Open menu</button>}
        title="Projects"
        items={items}
        itemTitle={item => item.name}
        toolbar={<div>Toolbar slot</div>}
      />
    );

    await user.click(screen.getByText('Open menu'));
    expect(await screen.findByText('Toolbar slot')).toBeTruthy();
  });

  test('renders an animated chevron next to the trigger when withChevron is set', async () => {
    const { container } = renderWithProviders(
      <SearchableMenu
        menuTrigger={<button type="button">Open menu</button>}
        title="Projects"
        items={items}
        itemTitle={item => item.name}
        withChevron
      />
    );

    expect(container.querySelector('svg')).toBeTruthy();
  });
});

// --- HybridMenu --------------------------------------------------------------

describe('HybridMenu', () => {
  test('renders both the options and actions sections, and fires an action', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    renderWithProviders(
      <HybridMenu
        target={<button type="button">Menu target</button>}
        options={[
          { label: 'Option A', value: 'a' },
          { label: 'Option B', value: 'b' },
        ]}
        defaultValue="a"
        actions={[{ label: 'Do the thing', onClick }]}
      />
    );

    await user.click(screen.getByText('Menu target'));

    expect(await screen.findByText('Option A')).toBeTruthy();
    expect(screen.getByText('Option B')).toBeTruthy();
    expect(screen.getByText('Do the thing')).toBeTruthy();

    await user.click(screen.getByText('Do the thing'));
    expect(onClick).toHaveBeenCalled();
  });

  test('fires onChange when an option is selected', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    renderWithProviders(
      <HybridMenu
        target={<button type="button">Menu target</button>}
        options={[
          { label: 'Option A', value: 'a' },
          { label: 'Option B', value: 'b' },
        ]}
        defaultValue="a"
        onChange={onChange}
      />
    );

    await user.click(screen.getByText('Menu target'));
    await user.click(await screen.findByText('Option B'));

    expect(onChange).toHaveBeenCalledWith('b');
  });
});

// --- RangePicker -------------------------------------------------------------
//
// Real day-cell clicking in a jsdom popover is timing-sensitive (disabled
// outside-dates, month boundaries, etc.), so this exercises the *other*
// real, deterministic interaction the component exposes: `@mantine/dates`'
// built-in `presets` list. Clicking a preset button is a real user
// interaction (not a prop-only assertion) and drives the exact same
// `onChange` callback path a manual range pick would.

describe('RangePicker', () => {
  test('renders and fires onChange when a preset range is picked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const presetRange: [Date, Date] = [
      new Date(2024, 0, 1),
      new Date(2024, 0, 7),
    ];

    renderWithProviders(
      <RangePicker
        value={[null, null]}
        onChange={onChange}
        presets={[{ label: 'First week of Jan', value: presetRange }]}
      />
    );

    const input = screen.getByRole('button', { name: 'Pick a date range' });
    await user.click(input);

    const presetButton = await screen.findByText('First week of Jan');
    await user.click(presetButton);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    const [start, end] = onChange.mock.calls.at(-1)?.[0] as [
      Date | null,
      Date | null,
    ];
    expect(start).toBeInstanceOf(Date);
    expect(end).toBeInstanceOf(Date);
    expect(start?.getFullYear()).toBe(2024);
  });
});
