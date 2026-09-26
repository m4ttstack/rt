import { forwardRef } from 'react';
// eslint-disable-next-line no-restricted-imports -- shadow definition site: this IS the `@mattstack/app-kit/core` Table the eslint wall (eslint.config.js) points everything else at.
import { Table as MantineTable, Paper } from '@mantine/core';
import type {
  MantineRadius,
  MantineSpacing,
  TableProps as MantineTableProps,
  StyleProp,
} from '@mantine/core';
import clsx from 'clsx';

import { useSchemeColors } from '@mattstack/app-kit/hooks';

// The raw `@mantine/core` Table, re-exported for the rare case a consumer
// needs the unshadowed original (its own object notation, no Paper wrapper,
// no kit defaults). Prefer the kit `Table` below.
export { MantineTable };

export interface TableProps extends Omit<MantineTableProps, 'withTableBorder'> {
  /** Render the bare `<table>` with no wrapping `Paper` surface. @default false */
  noPaper?: boolean;
  /** Tint the header row using the kit's layered background tokens (`--ui-bg-*`). @default true */
  headerAccent?: boolean;
  /** Outer border, on the `Paper` wrapper (or the table itself when `noPaper`). @default false */
  withTableBorder?: boolean;
  /** Shadow on the `Paper` wrapper. Ignored when `noPaper`. @default false */
  shadow?: boolean;
  /** Stretch the table to the width of its container. @default false */
  fullWidth?: boolean;
  /** Padding on the `Paper` wrapper (space between the surface edge and the table). Ignored when `noPaper`. */
  padding?: StyleProp<MantineSpacing>;
  /** Corner radius of the `Paper` wrapper. Ignored when `noPaper`. */
  radius?: MantineRadius;
  /** Extra content rendered inside the `Paper`, above the table (a toolbar, a caption row). Ignored when `noPaper`. */
  paperChildren?: React.ReactNode;
}

const KIT_DEFAULTS = {
  verticalSpacing: 'sm',
  horizontalSpacing: 'sm',
  withRowBorders: true,
} satisfies Partial<MantineTableProps>;

/**
 * Kit shadow of `Table`. Layered on top of `@mantine/core`'s `Table`:
 *  - wrapped in a `Paper` surface by default (rounded corners, clipped
 *    overflow) so a table reads as a distinct surface the way `Paper`/`Card`
 *    do elsewhere in the kit -- opt out with `noPaper` for a bare `<table>`.
 *  - `headerAccent` (default on) tints `Table.Thead` with the kit's layered
 *    background tokens (`--ui-bg-4`, see `useSchemeColors`/scheme-vars.css)
 *    instead of a flat/transparent header, and gives `stickyHeader` an
 *    opaque background to scroll under.
 *  - `stickyHeader`/`stickyHeaderOffset` are `@mantine/core`'s own Table
 *    props (Mantine 9 supports sticky headers natively) -- passed through
 *    unchanged.
 *
 * Forwards its ref to the underlying `<table>` (an `HTMLTableElement`),
 * matching `@mantine/core`'s own `Table` and this kit's `TextInput` shadow.
 */
const KitTable = /* @__PURE__ */ forwardRef<HTMLTableElement, TableProps>(
  function KitTable(
    {
      noPaper = false,
      headerAccent = true,
      withTableBorder = false,
      shadow = false,
      fullWidth = false,
      padding,
      radius,
      paperChildren,
      className,
      style,
      styles,
      children,
      ...props
    },
    ref
  ) {
    const { bg } = useSchemeColors();

    // `styles` can also be a function (theme, props, ctx) => record -- in that
    // rarer form we can't merge our accent in, so leave it untouched and let
    // the caller's function own the whole styles object.
    const mergedStyles: MantineTableProps['styles'] =
      typeof styles === 'function'
        ? styles
        : {
            ...styles,
            thead: {
              backgroundColor: headerAccent ? bg.level4 : undefined,
              ...styles?.thead,
            },
          };

    const table = (
      <MantineTable
        {...KIT_DEFAULTS}
        {...props}
        ref={ref}
        withTableBorder={noPaper ? withTableBorder : false}
        styles={mergedStyles}
        className={clsx(className, fullWidth && 'ui-table--full-width')}
        style={fullWidth ? { width: '100%', ...style } : style}
      >
        {children}
      </MantineTable>
    );

    if (noPaper) {
      return table;
    }

    return (
      <Paper
        component="div"
        shadow={shadow ? 'sm' : 'none'}
        withBorder={withTableBorder}
        radius={radius}
        p={padding}
        style={{ overflow: 'hidden' }}
      >
        {paperChildren}
        {table}
      </Paper>
    );
  }
);

// Restore the object notation of the mantine Table -- both the kit's
// preferred Mantine-native names (Table.Thead, Table.Tr, ...) AND the
// reference's role aliases (Table.Header, Table.Row, Table.Cell, ...) so
// call sites in either vocabulary work. Mirrors @mantine/core's
// TableFactory.staticComponents completely, including DataRenderer.
// displayName rides the same PURE Object.assign (a bare
// `KitTable.displayName = ...` statement would pin this module in consumer
// bundles even when Table is unused).
export const Table = /* @__PURE__ */ (() =>
  Object.assign(KitTable, {
    displayName: 'Table',
    Thead: MantineTable.Thead,
    Tbody: MantineTable.Tbody,
    Tfoot: MantineTable.Tfoot,
    Th: MantineTable.Th,
    Tr: MantineTable.Tr,
    Td: MantineTable.Td,
    Caption: MantineTable.Caption,
    ScrollContainer: MantineTable.ScrollContainer,
    DataRenderer: MantineTable.DataRenderer,
    // Role aliases (reference vocabulary).
    Header: MantineTable.Thead,
    Body: MantineTable.Tbody,
    Footer: MantineTable.Tfoot,
    HeaderCell: MantineTable.Th,
    Row: MantineTable.Tr,
    Cell: MantineTable.Td,
  }))();
