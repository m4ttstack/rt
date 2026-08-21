// The apps table and the strays table share one row template, per
// board.html.
import { useState } from "react";
import { Badge, Button, Chip, ICONS, Modal, Spinner, StatusDot, Switch, Table, Tooltip } from "@mattstack/tui-kit";
import { accessSummary, isPlatform, type Row, type StatusData } from "./logic.ts";
import type { BoardState } from "./useBoardState.ts";

export interface AppsSection {
  key: string;
  title: string | null;
  rows: Row[];
}

export function AppsTable({ section, data, board }: { section: AppsSection; data: StatusData; board: BoardState }) {
  const { isRestarting, onRestart, onPublish, openAccess } = board;
  return (
    <Table>
      {section.key === "apps" && (
        <Table.Head>
          <Table.HeadCell>site</Table.HeadCell>
          <Table.HeadCell>port</Table.HeadCell>
          <Table.HeadCell>health</Table.HeadCell>
          <Table.HeadCell>service</Table.HeadCell>
          <Table.HeadCell>public</Table.HeadCell>
          <Table.HeadCell>access</Table.HeadCell>
          <Table.HeadCell />
          <Table.HeadCell />
        </Table.Head>
      )}
      <Table.Body>
        {section.rows.map((row) => {
          const restarting = isRestarting(row);
          return (
            <Table.Row key={row.name}>
              <Table.Cell>
                <SiteCell row={row} data={data} restarting={restarting} />
              </Table.Cell>
              <Table.Cell>
                <PortCell row={row} data={data} />
              </Table.Cell>
              <Table.Cell>
                <HealthCell row={row} restarting={restarting} />
              </Table.Cell>
              <Table.Cell>
                <ServiceCell row={row} />
              </Table.Cell>
              <Table.Cell>
                <PublishCell row={row} data={data} onPublish={onPublish} />
              </Table.Cell>
              <Table.Cell>
                <AccessCell row={row} data={data} onOpenAccess={openAccess} />
              </Table.Cell>
              <Table.Cell>
                <RestartCell row={row} data={data} restarting={restarting} onRestart={onRestart} />
              </Table.Cell>
              <Table.Cell>
                <ChevronCell row={row} />
              </Table.Cell>
            </Table.Row>
          );
        })}
      </Table.Body>
    </Table>
  );
}

/** The running pid a service actually answers on -- launchd's own `pid` when
    managed, the foreign process's when a route is served unmanaged. */
function servicePid(service: NonNullable<Row["service"]>): number | null {
  return service.unmanaged ? service.unmanaged.pid : service.pid;
}

/** ok/warn/bad for the row's leading dot: restarting outranks the health
    probe (which outranks a bare service pid) because a row mid-restart is
    still probeable and would otherwise flash bad before the new process
    comes up. */
function healthTone(row: Row, restarting: boolean): "ok" | "warn" | "bad" {
  if (restarting) return "warn";
  if (row.health) return row.health.ok ? "ok" : "bad";
  if (row.service) return servicePid(row.service) !== null ? "ok" : "bad";
  return "bad";
}

function healthTip(row: Row, restarting: boolean): string {
  if (restarting) return "restarting…";
  if (row.health) return row.health.status !== null ? `HTTP ${row.health.status}` : "unreachable";
  if (row.service) return servicePid(row.service) !== null ? "running" : "stopped";
  return "no route";
}

function SiteCell({ row, data, restarting }: { row: Row; data: StatusData; restarting: boolean }) {
  return (
    <>
      <StatusDot intent={healthTone(row, restarting)} tip={healthTip(row, restarting)} />
      {row.url ? (
        <span className="site-name">
          <a className="unstyled" href={row.url}>
            <strong>{row.name}</strong>
            <span className="muted">.{data.suffix}</span>
          </a>
          {row.publicUrl && row.publicUrl !== row.url && (
            <Tooltip
              tip={
                row.published
                  ? `open ${row.publicUrl.replace("https://", "")}`
                  : "private — not publicly reachable"
              }
            >
              <a
                className={row.published ? "muted" : "muted-more"}
                href={row.publicUrl}
                target="_blank"
                rel="noopener"
                aria-label={
                  row.published
                    ? `open ${row.publicUrl.replace("https://", "")}`
                    : "private — not publicly reachable"
                }
              >
                {ICONS["external-link"]}
              </a>
            </Tooltip>
          )}
        </span>
      ) : (
        <span className="muted">{row.name}</span>
      )}
      {/* Who owns this row's structure belongs with the row's identity, not
          in the column of things you can click. */}
      {isPlatform(row.managedBy ?? undefined) && (
        <Tooltip tip="this is Deck itself, `deck uninstall` to remove it">
          <Chip uppercase aria-label="this is Deck itself, `deck uninstall` to remove it">
            this board
          </Chip>
        </Tooltip>
      )}
      {row.managedBy && row.managedBy !== "user" && !isPlatform(row.managedBy) && (
        <Tooltip tip={`structure is owned by ${row.managedBy}`}>
          <Chip uppercase aria-label={`structure is owned by ${row.managedBy}`}>
            managed · {row.managedBy}
          </Chip>
        </Tooltip>
      )}
      {(row.issues || []).map((issue) => (
        <span className="preflight-issue" key={issue.source}>
          <Badge intent="bad">
            {ICONS["triangle-alert"]}
            <span>{issue.source} sync failed</span>
          </Badge>
          <code className="muted">{issue.message}</code>
        </span>
      ))}
    </>
  );
}

function PortCell({ row, data }: { row: Row; data: StatusData }) {
  if (row.port == null) return <span className="muted">no route</span>;
  // The board's own row can never carry an override in practice, but the
  // dev chip still checks `self` defensively: showing "override" on the
  // board's own listing of itself would be self-contradictory.
  const override = row.override && data.canManage && !row.self ? row.override : null;
  return (
    <span>
      {row.port}
      {override && (
        <Tooltip tip={`dev port override, normally ${override.basePort}`}>
          <Chip uppercase aria-label={`dev port override, normally ${override.basePort}`}>
            dev
          </Chip>
        </Tooltip>
      )}
    </span>
  );
}

function HealthCell({ row, restarting }: { row: Row; restarting: boolean }) {
  if (restarting) {
    return (
      <Badge intent="warn">
        <Spinner size="xs" />
        restarting…
      </Badge>
    );
  }
  return (
    <span>
      {row.health && row.health.status === null && (
        <Tooltip tip="no response">
          <Badge intent="bad">unreachable</Badge>
        </Tooltip>
      )}
      {row.health && row.health.status !== null && (
        <Tooltip tip={`HTTP ${row.health.status}`}>
          <Badge intent={row.health.ok ? "ok" : "bad"}>
            {row.health.status} {row.health.ms}ms
          </Badge>
        </Tooltip>
      )}
      {/* No HTTP probe (unrouted rows): the badge falls back to the service's
          own pid, which is the only signal left to call ok/bad. */}
      {!row.health && row.service && (
        <Badge intent={servicePid(row.service) !== null ? "ok" : "bad"}>
          {servicePid(row.service) !== null ? "running" : "stopped"}
        </Badge>
      )}
      {!row.health && !row.service && <span className="muted">no route</span>}
      {row.service && row.service.stderr && row.service.stderr.length > 0 && <StderrTrigger row={row} />}
    </span>
  );
}

function StderrTrigger({ row }: { row: Row }) {
  const [open, setOpen] = useState(false);
  if (!row.service) return null;
  const service = row.service;
  return (
    <>
      <Button
        variant="subtle"
        size="sm"
        iconOnly
        aria-label={`show recent stderr for ${row.name}`}
        onClick={() => setOpen(true)}
      >
        {ICONS["file-warning"]}
      </Button>
      {open && (
        <Modal title="recent stderr" ariaLabel={`recent stderr for ${row.name}`} onClose={() => setOpen(false)}>
          <p>{row.name}</p>
          <pre>{service.stderr.join("\n")}</pre>
        </Modal>
      )}
    </>
  );
}

function ServiceCell({ row }: { row: Row }) {
  if (!row.service) return <span className="muted">no service</span>;
  const service = row.service;
  const pid = servicePid(service);
  if (pid !== null) return <span className="muted">pid {pid}</span>;
  if (service.lastExitStatus != null) return <Badge intent="bad">exit {service.lastExitStatus}</Badge>;
  return <span className="muted">stopped</span>;
}

function PublishCell({
  row,
  data,
  onPublish,
}: {
  row: Row;
  data: StatusData;
  onPublish: (row: Row) => Promise<void>;
}) {
  if (!(data.canManage && row.port != null)) return null;
  const label = row.published ? `make ${row.name} private` : `publish ${row.name}`;
  const tip = row.published ? "public — click to make private" : "private — click to publish";
  return (
    <Tooltip tip={tip}>
      <Switch checked={row.published} onChange={() => onPublish(row)} aria-label={label} />
    </Tooltip>
  );
}

function AccessCell({
  row,
  data,
  onOpenAccess,
}: {
  row: Row;
  data: StatusData;
  onOpenAccess: (row: Row) => void;
}) {
  if (!(data.canManage && row.port != null)) return null;
  const summary = accessSummary(row);
  return (
    // Two glyphs, no text: the column stays narrow, and the full sentence
    // rides both the tooltip and aria-label so it is reachable by hover and
    // by screen reader. Cloudflare sync failures are NOT shown here: the
    // site cell already renders every row.issues entry, with the message
    // attached.
    <Tooltip tip={summary}>
      <Button
        variant="subtle"
        size="sm"
        iconOnly
        aria-label={`${summary}, change access`}
        onClick={() => onOpenAccess(row)}
      >
        <span className={row.hasPassword ? undefined : "muted-more"}>{ICONS["lock-keyhole"]}</span>
        <span className={row.oauth && row.oauth.mode !== "off" ? undefined : "muted-more"}>
          {ICONS["user-round-check"]}
        </span>
      </Button>
    </Tooltip>
  );
}

function RestartCell({
  row,
  data,
  restarting,
  onRestart,
}: {
  row: Row;
  data: StatusData;
  restarting: boolean;
  onRestart: (row: Row) => void;
}) {
  if (!(data.canRestart && row.service)) return null;
  return (
    <Button
      variant="subtle"
      size="sm"
      iconOnly
      disabled={restarting}
      aria-label={`restart ${row.service.short}`}
      onClick={() => onRestart(row)}
    >
      {ICONS["refresh-cw"]}
    </Button>
  );
}

/** Inert for now: a later drawer feature wires this to open the row's
    details. A plain `<button>`, not the kit `Button`, because it needs the
    `row-chevron` part that wiring selects on -- Button's non-overridable
    tail always stamps `data-part="button"`. Exported: TunnelSection's rows
    share this same cell. */
export function ChevronCell({ row }: { row: Row }) {
  return (
    <button
      type="button"
      className="row-chevron"
      data-part="row-chevron"
      aria-label={`details for ${row.name}`}
      onClick={() => {}}
    >
      ›
    </button>
  );
}
