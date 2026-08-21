// The apps table and the strays table share one row template, per
// board.html. PortCell renders the plain-text branch; the editable port UI
// replaces it.
import { useState } from "react";
import { Badge, Button, Chip, ICONS, Modal, Spinner, Switch, Table } from "@mattstack/tui-kit";
import { accessSummary, isPlatform, type Row, type StatusData } from "./logic.ts";
import type { BoardState } from "./useBoardState.ts";

export interface AppsSection {
  key: string;
  title: string | null;
  rows: Row[];
}

export function AppsTable({ section, data, board }: { section: AppsSection; data: StatusData; board: BoardState }) {
  const { isRestarting, onRestart, onPublish, openEdit, onRemove, openAccess } = board;
  return (
    <Table>
      {section.key === "apps" && (
        <Table.Head>
          <Table.HeadCell>site</Table.HeadCell>
          <Table.HeadCell>port</Table.HeadCell>
          <Table.HeadCell>health</Table.HeadCell>
          <Table.HeadCell>launchd</Table.HeadCell>
          <Table.HeadCell>public</Table.HeadCell>
          <Table.HeadCell>access</Table.HeadCell>
          <Table.HeadCell />
        </Table.Head>
      )}
      <Table.Body>
        {section.rows.map((row) => (
          <Table.Row key={row.name}>
            <Table.Cell>
              <SiteCell row={row} data={data} />
            </Table.Cell>
            <Table.Cell>
              <PortCell row={row} />
            </Table.Cell>
            <Table.Cell>
              <HealthCell row={row} restarting={isRestarting(row)} />
            </Table.Cell>
            <Table.Cell>
              <LaunchdCell row={row} />
            </Table.Cell>
            <Table.Cell>
              <PublishCell row={row} data={data} onPublish={onPublish} />
            </Table.Cell>
            <Table.Cell>
              <AccessCell row={row} data={data} onOpenAccess={openAccess} />
            </Table.Cell>
            <Table.Cell align="end">
              <ActionsCell
                row={row}
                data={data}
                restarting={isRestarting(row)}
                onRestart={onRestart}
                onEdit={openEdit}
                onRemove={onRemove}
              />
            </Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table>
  );
}

function SiteCell({ row, data }: { row: Row; data: StatusData }) {
  return (
    <>
      {row.url ? (
        <span className="site-name">
          <a className="unstyled" href={row.url}>
            <strong>{row.name}</strong>
            <span className="muted">.{data.suffix}</span>
          </a>
          {row.publicUrl && row.publicUrl !== row.url && (
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
              title={
                row.published
                  ? `open ${row.publicUrl.replace("https://", "")}`
                  : "private — not publicly reachable"
              }
            >
              {ICONS["external-link"]}
            </a>
          )}
        </span>
      ) : (
        <span className="muted">{row.name}</span>
      )}
      {/* Who owns this row's structure belongs with the row's identity, not
          in the column of things you can click. */}
      {isPlatform(row.managedBy ?? undefined) && (
        <Chip
          uppercase
          title="this is Deck itself, `deck uninstall` to remove it"
          aria-label="this is Deck itself, `deck uninstall` to remove it"
        >
          this board
        </Chip>
      )}
      {row.managedBy && row.managedBy !== "user" && !isPlatform(row.managedBy) && (
        <Chip uppercase title={`structure is owned by ${row.managedBy}`} aria-label={`structure is owned by ${row.managedBy}`}>
          managed · {row.managedBy}
        </Chip>
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

/** Plain-text placeholder; the editable port cell replaces this. */
function PortCell({ row }: { row: Row }) {
  return <span className="muted">{row.port != null ? row.port : "—"}</span>;
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
      {!row.health && <span className="muted">no route</span>}
      {row.health && row.health.status === null && (
        <Badge intent="bad" title="no response">
          unreachable
        </Badge>
      )}
      {row.health && row.health.status !== null && (
        <Badge intent={row.health.ok ? "ok" : "bad"} title={`HTTP ${row.health.status}`}>
          {row.health.status} {row.health.ms}ms
        </Badge>
      )}
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
        variant="ghost"
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

function LaunchdCell({ row }: { row: Row }) {
  if (!row.service) return <span className="muted">no launchd service</span>;
  const service = row.service;
  if (service.unmanaged) {
    return (
      <span>
        <Badge intent="warn">unmanaged</Badge> served by <code>{service.unmanaged.command}</code>{" "}
        <span>pid {service.unmanaged.pid}</span>
        <span className="muted"> · service {service.short} stopped</span>
      </span>
    );
  }
  if (service.pid !== null) {
    return (
      <span>
        <span>
          <Badge intent="ok">running</Badge> <span>pid {service.pid}</span>
        </span>
        <span className="muted"> · {service.short}</span>
      </span>
    );
  }
  return (
    <span>
      <span>
        <Badge intent="bad">stopped</Badge>
        {service.lastExitStatus != null && <span> exit {service.lastExitStatus}</span>}
      </span>
      <span className="muted"> · {service.short}</span>
    </span>
  );
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
  const title = row.published ? "public — click to make private" : "private — click to publish";
  return <Switch checked={row.published} onChange={() => onPublish(row)} aria-label={label} title={title} />;
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
    // rides both title and aria-label so it is reachable by hover and by
    // screen reader. Cloudflare sync failures are NOT shown here: the site
    // cell already renders every row.issues entry, with the message attached.
    <Button
      variant="ghost"
      size="sm"
      iconOnly
      title={summary}
      aria-label={`${summary}, change access`}
      onClick={() => onOpenAccess(row)}
    >
      <span className={row.hasPassword ? undefined : "muted-more"}>{ICONS["lock-keyhole"]}</span>
      <span className={row.oauth && row.oauth.mode !== "off" ? undefined : "muted-more"}>
        {ICONS["user-round-check"]}
      </span>
    </Button>
  );
}

function ActionsCell({
  row,
  data,
  restarting,
  onRestart,
  onEdit,
  onRemove,
}: {
  row: Row;
  data: StatusData;
  restarting: boolean;
  onRestart: (row: Row) => void;
  onEdit: (row: Row) => void;
  onRemove: (row: Row) => void;
}) {
  return (
    <span className="row-actions">
      {data.canRestart && row.service && (
        <Button
          variant="outline"
          size="sm"
          iconOnly
          disabled={restarting}
          aria-label={row.service ? `restart ${row.service.short}` : "restart service"}
          onClick={() => onRestart(row)}
        >
          {ICONS["refresh-cw"]}
        </Button>
      )}
      {data.canManage && row.managedBy === "user" && (
        <span className="row-actions">
          <Button variant="outline" size="sm" iconOnly aria-label={`edit ${row.name}`} onClick={() => onEdit(row)}>
            {ICONS.pencil}
          </Button>
          <Button
            variant="outline"
            size="sm"
            iconOnly
            intent="bad"
            aria-label={`remove ${row.name}`}
            onClick={() => onRemove(row)}
          >
            {ICONS["trash-2"]}
          </Button>
        </span>
      )}
    </span>
  );
}
