// Root screens for the per-row drawer, per drawer-states-atlas.html "1 ·
// Roots". Every nav row now pushes a real screen: dev port
// (DevPortScreen.tsx), access (AccessScreens.tsx), logs (LogsScreen.tsx),
// and edit (EditScreen.tsx).
import { Alert, ICONS, ListGroup, StatusDot, type DrawerScreen } from "@mattstack/tui-kit";
import { OptimisticGatedToggleRow, OptimisticToggleRow } from "../optimistic.tsx";
import { servicePid } from "../AppsTable.tsx";
import { isMattstack, type Row, type StatusData, tunnelDomain } from "../logic.ts";
import type { BoardState } from "../useBoardState.ts";
import { buildAccessRoot } from "./AccessScreens.tsx";
import { buildDevPortScreen } from "./DevPortScreen.tsx";
import { buildEditScreen } from "./EditScreen.tsx";
import { buildLogsScreen } from "./LogsScreen.tsx";
import { buildSourceScreen, sourceValue } from "./SourceScreen.tsx";

/** What a root/pushed screen's row builders push onto and pop off of. Drawer
    itself owns no mutation surface -- AppDrawer is the only implementation.
    `onLeave` runs once when its frame is removed -- by `pop()`, by `close()`,
    or by a row switch -- so a screen that stashes an error in durable board
    state (e.g. access's `oauthError`) can clear it itself rather than leave
    it to bleed into whatever screen renders next. */
export interface Nav {
  push(build: ScreenBuilder, onLeave?: () => void): void;
  pop(): void;
  close(): void;
}

/** Builds a screen from the row/nav/board/data current as of the render that
    calls it, rather than a value frozen at push time -- AppDrawer rebuilds
    the whole pushed stack every render, so a mutation a pushed screen
    triggers is visible on its own screen the same render it reaches the
    root's nav-row hint. */
export type ScreenBuilder = (row: Row, nav: Nav, board: BoardState, data: StatusData) => DrawerScreen;

function logsValueHint(row: Row): { text: string; bad: boolean } {
  const n = row.service ? row.service.stderr.length : 0;
  const bad = n > 0 && (row.health ? !row.health.ok : false);
  return { text: n === 0 ? "none" : `${n} line${n === 1 ? "" : "s"}`, bad };
}

function logsValue(row: Row) {
  const { text, bad } = logsValueHint(row);
  return bad ? <span className="t-bad">{text}</span> : text;
}

/** health dot + latency/service-state text + `open ↗`, matching the site
    cell's own leading-dot logic (see AppsTable's healthTone/healthTip) but
    spelled out in full since the drawer has room the table row doesn't. */
function RootStatusStrip({ row, restarting }: { row: Row; restarting: boolean }) {
  if (restarting) {
    return (
      <p className="drawer-status">
        <StatusDot intent="warn" tip="restarting…" />
        restarting…
      </p>
    );
  }
  const pid = row.service ? servicePid(row.service) : null;
  const tone: "ok" | "bad" = row.health ? (row.health.ok ? "ok" : "bad") : pid !== null ? "ok" : "bad";
  const parts: string[] = [];
  if (row.health) {
    parts.push(row.health.status !== null ? `${row.health.status} in ${row.health.ms}ms` : "unreachable");
  } else if (row.service) {
    parts.push(pid !== null ? "running" : "stopped");
  }
  if (row.service) {
    if (pid !== null) parts.push(row.health ? `running pid ${pid}` : `pid ${pid}`);
    else if (row.service.lastExitStatus != null) parts.push(`exit ${row.service.lastExitStatus}`);
  }
  // Keyed off port alone, not `row.health`: a routeless row (stray-agent)
  // has no health probe to gate on, and would otherwise silently drop this
  // suffix -- port is the one field every unrouted row shares.
  if (row.port == null) parts.push("no route");
  const openLink = row.health?.ok && row.url;
  return (
    <p className="drawer-status">
      <StatusDot intent={tone} tip={parts.join(" · ")} />
      {parts.join(" · ")}
      {openLink && (
        <a className="drawer-status-link" href={row.url!} target="_blank" rel="noopener">
          open ↗
        </a>
      )}
    </p>
  );
}

function TunnelStatusStrip({ row, restarting }: { row: Row; restarting: boolean }) {
  if (restarting) {
    return (
      <p className="drawer-status">
        <StatusDot intent="warn" tip="restarting…" />
        restarting…
      </p>
    );
  }
  const pid = row.service ? servicePid(row.service) : null;
  const up = pid !== null;
  const health = row.health;
  const intent = health?.tone ?? (up ? "ok" : "bad");
  const parts = [health?.detail ?? (up ? "up" : "down")];
  if (row.service && pid !== null) parts.push(`running pid ${pid}`);
  else if (row.service?.lastExitStatus != null) parts.push(`exit ${row.service.lastExitStatus}`);
  if (health?.hint) parts.push(health.hint);
  return (
    <p className="drawer-status">
      <StatusDot intent={intent} tip={parts.join(" · ")} />
      {parts.join(" · ")}
    </p>
  );
}

function publicFooter(row: Row, data: StatusData): string {
  return row.published
    ? `${row.name}.${row.displayTld ?? data.suffix} is reachable through the tunnel`
    : "not public — visitors get the tunnel's 404 page";
}

function devPortValue(row: Row, data: StatusData): string {
  const overriding = row.override && data.canManage && !row.self;
  return overriding ? `${row.port} · override` : String(row.port ?? "");
}

// One word per gate, condensed to a value-hint width -- "open" reads as
// clearly as a fuller sentence would in the tight trailing column a Nav
// row's value occupies.
function accessValue(row: Row): string {
  const parts: string[] = [];
  if (row.hasPassword) parts.push("password");
  if (row.oauth && row.oauth.mode !== "off") parts.push("sign-in");
  return parts.length ? parts.join(" · ") : "open";
}

function remoteStatusText(status: NonNullable<Row["remote"]>["status"]): string {
  if (status === "deploying") return "deploying...";
  if (status === "verifying") return "verifying...";
  if (status === "live") return "live";
  return "error";
}

function remoteFooter(row: Row): string {
  return row.remote
    ? `serving public traffic from Railway (${remoteStatusText(row.remote.status)})`
    : "off, this app is only reachable through the local tunnel";
}

// Only enabling remote requires a sign-in gate (the server's own refuse
// check applies to `{enabled:true}` only) -- disabling a row that is
// already remote must stay reachable even if oauth was since turned off, or
// there would be no way back out of that state from the board.
function remoteToggleTip(row: Row): string | undefined {
  if (row.remote == null && row.hasPassword && row.oauth.mode === "off") {
    return "add sign-in access before pushing this app to Railway (a password alone does not gate the public origin)";
  }
  return undefined;
}

export function buildAppRoot(
  row: Row,
  nav: Nav,
  board: BoardState,
  data: StatusData,
  restarting: boolean,
): DrawerScreen {
  return {
    id: `root:${row.name}`,
    title: row.name,
    header: (
      <>
        <RootStatusStrip row={row} restarting={restarting} />
        {(row.issues || []).map((issue) => (
          <Alert key={issue.source} intent="bad">
            {issue.source} sync failed · {issue.message}
          </Alert>
        ))}
      </>
    ),
    content: (
      <div className="drawer-groups">
        {/* Mutations gate on canManage like every mutating table cell: the
            server 403s them from a public host, so a public board must not
            render the controls that would trigger them. */}
        {data.canManage && (
          <ListGroup footer={publicFooter(row, data)}>
            <OptimisticToggleRow
              label="public"
              checked={row.published}
              mutate={() => board.onPublish(row)}
              aria-label={row.published ? `make ${row.name} private` : `publish ${row.name}`}
            />
          </ListGroup>
        )}
        {/* A distinct group from "public" above -- remote is a platform
            control like publish (not dev-mode gated), but pushing to
            Railway and toggling the local tunnel's publish flag are
            different axes and stay visually separate rows/groups. */}
        {data.canManage && (
          <ListGroup footer={remoteFooter(row)}>
            <OptimisticGatedToggleRow
              label="remote"
              checked={row.remote != null}
              mutate={() => board.onSetRemote(row, row.remote == null)}
              disabled={remoteToggleTip(row) != null}
              disabledTip={remoteToggleTip(row)}
              aria-label={row.remote != null ? `turn off remote for ${row.name}` : `push ${row.name} to Railway`}
            />
            {row.remote && <ListGroup.Fact label="status" value={remoteStatusText(row.remote.status)} />}
          </ListGroup>
        )}
        {data.canManage && row.remote && (
          <ListGroup>
            <ListGroup.Action
              label="Push to Railway"
              onClick={() => board.onPushRemote(row)}
              disabled={row.remote.status === "deploying" || row.remote.status === "verifying"}
            />
          </ListGroup>
        )}
        <ListGroup>
          <ListGroup.Nav
            label="dev port"
            value={devPortValue(row, data)}
            onClick={() => nav.push(buildDevPortScreen)}
          />
          <ListGroup.Nav
            label="access"
            value={accessValue(row)}
            onClick={() => {
              board.openAccess(row);
              nav.push(buildAccessRoot);
            }}
          />
          <ListGroup.Nav label="logs" value={logsValue(row)} onClick={() => nav.push(buildLogsScreen)} />
          {/* The dev link, tucked here rather than the table: read-only facts
              plus relink/Unlink. Managed rows only; devLink is dev-mode gated. */}
          {isMattstack(row) && !row.self && row.devLink !== undefined && (
            <ListGroup.Nav
              label="source"
              value={
                sourceValue(row).bad ? <span className="t-bad">{sourceValue(row).text}</span> : sourceValue(row).text
              }
              onClick={() => nav.push(buildSourceScreen)}
            />
          )}
        </ListGroup>
        {data.canManage && (
          <ListGroup>
            <ListGroup.Action
              label={restarting ? "restarting…" : <>{ICONS["refresh-cw"]} restart service</>}
              busy={restarting}
              disabled={!row.service}
              onClick={() => board.onRestart(row)}
            />
            {/* Managed rows have no record-level shape to edit: the resolver
                owns serving and the manifest owns commands, so the edit
                screen (a guaranteed dead end there) is user-apps only. */}
            {!isMattstack(row) && (
              <ListGroup.Nav
                label={
                  <span className="drawer-accent-label">
                    {ICONS.pencil} edit app
                  </span>
                }
                onClick={() => {
                  board.openEdit(row);
                  // onLeave: firing closeEdit() on every exit path this frame
                  // has (kit back chevron, ✕, row switch) -- not just its own
                  // save/cancel -- is the only cleanup this screen needs; there
                  // is no row-level effect for editModal the way there is for
                  // dev port's `editing` and access's `accessModal`.
                  nav.push(buildEditScreen, () => board.closeEdit());
                }}
              />
            )}
          </ListGroup>
        )}
        {/* Extra top margin beyond the group gap, per the atlas: destructive
            actions read as a visually separate cluster, not just the next
            group in the list. */}
        {data.canManage && (
          <div className="drawer-danger-group">
            <ListGroup>
              <ListGroup.Danger label="remove app…" onClick={() => board.onRemove(row)} />
            </ListGroup>
          </div>
        )}
      </div>
    ),
  };
}

export function buildServiceRoot(row: Row, nav: Nav, board: BoardState, restarting: boolean): DrawerScreen {
  return {
    id: `root:${row.name}`,
    title: row.name,
    header: <RootStatusStrip row={row} restarting={restarting} />,
    content: (
      <div className="drawer-groups">
        <ListGroup>
          <ListGroup.Nav label="logs" value={logsValue(row)} onClick={() => nav.push(buildLogsScreen)} />
        </ListGroup>
        <ListGroup>
          <ListGroup.Action
            label={restarting ? "restarting…" : <>{ICONS["refresh-cw"]} restart service</>}
            busy={restarting}
            disabled={!row.service}
            onClick={() => board.onRestart(row)}
          />
          <ListGroup.Action
            label="+ give it a route…"
            onClick={() => {
              board.openAdd();
              board.updateAddModal({ name: row.name });
            }}
          />
        </ListGroup>
      </div>
    ),
  };
}

export function buildTunnelRoot(row: Row, nav: Nav, board: BoardState, data: StatusData, restarting: boolean): DrawerScreen {
  const domain = tunnelDomain(data);
  return {
    id: `root:${row.name}`,
    title: row.name,
    header: <TunnelStatusStrip row={row} restarting={restarting} />,
    content: (
      <div className="drawer-groups">
        <ListGroup>
          {domain && <ListGroup.Fact label="carries" value={`*.${domain}`} />}
          <ListGroup.Nav label="logs" value={logsValue(row)} onClick={() => nav.push(buildLogsScreen)} />
        </ListGroup>
        <ListGroup>
          <ListGroup.Action
            label={restarting ? "restarting…" : <>{ICONS["refresh-cw"]} restart tunnel</>}
            busy={restarting}
            disabled={!row.service}
            onClick={() => board.onRestart(row)}
          />
        </ListGroup>
      </div>
    ),
  };
}
