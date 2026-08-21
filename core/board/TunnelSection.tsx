import { Badge, Button, ICONS, Spinner, StatusDot, Table } from "@mattstack/tui-kit";
import { ChevronCell } from "./AppsTable.tsx";
import { tunnelDomain, type Row, type StatusData } from "./logic.ts";

export function TunnelSection({
  tunnels,
  data,
  isRestarting,
  onRestart,
}: {
  tunnels: Row[];
  data: StatusData;
  isRestarting: (row: Row) => boolean;
  onRestart: (row: Row) => void;
}) {
  if (!tunnels.length) return null;
  const domain = tunnelDomain(data);
  return (
    <section className="mt-6">
      <h2>cloudflare tunnel</h2>
      <Table>
        <Table.Body>
          {tunnels.map((row) => {
            const restarting = isRestarting(row);
            const up = row.service && row.service.pid !== null;
            return (
              <Table.Row key={row.name}>
                <Table.Cell>
                  <StatusDot intent={restarting ? "warn" : up ? "ok" : "bad"} tip={row.name} />
                  {row.name}
                </Table.Cell>
                <Table.Cell>
                  {/* Locally there is no public domain to name, and "carries *."
                      with a dangling dot is worse than saying nothing. */}
                  {domain && <span className="muted">carries *.{domain}</span>}
                </Table.Cell>
                <Table.Cell>
                  {restarting ? (
                    <Badge intent="warn">
                      <Spinner size="xs" />
                      restarting…
                    </Badge>
                  ) : (
                    <Badge intent={up ? "ok" : "bad"} title={up ? "tunnel running" : "tunnel stopped"}>
                      {up ? "up" : "down"}
                    </Badge>
                  )}
                </Table.Cell>
                <Table.Cell>
                  {row.service && row.service.pid !== null ? (
                    <span className="muted">pid {row.service.pid}</span>
                  ) : row.service && row.service.lastExitStatus != null ? (
                    <Badge intent="bad">exit {row.service.lastExitStatus}</Badge>
                  ) : (
                    <span className="muted">stopped</span>
                  )}
                </Table.Cell>
                <Table.Cell />
                <Table.Cell>
                  {data.canRestart && row.service && (
                    <Button
                      variant="subtle"
                      size="sm"
                      iconOnly
                      disabled={restarting}
                      aria-label="restart tunnel"
                      onClick={() => onRestart(row)}
                    >
                      {ICONS["refresh-cw"]}
                    </Button>
                  )}
                </Table.Cell>
                <Table.Cell>
                  <ChevronCell row={row} />
                </Table.Cell>
              </Table.Row>
            );
          })}
        </Table.Body>
      </Table>
    </section>
  );
}
