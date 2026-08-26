import type { ReactNode } from 'react';

import type { VirtualTableColumn } from '@ui/core';

export interface CreateDynamicTableParams<T, D extends object> {
  /** Raw input rows. */
  data: T[];
  /** Adapts each raw row into the shape the table renders. */
  adapter: (item: T) => D;
  /**
   * Per-field cell overrides, keyed by the adapted row's field name. Falls
   * back to `String(value)` when omitted.
   *
   * Deliberately a mapped type rather than the equivalent
   * `Partial<Record<keyof D, ...>>`: the `Record` form defeats contextual
   * typing while `D` is still being inferred from `adapter`, leaving each
   * override's `row` parameter an implicit `any` at call sites. The mapped
   * form types `row` as the adapted row with no annotation needed.
   */
  customCells?: { [K in keyof D]?: (row: D) => ReactNode };
}

export interface CreateDynamicTableResult<D extends object> {
  data: D[];
  columns: VirtualTableColumn<D>[];
}

function humanizeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // camelCase -> spaced
    .replace(/[_-]+/g, ' ') // snake_case / kebab-case -> spaced
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, char => char.toUpperCase());
}

/**
 * Derives a table's columns from its data instead of hand-writing a column
 * list: adapts every row with `adapter`, then reads the *shape* of the
 * first adapted row to build one column per field (skipping `id`), with a
 * humanized header (`orderTotal` -> `Order Total`) and a default
 * `String(value)` cell renderer -- overridable per field via `customCells`.
 *
 * Column shape matches `@ui/core`'s `VirtualTableColumn` (`{ key, header,
 * cell }`) so the result drops straight into `VirtualTable`, or into a
 * plain `Table` by mapping over `columns` by hand.
 *
 * A prior version of this helper built a third-party data-grid library's
 * own column-def type (via a string-humanizing utility library's
 * `titleize(underscore(key))`) instead -- neither that data-grid library nor
 * the string-humanizing one are dependencies of this kit, so the column type
 * and the header-humanizing logic are both reimplemented here without them.
 * That prior version's paired memoizing hook (which also seeded that
 * library's own default table options) was domain-flavored to that library
 * and is not carried over -- callers here can `useMemo` this function
 * themselves.
 */
export function createDynamicTable<T, D extends object>({
  data,
  adapter,
  customCells,
}: CreateDynamicTableParams<T, D>): CreateDynamicTableResult<D> {
  const tableData = data.map(adapter);

  const columns: VirtualTableColumn<D>[] =
    tableData.length === 0
      ? []
      : (Object.keys(tableData[0]) as (keyof D)[])
          .filter(key => key !== 'id')
          .map(key => ({
            key: String(key),
            header: humanizeKey(String(key)),
            cell: customCells?.[key] ?? (row => String(row[key] ?? '')),
          }));

  return { data: tableData, columns };
}
