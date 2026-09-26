import { useRef } from 'react';
import type { ReactNode } from 'react';
import { ScrollArea } from '@mantine/core';
import type { ScrollAreaAutosizeProps } from '@mantine/core';
import { useVirtualizer } from '@tanstack/react-virtual';

export interface VirtualListProps<T = unknown> {
  /** Items to render. Only the ones currently in view (plus overscan) are mounted. */
  items: T[];
  /** Renders a single item. Receives the item and its absolute index in `items`. */
  renderRow: (item: T, index: number) => ReactNode;
  /**
   * Estimated size (height, in px) of a row, used before it's actually
   * measured. Can vary per index. @default () => 45
   */
  estimateSize?: (index: number) => number;
  /** Rows to render above/below the visible window. @default 20 */
  overscan?: number;
  /** Max height of the scrollable viewport. @default '20vh' */
  maxHeight?: string | number;
  /** Min height of the scrollable viewport. @default 'auto' */
  minHeight?: string | number;
  /** Key for each item; defaults to its index. */
  getItemKey?: (item: T, index: number) => string | number;
  /**
   * Extra props for the outer `ScrollArea.Autosize` scroll container (the
   * same prop name `PageShell.Content` uses for the same concept).
   * `viewportRef` is excluded: the virtualizer owns the viewport ref.
   */
  scrollAreaProps?: Omit<ScrollAreaAutosizeProps, 'viewportRef'>;
}

/**
 * Windowed list on `@tanstack/react-virtual`: only the rows currently
 * scrolled into view (plus `overscan`) are ever mounted, so `items` can hold
 * tens of thousands of rows without tens of thousands of DOM nodes.
 */
export function VirtualList<T>({
  items,
  renderRow,
  estimateSize = () => 45,
  overscan = 20,
  maxHeight = '20vh',
  minHeight = 'auto',
  getItemKey,
  scrollAreaProps,
}: VirtualListProps<T>) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize,
    overscan,
    getItemKey: getItemKey
      ? index => getItemKey(items[index], index)
      : undefined,
  });

  const virtualRows = virtualizer.getVirtualItems();

  return (
    <ScrollArea.Autosize
      viewportRef={scrollRef}
      mah={maxHeight}
      mih={minHeight}
      type="auto"
      scrollbarSize={8}
      {...scrollAreaProps}
    >
      <div
        style={{
          height: virtualizer.getTotalSize(),
          width: '100%',
          position: 'relative',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            transform: `translateY(${virtualRows[0]?.start ?? 0}px)`,
          }}
        >
          {virtualRows.map(virtualRow => (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
            >
              {renderRow(items[virtualRow.index], virtualRow.index)}
            </div>
          ))}
        </div>
      </div>
    </ScrollArea.Autosize>
  );
}
