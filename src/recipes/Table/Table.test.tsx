import { describe, expect, it } from "vitest";
import { renderWithTheme } from "../../../test/test-utils.tsx";
import { Table, TABLE_PARTS } from "./Table.tsx";

/**
 * Browser tier for the Table recipe.
 *
 * Every render goes through `renderWithTheme`. `data-part` is the one
 * sanctioned structural assertion — the attribute IS the cross-boundary
 * contract this recipe hands consumers, since only `root`/`table` are
 * Styles-API slots and everything else is a hand-rolled subcomponent.
 */

function partOf(container: HTMLElement, part: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-part="${part}"]`);
  if (!el) throw new Error(`no [data-part="${part}"] rendered`);
  return el;
}

describe("Table (browser)", () => {
  it("renders a root div wrapping a table, both carrying their data-part", async () => {
    const screen = await renderWithTheme(
      <Table>
        <tbody />
      </Table>,
    );

    const root = partOf(screen.container, TABLE_PARTS.root);
    expect(root.tagName).toBe("DIV");

    const table = partOf(screen.container, TABLE_PARTS.table);
    expect(table.tagName).toBe("TABLE");
    expect(root.contains(table)).toBe(true);
  });

  it("Head renders a thead>tr wrapping its HeadCell children", async () => {
    const screen = await renderWithTheme(
      <Table>
        <Table.Head>
          <Table.HeadCell>site</Table.HeadCell>
          <Table.HeadCell>status</Table.HeadCell>
        </Table.Head>
      </Table>,
    );

    const head = partOf(screen.container, TABLE_PARTS.head);
    expect(head.tagName).toBe("THEAD");
    const tr = head.querySelector("tr");
    expect(tr).not.toBeNull();

    const headCells = screen.container.querySelectorAll(`[data-part="${TABLE_PARTS.headcell}"]`);
    expect(headCells).toHaveLength(2);
    for (const cell of headCells) expect(cell.tagName).toBe("TH");
    expect(headCells[0]?.textContent).toBe("site");
  });

  it("Body/Row/Cell render tbody/tr/td, each carrying its own part", async () => {
    const screen = await renderWithTheme(
      <Table>
        <Table.Body>
          <Table.Row>
            <Table.Cell>alpha</Table.Cell>
          </Table.Row>
        </Table.Body>
      </Table>,
    );

    const body = partOf(screen.container, TABLE_PARTS.body);
    expect(body.tagName).toBe("TBODY");

    const row = partOf(screen.container, TABLE_PARTS.row);
    expect(row.tagName).toBe("TR");
    expect(body.contains(row)).toBe(true);

    const cell = partOf(screen.container, TABLE_PARTS.cell);
    expect(cell.tagName).toBe("TD");
    expect(cell.textContent).toBe("alpha");
    expect(row.contains(cell)).toBe(true);
  });

  it('Cell align="end" stamps data-align="end"', async () => {
    const screen = await renderWithTheme(
      <Table>
        <Table.Body>
          <Table.Row>
            <Table.Cell align="end">12ms</Table.Cell>
          </Table.Row>
        </Table.Body>
      </Table>,
    );

    expect(partOf(screen.container, TABLE_PARTS.cell).getAttribute("data-align")).toBe("end");
  });

  it("Cell with no align stamps no data-align", async () => {
    const screen = await renderWithTheme(
      <Table>
        <Table.Body>
          <Table.Row>
            <Table.Cell>alpha</Table.Cell>
          </Table.Row>
        </Table.Body>
      </Table>,
    );

    expect(partOf(screen.container, TABLE_PARTS.cell).hasAttribute("data-align")).toBe(false);
  });

  it("Row accepts DOM props, e.g. an aria attribute", async () => {
    const screen = await renderWithTheme(
      <Table>
        <Table.Body>
          <Table.Row aria-selected="true">
            <Table.Cell>alpha</Table.Cell>
          </Table.Row>
        </Table.Body>
      </Table>,
    );

    expect(partOf(screen.container, TABLE_PARTS.row).getAttribute("aria-selected")).toBe("true");
  });

  it("a consumer className on Row MERGES with the recipe class, not replaces it", async () => {
    const screen = await renderWithTheme(
      <Table>
        <Table.Body>
          <Table.Row className="app-row">
            <Table.Cell>alpha</Table.Cell>
          </Table.Row>
        </Table.Body>
      </Table>,
    );

    const row = partOf(screen.container, TABLE_PARTS.row);
    expect(row.classList.contains("app-row")).toBe(true);
    // `border-collapse` lives on `.table`, not `.row` — instead prove the
    // recipe's own row class survived by asserting BOTH class tokens are
    // present, since a replace (rather than merge) would drop the recipe's
    // hashed module class from `classList` entirely.
    const recipeRowClass = [...row.classList].find(
      (token) => token !== "app-row" && token.length > 0,
    );
    expect(recipeRowClass).toBeDefined();
  });

  it("a consumer className merges onto the root div", async () => {
    const screen = await renderWithTheme(
      <Table className="app-table">
        <tbody />
      </Table>,
    );

    const root = partOf(screen.container, TABLE_PARTS.root);
    expect(root.classList.contains("app-table")).toBe(true);
    // `overflow-x: auto` only exists in Table.module.css's `.root`, proving the
    // module class survived alongside the consumer's own.
    expect(getComputedStyle(root).overflowX).toBe("auto");
  });
});
