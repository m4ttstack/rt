import { forwardRef, useRef } from 'react';
import type { ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Virtualizer } from '@tanstack/react-virtual';

import { Table } from '../table/Table';
import classes from './VirtualTableShell.module.css';

export interface VirtualTableColumn<T> {
  key: string;
  header: ReactNode;
  cell: (item: T) => ReactNode;
  width?: number | string;
  align?: 'left' | 'center' | 'right';
}

export interface VirtualTableProps<T> {
  items: T[];
  columns: VirtualTableColumn<T>[];
  /** Estimated row height in px, used before a row is actually measured. @default () => 40 */
  estimateSize?: (index: number) => number;
  /** Rows to render above/below the visible window. @default 10 */
  overscan?: number;
  /** Max height of the scrollable body. @default '20vh' */
  maxHeight?: string | number;
  /** Key for each row; defaults to its index. */
  getRowKey?: (item: T, index: number) => string | number;
  /**
   * Extra props for the outer scroll container. Named `containerProps`
   * (not `scrollAreaProps` like `VirtualList`/`PageShell.Content`) because
   * the container here really is a plain scrollable `div`, not a Mantine
   * `ScrollArea` -- the type tells the truth about the element. A `style`
   * here merges over the component's own `maxHeight`/`overflow`.
   */
  containerProps?: React.ComponentPropsWithoutRef<'div'>;
}

/**
 * A windowed table on `@tanstack/react-virtual`, composed with this kit's
 * `Table` shadow: the header renders in full (headers are cheap and few)
 * and stays stuck to the top of the scroll container (`stickyHeader`); the
 * body only mounts the rows currently scrolled into view (plus `overscan`),
 * padded above/below by two spacer `<tr>`s so the native scrollbar still
 * reflects the *full* row count.
 *
 * This version is self-contained and owns its own virtualizer given
 * `items`/`columns`, which makes it directly testable but less flexible
 * than a bare virtualization primitive.
 */
export function VirtualTable<T>({
  items,
  columns,
  estimateSize = () => 40,
  overscan = 10,
  maxHeight = '20vh',
  getRowKey,
  containerProps,
}: VirtualTableProps<T>) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize,
    overscan,
    getItemKey: getRowKey ? index => getRowKey(items[index], index) : undefined,
  });

  const virtualRows = virtualizer.getVirtualItems();
  const topPadding = virtualRows[0]?.start ?? 0;
  const bottomPadding =
    virtualizer.getTotalSize() - (virtualRows.at(-1)?.end ?? 0);
  const columnCount = columns.length;

  return (
    <div
      ref={scrollRef}
      data-testid="virtual-table-scroll"
      {...containerProps}
      style={{ maxHeight, overflow: 'auto', ...containerProps?.style }}
    >
      <Table noPaper stickyHeader>
        <Table.Thead>
          <Table.Tr>
            {columns.map(column => (
              <Table.Th
                key={column.key}
                style={{ width: column.width, textAlign: column.align }}
              >
                {column.header}
              </Table.Th>
            ))}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {topPadding > 0 && (
            <tr aria-hidden style={{ height: topPadding }}>
              <td
                colSpan={columnCount}
                style={{ padding: 0, border: 'none' }}
              />
            </tr>
          )}
          {virtualRows.map(virtualRow => {
            const item = items[virtualRow.index];
            return (
              <Table.Tr
                key={virtualRow.key}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
              >
                {columns.map(column => (
                  <Table.Td
                    key={column.key}
                    style={{ width: column.width, textAlign: column.align }}
                  >
                    {column.cell(item)}
                  </Table.Td>
                ))}
              </Table.Tr>
            );
          })}
          {bottomPadding > 0 && (
            <tr aria-hidden style={{ height: bottomPadding }}>
              <td
                colSpan={columnCount}
                style={{ padding: 0, border: 'none' }}
              />
            </tr>
          )}
        </Table.Tbody>
      </Table>
    </div>
  );
}

export interface VirtualTableHeaderProps {
  /** Header row content, e.g. a `Table.Tr` of `Table.Th`s. */
  children: ReactNode;
}

/**
 * Standalone header, meant to sit directly above a `VirtualTableShell`: a
 * `Table` holding just a `Table.Header`, framed in a top-rounded bordered
 * wrapper with no bottom border so the shell below reads as one continuous
 * frame.
 *
 * Pairs with `VirtualTableShell` for full inversion-of-control -- when the
 * caller needs to own row rendering or a virtualizer shared with other UI,
 * reach for this pair instead of the self-contained `VirtualTable` above.
 */
export function VirtualTableHeader({ children }: VirtualTableHeaderProps) {
  return (
    <div className={classes.headerFrame}>
      <Table noPaper verticalSpacing="sm">
        <Table.Header>{children}</Table.Header>
      </Table>
    </div>
  );
}

export interface VirtualTableShellProps {
  /** Caller-rendered row content, e.g. `Table.Tr`s for the virtualizer's current window. */
  children: ReactNode;
  /** The virtualizer driving this shell, owned by the caller (not this component). */
  virtualizer: Virtualizer<HTMLDivElement, Element>;
  /** Max height of the scrollable body. @default '20vh' */
  maxHeight?: string;
}

/**
 * Presentational shell for a virtualized table body: a scrollable,
 * `maxHeight`-capped, bottom-rounded bordered container sized to the total
 * height of an externally-owned `@tanstack/react-virtual` `virtualizer`,
 * wrapping caller-rendered `children` (typically `Table.Tr`s for the
 * virtualizer's current window) in a `Table` + `Table.Body`.
 *
 * Inversion of control, unlike the declarative `VirtualTable` above: this
 * component owns none of the virtualizer or row rendering, so a caller that
 * needs full control over rows (or a virtualizer shared with other UI) can
 * express it. Pairs with `VirtualTableHeader`; forwards its ref to the
 * scrollable root `div` (the virtualizer's scroll element).
 */
export const VirtualTableShell = /* @__PURE__ */ forwardRef<
  HTMLDivElement,
  VirtualTableShellProps
>(function VirtualTableShell(
  { children, virtualizer, maxHeight = '20vh' },
  forwardedRef
) {
  return (
    <div
      ref={forwardedRef}
      data-testid="virtual-table-shell-scroll"
      className={classes.bodyFrame}
      style={{ maxHeight, overflow: 'auto' }}
    >
      <div style={{ height: virtualizer.getTotalSize() }}>
        <Table noPaper verticalSpacing="sm">
          <Table.Body>{children}</Table.Body>
        </Table>
      </div>
    </div>
  );
});
