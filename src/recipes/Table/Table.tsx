import type { ComponentProps, HTMLAttributes, ReactNode, TdHTMLAttributes } from "react";
import { defineComponent } from "../../builders.ts";
import classes from "./Table.module.css";

/** Authoring category (1 = pure styled primitive). Read off this module by
    scripts/derive.ts to build the kit's manifest; not dead code. */
export const recipeCategory = 1 as const;

const TABLE_SELECTORS = ["root", "table"] as const;

/** Stable selector surface for app-side CSS. Every part is listed here even
    though only `root`/`table` are Styles-API slots: `head`/`headcell`/`body`/
    `row`/`cell` are hand-rolled subcomponents that stamp these same names
    directly, and a consumer styling any inner part reaches for `[data-part]`
    either way — that attribute, not the Styles-API surface, is the kit's
    stated cross-boundary contract for this recipe. */
export const TABLE_PARTS = {
  root: "table",
  table: "table-table",
  head: "table-head",
  headcell: "table-headcell",
  body: "table-body",
  row: "table-row",
  cell: "table-cell",
} as const;

/** Verbatim scalar the headcell's uppercase tracking rides — an em value, so
    it cannot be a theme rung, but still needs a `var()` outlet to pass the
    no-hardcoded-values gate. Set on `root`; inherits down through
    table/thead/th like any custom property. */
const TABLE_SCALARS: Record<string, string> = {
  "--sb-table-tracking": "0.05em",
};

/** The root part's own props; `TableProps` below is the full public surface. */
export interface TableOwnProps {
  children?: ReactNode;
}

type TableProps_ = TableOwnProps & Omit<HTMLAttributes<HTMLDivElement>, "ref" | "children">;

/** `Cell`'s own props. The default (`undefined`/`"start"`) stamps no
    `data-align`, so a plain `<td>` styling rule never has to fight a
    same-specificity attribute selector. */
export interface TableCellOwnProps {
  align?: "start" | "end";
}

const TableRoot = defineComponent<
  TableProps_,
  typeof TABLE_SELECTORS,
  readonly [],
  readonly [],
  HTMLDivElement
>({
  name: "Table",
  selectors: TABLE_SELECTORS,
  classes,
  // Nothing to merge with the builder's automatic autoVars output, which a
  // recipe-supplied resolver replaces: Table declares no `variants`.
  vars: () => ({ root: { ...TABLE_SCALARS } }),
  render: ({ props, getStyles, ref }) => {
    const {
      children,
      classNames: _classNames,
      styles: _styles,
      vars: _vars,
      attributes: _attributes,
      unstyled: _unstyled,
      ...rest
    } = props;

    return (
      <div ref={ref} {...rest} {...getStyles("root")} data-part={TABLE_PARTS.root}>
        <table {...getStyles("table")} data-part={TABLE_PARTS.table}>
          {children}
        </table>
      </div>
    );
  },
});

/** Hand-rolled: a header row is always exactly one `<tr>` of `<Table.HeadCell>`s,
    so nothing here needs its own Styles-API slot — see this file's header
    comment. */
function Head({ children }: { children?: ReactNode }) {
  return (
    <thead className={classes.head} data-part={TABLE_PARTS.head}>
      <tr>{children}</tr>
    </thead>
  );
}

function HeadCell({ children }: { children?: ReactNode }) {
  return (
    <th className={classes.headcell} data-part={TABLE_PARTS.headcell}>
      {children}
    </th>
  );
}

function Body({ children }: { children?: ReactNode }) {
  return (
    <tbody className={classes.body} data-part={TABLE_PARTS.body}>
      {children}
    </tbody>
  );
}

/** Takes the full DOM prop surface (key aside — React reserves that): a
    consuming board's hover-reveal keys off `[data-part="table-row"]:hover`
    and needs real row-level event handlers and aria attributes to reach it. */
function Row({ children, ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr className={classes.row} data-part={TABLE_PARTS.row} {...rest}>
      {children}
    </tr>
  );
}

// `Omit<..., "align">`: TdHTMLAttributes carries its own deprecated `align`
// (a disjoint "left"|"center"|"right"|"justify"|"char" union) — a plain
// intersection with TableCellOwnProps.align collapses to `undefined` only.
function Cell({
  align,
  children,
  ...rest
}: TableCellOwnProps & Omit<TdHTMLAttributes<HTMLTableCellElement>, "align">) {
  return (
    <td
      className={classes.cell}
      data-part={TABLE_PARTS.cell}
      data-align={align === "end" ? "end" : undefined}
      {...rest}
    >
      {children}
    </td>
  );
}

export const Table = Object.assign(TableRoot, { Head, HeadCell, Body, Row, Cell });

/** Everything a call site may pass to the root, own props included. */
export type TableProps = ComponentProps<typeof Table>;

/** No-op `.extend({})` a consumer's `createTheme({ components })` starts from. */
export const tableTheme = Table.extend({});
