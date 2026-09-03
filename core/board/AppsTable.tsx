// The apps table and the strays table share one row template, per
// board.html.
import { useState } from "react";
import { Badge, Button, Chip, Icon, ICONS, Spinner, StatusDot, Table, TextField, Tooltip } from "@mattstack/tui-kit";
import { OptimisticSwitch } from "./optimistic.tsx";
import {
  commandButtonLabel,
  commandKey,
  isPlatform,
  showDevLinkPrompt,
  type CommandRuns,
  type Row,
  type StatusData,
} from "./logic.ts";
import type { BoardState } from "./useBoardState.ts";

/** A lucide globe as one path (subpaths joined with explicit `M`, the same
    convention the kit's own ICONS follow): circle + equator + two meridians.
    Marks a row that is served from Railway, in the site cell. */
const RAILWAY_GLOBE = "M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20";

/** Shared column widths, one entry per column below, so both section tables
    (mattstack / your apps) line up down the page: `.apps-grid` fixes the
    layout in board.css and every AppsTable renders this same colgroup, so the
    grid no longer sizes to each table's own content. */
const COL_WIDTHS = ["33%", "7%", "9%", "12%", "7%", "5%", "12%", "10%", "5%"];

export interface AppsSection {
  key: string;
  title: string | null;
  rows: Row[];
}

export interface DrawerRowProps {
  /** The row currently backing the open drawer, if any -- drives the
      selected highlight. */
  openRowName: string | null;
  onOpenRow: (name: string) => void;
  /** Registers/unregisters a row's chevron DOM node so the drawer can
      restore focus to it on close, including after the row that opened it
      switches (arrow keys) or is later removed. */
  registerChevron: (name: string, el: HTMLButtonElement | null) => void;
}

export function AppsTable({
  section,
  showHead,
  data,
  board,
  openRowName,
  onOpenRow,
  registerChevron,
}: { section: AppsSection; showHead: boolean; data: StatusData; board: BoardState } & DrawerRowProps) {
  const { isRestarting, onRestart, onRunCommand, commandRuns, linkSource, onPublish } = board;
  return (
    <Table className="apps-grid">
      <colgroup>
        {COL_WIDTHS.map((w, i) => (
          <col key={i} style={{ width: w }} />
        ))}
      </colgroup>
      {showHead && (
        <Table.Head>
          <Table.HeadCell>site</Table.HeadCell>
          <Table.HeadCell>port</Table.HeadCell>
          <Table.HeadCell>health</Table.HeadCell>
          <Table.HeadCell>service</Table.HeadCell>
          {/* border-left gap, not margin: a margin on a <th> collapses in
              table layout, per board-composite.html's own gap treatment. */}
          <Table.HeadCell className="col-gap">public</Table.HeadCell>
          <Table.HeadCell />
          <Table.HeadCell />
          {/* Its own blank header cell, distinct from the manifest commands
              column just before it -- a remote push is never a manifest
              action-command, so it never shares that cell. */}
          <Table.HeadCell />
          <Table.HeadCell />
        </Table.Head>
      )}
      <Table.Body>
        {section.rows.map((row) => {
          const restarting = isRestarting(row);
          return (
            <Table.Row
              key={row.name}
              className={openRowName === row.name ? "row-selected" : undefined}
              onClick={(e) => {
                if (isDrawerClick(e)) onOpenRow(row.name);
              }}
            >
              <Table.Cell className="col-ident">
                <SiteCell row={row} data={data} restarting={restarting} />
              </Table.Cell>
              <Table.Cell className="col-ident">
                <PortCell row={row} data={data} />
              </Table.Cell>
              <Table.Cell>
                <HealthCell row={row} restarting={restarting} />
              </Table.Cell>
              <Table.Cell className="col-ident">
                <ServiceCell row={row} />
              </Table.Cell>
              <Table.Cell className="col-gap">
                <PublishCell row={row} data={data} onPublish={onPublish} />
              </Table.Cell>
              <Table.Cell>
                <RestartCell row={row} data={data} restarting={restarting} onRestart={onRestart} />
              </Table.Cell>
              <Table.Cell>
                <CommandsCell
                  row={row}
                  canManage={data.canManage}
                  onRunCommand={onRunCommand}
                  commandRuns={commandRuns}
                  linkSource={linkSource}
                />
              </Table.Cell>
              <Table.Cell>
                <ChevronCell row={row} registerRef={(el) => registerChevron(row.name, el)} />
              </Table.Cell>
            </Table.Row>
          );
        })}
      </Table.Body>
    </Table>
  );
}

/** The running pid a service actually answers on -- launchd's own `pid` when
    managed, the foreign process's when a route is served unmanaged. Exported:
    the drawer's status strip (RootScreen.tsx) needs the same reading. */
export function servicePid(service: NonNullable<Row["service"]>): number | null {
  return service.unmanaged ? service.unmanaged.pid : service.pid;
}

/** A row click opens its drawer UNLESS the click landed on an existing
    interactive control (link, switch, restart button) that already has
    its own action -- the chevron is the one button exempted, since
    opening the drawer IS its action. */
export function isDrawerClick(e: { target: EventTarget | null }): boolean {
  const target = e.target as HTMLElement;
  const interactive = target.closest?.('a, button, input, [role="switch"]');
  return !interactive || interactive.getAttribute("data-part") === "row-chevron";
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
      {row.icon && <img className="app-icon" src={row.icon} alt="" aria-hidden="true" />}
      <StatusDot intent={healthTone(row, restarting)} tip={healthTip(row, restarting)} />
      {row.url ? (
        <span className="site-name">
          <a className="unstyled" href={row.url}>
            <strong>{row.name}</strong>
            {row.displayTld && <span className="muted">.{row.displayTld}</span>}
          </a>
          {/* An unpublished row has a publicUrl the edge will not serve, so
              the globe is absent rather than dimmed: it is an open-this link,
              and there is nothing to open until the row is published. */}
          {row.published && row.publicUrl && row.publicUrl !== row.url && (
            <Tooltip tip={`open ${row.publicUrl.replace("https://", "")}`}>
              <a
                className="public-link"
                href={row.publicUrl}
                target="_blank"
                rel="noopener"
                aria-label={`open ${row.publicUrl.replace("https://", "")}`}
              >
                <Icon d={RAILWAY_GLOBE} />
              </a>
            </Tooltip>
          )}
          {row.remote && (
            <Tooltip tip={`served from Railway (${row.remote.status})`}>
              <span
                className={`railway-globe railway-${row.remote.status}`}
                aria-label={`served from Railway (${row.remote.status})`}
              >
                <Icon d={RAILWAY_GLOBE} />
              </span>
            </Tooltip>
          )}
        </span>
      ) : (
        <span className="muted">{row.name}</span>
      )}
      {/* Who owns this row's structure belongs with the row's identity, not
          in the column of things you can click. */}
      {isPlatform(row.managedBy ?? undefined) && (
        <Tooltip className="cell-tag" tip="this is Deck itself, `deck uninstall` to remove it">
          <Chip uppercase aria-label="this is Deck itself, `deck uninstall` to remove it">
            this board
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
        <Tooltip className="cell-tag" tip={`dev port override, normally ${override.basePort}`}>
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
    </span>
  );
}

function ServiceCell({ row }: { row: Row }) {
  if (!row.service) return <span className="muted">no service</span>;
  const service = row.service;
  const pid = servicePid(service);
  if (pid !== null) return <span className="muted">pid {pid}</span>;
  if (service.lastExitStatus != null) return <span className="t-bad">exit {service.lastExitStatus}</span>;
  return <span className="muted">stopped</span>;
}

/** Marks a row already serving public traffic straight off Railway rather
    than through the cloudflared tunnel -- shown regardless of `canManage` (a
    read-only fact about how the row is served, not a control). */
function PublicOriginTag({ row }: { row: Row }) {
  if (row.publicOrigin !== "railway") return null;
  const tip = "serving public traffic directly from Railway, not the tunnel";
  return (
    <Tooltip className="cell-tag" tip={tip}>
      <Chip uppercase aria-label={tip}>
        public: railway
      </Chip>
    </Tooltip>
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
  const tag = <PublicOriginTag row={row} />;
  if (!(data.canManage && row.port != null)) return tag;
  const label = row.published ? `make ${row.name} private` : `publish ${row.name}`;
  const tip = row.published ? "public — click to make private" : "private — click to publish";
  return (
    <>
      {tag}
      <Tooltip tip={tip}>
        <OptimisticSwitch checked={row.published} mutate={() => onPublish(row)} aria-label={label} />
      </Tooltip>
    </>
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

/** Dev-mode source linking replaces the manifest command buttons rather than
    sharing the cell with them: `unlinked`/`broken` rows have nothing else to
    run yet. Unlink lives in the drawer's source screen, not here — the table
    carries commands and the link-fix affordance only. */
function CommandsCell({
  row,
  canManage,
  onRunCommand,
  commandRuns,
  linkSource,
}: {
  row: Row;
  canManage: boolean;
  onRunCommand: (row: Row, name: string) => void;
  commandRuns: CommandRuns;
  linkSource: (row: Row, workingDirectory: string) => Promise<string | null>;
}) {
  // The platform's own row never gets Link/Unlink: bootstrapSelf owns its serve
  // shape, and editApp refuses to touch it structurally, so those controls
  // would only ever produce a 200 that changes nothing this button implies.
  // canManage mirrors the gate every other mutating control in this file uses
  // (Publish, Restart, Push to Railway): the PATCH these submit is 403'd on a
  // public board host, so the control must not render there either.
  if (showDevLinkPrompt(row, canManage)) {
    return (
      <DevLinkPrompt row={row} label={row.devLink === "unlinked" ? "Link source" : "fix link"} linkSource={linkSource} />
    );
  }
  return (
    <>
      {(row.commands ?? []).map((name) => {
        const phase = commandRuns[commandKey(row.name, name)];
        return (
          <Button
            key={name}
            variant="subtle"
            size="sm"
            busy={phase != null}
            aria-label={`${name} ${row.name}`}
            onClick={() => onRunCommand(row, name)}
          >
            {commandButtonLabel(name, phase)}
          </Button>
        );
      })}
    </>
  );
}

/** The one inline input shared by "Link source" (unlinked) and "fix link"
    (broken): both just resubmit `{ dev: { workingDirectory } }`, so a single
    open/value/error state serves either entry point. */
function DevLinkPrompt({
  row,
  label,
  linkSource,
}: {
  row: Row;
  label: string;
  linkSource: (row: Row, workingDirectory: string) => Promise<string | null>;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <Button variant="subtle" size="sm" aria-label={`${label} for ${row.name}`} onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  }

  const cancel = () => {
    setOpen(false);
    setValue("");
    setError(null);
  };

  const submit = async () => {
    const workingDirectory = value.trim();
    if (!workingDirectory) return;
    setBusy(true);
    const message = await linkSource(row, workingDirectory);
    setBusy(false);
    if (message) {
      setError(message);
      return;
    }
    setOpen(false);
    setValue("");
  };

  return (
    <span className="dev-link-input">
      <TextField
        value={value}
        onChange={(ev) => {
          setValue(ev.target.value);
          setError(null);
        }}
        onKeyDown={(ev) => {
          if (ev.key === "Enter") submit();
          if (ev.key === "Escape") cancel();
        }}
        placeholder="/path/to/source"
        aria-label={`source path for ${row.name}`}
        error={error}
        disabled={busy}
        inputRef={(el) => el?.focus()}
      />
      <Button
        variant="subtle"
        size="sm"
        iconOnly
        disabled={busy}
        aria-label={`confirm source path for ${row.name}`}
        onClick={submit}
      >
        {ICONS["circle-check"]}
      </Button>
      <Button variant="subtle" size="sm" iconOnly disabled={busy} aria-label={`cancel linking ${row.name}`} onClick={cancel}>
        {ICONS.close}
      </Button>
    </span>
  );
}

/** Opens the row's drawer via the row's own onClick (this button is exempted
    from `isDrawerClick`'s interactive-target check, so the click bubbles
    rather than needing its own handler). A plain `<button>`, not the kit
    `Button`, because it needs the `row-chevron` part that wiring selects on
    -- Button's non-overridable tail always stamps `data-part="button"`.
    `registerRef` feeds the drawer's chevron map, read on close to restore
    focus. */
export function ChevronCell({
  row,
  registerRef,
}: {
  row: Row;
  registerRef?: (el: HTMLButtonElement | null) => void;
}) {
  return (
    <button
      type="button"
      className="row-chevron"
      data-part="row-chevron"
      aria-label={`details for ${row.name}`}
      ref={registerRef}
    >
      ›
    </button>
  );
}
