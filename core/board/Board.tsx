import { useMemo, useRef, useState } from "react";
import { Alert, Badge, Button, ICONS, Tooltip } from "@mattstack/tui-kit";
import { AppsTable } from "./AppsTable.tsx";
import { AppDrawer } from "./drawer/AppDrawer.tsx";
import { AddAppModal, RemoveConfirm } from "./modals.tsx";
import { sublineHealthy, type Row } from "./logic.ts";
import { useBoardState } from "./useBoardState.ts";

/** Aggregate cloudflare-tunnel health, collapsed to a single header badge that
    opens the tunnel's drawer on click (the tunnel no longer gets its own row). */
function TunnelBadge({
  tunnels,
  isRestarting,
  onOpen,
}: {
  tunnels: Row[];
  isRestarting: (row: Row) => boolean;
  onOpen: (name: string) => void;
}) {
  if (!tunnels.length) return null;
  const restarting = tunnels.some(isRestarting);
  const up = tunnels.every((t) => t.service && t.service.pid !== null);
  const intent = restarting ? "warn" : up ? "ok" : "bad";
  const label = restarting ? "restarting…" : up ? "up" : "down";
  return (
    <Tooltip tip={tunnels.map((t) => t.name).join(", ")}>
      <button
        className="tunnel-badge"
        onClick={() => onOpen(tunnels[0]!.name)}
        aria-label={`cloudflare tunnel ${label}`}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
        </svg>
        <span className="muted tunnel-label">tunnel</span>
        <Badge intent={intent}>{label}</Badge>
      </button>
    </Tooltip>
  );
}

export function Board() {
  const board = useBoardState();
  const {
    data,
    sections,
    tunnels,
    subline,
    isRestarting,
    reloadingProxy,
    onProxyReload,
    openAdd,
    proxyNotice,
  } = board;

  const mainRef = useRef<HTMLElement>(null);
  const chevronRefs = useRef(new Map<string, HTMLButtonElement>()).current;
  const registerChevron = (name: string, el: HTMLButtonElement | null) => {
    if (el) chevronRefs.set(name, el);
    else chevronRefs.delete(name);
  };
  const [openRowName, setOpenRowName] = useState<string | null>(null);
  // Table display order: apps, then strays, then tunnels -- what ↑/↓ walks.
  const allRows = useMemo(
    () => [...sections.flatMap((s) => s.rows), ...tunnels],
    [sections, tunnels],
  );
  const healthy = data ? sublineHealthy(data) : null;

  return (
    <main
      className="board"
      ref={mainRef}
      tabIndex={-1}
      data-board-ready={data != null ? "" : undefined}
    >
      <header className="board-header">
        <div className="board-title">
          <img
            className="board-logo"
            src="/favicon.svg"
            alt=""
            aria-hidden="true"
          />
          <h1>Deck</h1>
        </div>
        <span className="header-actions">
          <TunnelBadge
            tunnels={tunnels}
            isRestarting={isRestarting}
            onOpen={setOpenRowName}
          />
          {data && data.canManage && (
            <>
              <Button size="sm" busy={reloadingProxy} onClick={onProxyReload}>
                {reloadingProxy ? "restarting…" : "reload proxy"}
              </Button>
              <Button size="sm" onClick={openAdd}>
                {ICONS.plus} add app
              </Button>
            </>
          )}
        </span>
      </header>
      <p className="board-subline">
        {healthy ? (
          <>
            <span className={healthy.ok ? "t-ok" : "t-bad"}>
              {healthy.text}
            </span>
            {subline.length > healthy.text.length && (
              <span className="subline-rest">
                {subline.slice(healthy.text.length).replace(/^\s*·\s*/, "")}
              </span>
            )}
          </>
        ) : (
          subline
        )}
      </p>
      {proxyNotice && (
        <Alert intent={proxyNotice.kind} command={proxyNotice.command}>
          {proxyNotice.message}
        </Alert>
      )}

      {data != null && (
        <>
          {sections.map((section, i) => (
            <section key={section.key} className={i === 0 ? undefined : "mt-6"}>
              {section.title && <h2>{section.title}</h2>}
              <AppsTable
                section={section}
                showHead={i === 0}
                data={data}
                board={board}
                openRowName={openRowName}
                onOpenRow={setOpenRowName}
                registerChevron={registerChevron}
              />
            </section>
          ))}
          <AppDrawer
            rows={allRows}
            data={data}
            board={board}
            openRowName={openRowName}
            onOpenRowNameChange={setOpenRowName}
            chevronRefs={chevronRefs}
            fallbackFocusRef={mainRef}
          />
        </>
      )}
      <AddAppModal board={board} />
      <RemoveConfirm board={board} />
    </main>
  );
}
