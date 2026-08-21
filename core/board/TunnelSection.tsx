import { Badge, Button, ICONS, Spinner, Table } from "@mattstack/tui-kit";
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
                  <strong>Cloudflare tunnel</strong> <span className="muted">{row.name}</span>
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
                    <span>
                      <Badge intent="ok">running</Badge> <span>pid {row.service.pid}</span>
                    </span>
                  ) : (
                    <span>
                      <Badge intent="bad">stopped</Badge>
                      {row.service && row.service.lastExitStatus != null && (
                        <span> exit {row.service.lastExitStatus}</span>
                      )}
                    </span>
                  )}
                  {/* Locally there is no public domain to name, and "carries *."
                      with a dangling dot is worse than saying nothing. */}
                  {domain && <span className="muted"> carries *.{domain}</span>}
                </Table.Cell>
                <Table.Cell align="end">
                  {data.canRestart && row.service && (
                    <Button
                      variant="outline"
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
              </Table.Row>
            );
          })}
        </Table.Body>
      </Table>
    </section>
  );
}
