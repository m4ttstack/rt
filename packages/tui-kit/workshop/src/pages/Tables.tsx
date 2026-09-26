import { Badge, Button, Chip, Table, TABLE_PARTS } from "@mattstack/tui-kit";

/**
 * The Table recipe's workshop page.
 *
 * Imports from the BARREL (`@mattstack/tui-kit`), never a deep
 * `../../src/recipes/…` path — same rule every other workshop page follows.
 *
 * No scheme toggle of its own — the sidebar's Dark button flips `.dark` on
 * <html>, which is what proves the row hover wash and header tracking hold up
 * in both schemes.
 */

const surface = {
  display: "inline-block",
  padding: "1rem",
  background: "var(--panel)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  marginTop: "1rem",
} as const;

export function Tables() {
  return (
    <div>
      <h1>Table</h1>
      <p>
        The board's data grid. Only the root (<code>Table</code>) is a
        Styles-API recipe — <code>Table.Head</code>, <code>Table.HeadCell</code>,{" "}
        <code>Table.Body</code>, <code>Table.Row</code> and{" "}
        <code>Table.Cell</code> are hand-rolled subcomponents that render
        semantic table markup with a module class and a{" "}
        <code>data-part</code> directly. Hover a row.
      </p>

      <h2 style={{ marginTop: "2rem" }}>a deck board section</h2>
      <div style={surface}>
        <Table>
          <Table.Head>
            <Table.HeadCell>site</Table.HeadCell>
            <Table.HeadCell>status</Table.HeadCell>
            <Table.HeadCell>latency</Table.HeadCell>
          </Table.Head>
          <Table.Body>
            <Table.Row>
              <Table.Cell>edge-01</Table.Cell>
              <Table.Cell>
                <Chip intent="ok">healthy</Chip>
              </Table.Cell>
              <Table.Cell align="end">
                <Badge intent="ok">34ms</Badge>
              </Table.Cell>
            </Table.Row>
            <Table.Row>
              <Table.Cell>edge-02</Table.Cell>
              <Table.Cell>
                <Chip intent="warn" pulse>
                  degraded
                </Chip>
              </Table.Cell>
              <Table.Cell align="end">
                <Badge intent="warn">212ms</Badge>
              </Table.Cell>
            </Table.Row>
            <Table.Row>
              <Table.Cell>edge-03</Table.Cell>
              <Table.Cell>
                <Chip intent="bad">down</Chip>
              </Table.Cell>
              <Table.Cell align="end">
                <Button intent="bad" size="sm">
                  restart
                </Button>
              </Table.Cell>
            </Table.Row>
          </Table.Body>
        </Table>
      </div>

      <h2 style={{ marginTop: "2rem" }}>data-part</h2>
      <p>
        The root div carries <code>data-part="{TABLE_PARTS.root}"</code> and
        wraps a <code>data-part="{TABLE_PARTS.table}"</code> table; every inner
        part stamps its own name (<code>{TABLE_PARTS.head}</code>,{" "}
        <code>{TABLE_PARTS.headcell}</code>, <code>{TABLE_PARTS.body}</code>,{" "}
        <code>{TABLE_PARTS.row}</code>, <code>{TABLE_PARTS.cell}</code>) — the
        cross-boundary contract a consuming app's <code>[data-part]</code>{" "}
        selectors reach for, including{" "}
        <code>[data-part="{TABLE_PARTS.row}"]:hover</code> for the hover-reveal
        deck rows use.
      </p>
    </div>
  );
}
