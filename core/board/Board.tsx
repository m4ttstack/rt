import { useMemo, useRef, useState } from "react";
import { Alert, Button, ICONS } from "@mattstack/tui-kit";
import { AppsTable } from "./AppsTable.tsx";
import { AppDrawer } from "./drawer/AppDrawer.tsx";
import { AddAppModal, EditAppModal, RemoveConfirm } from "./modals.tsx";
import { TunnelSection } from "./TunnelSection.tsx";
import { useBoardState } from "./useBoardState.ts";

export function Board() {
  const board = useBoardState();
  const { data, sections, tunnels, subline, isRestarting, onRestart, reloadingProxy, onProxyReload, openAdd, proxyNotice } =
    board;

  const mainRef = useRef<HTMLElement>(null);
  const chevronRefs = useRef(new Map<string, HTMLButtonElement>()).current;
  const registerChevron = (name: string, el: HTMLButtonElement | null) => {
    if (el) chevronRefs.set(name, el);
    else chevronRefs.delete(name);
  };
  const [openRowName, setOpenRowName] = useState<string | null>(null);
  // Table display order: apps, then strays, then tunnels -- what ↑/↓ walks.
  const allRows = useMemo(() => [...sections.flatMap((s) => s.rows), ...tunnels], [sections, tunnels]);

  return (
    <main className="board" ref={mainRef} tabIndex={-1} data-board-ready={data != null ? "" : undefined}>
      <header className="board-header">
        <h1>Deck</h1>
        {data && data.canManage && (
          <span className="header-actions">
            <Button size="sm" busy={reloadingProxy} onClick={onProxyReload}>
              {reloadingProxy ? "restarting…" : "reload proxy"}
            </Button>
            <Button size="sm" onClick={openAdd}>
              {ICONS.plus} add app
            </Button>
          </span>
        )}
      </header>
      <p className="board-subline">{subline}</p>
      {proxyNotice && (
        <Alert intent={proxyNotice.kind} command={proxyNotice.command}>
          {proxyNotice.message}
        </Alert>
      )}

      {data != null && (
        <>
          {sections.map((section) => (
            <section key={section.key} className={section.title ? "mt-6" : undefined}>
              {section.title && <h2>{section.title}</h2>}
              <AppsTable
                section={section}
                data={data}
                board={board}
                openRowName={openRowName}
                onOpenRow={setOpenRowName}
                registerChevron={registerChevron}
              />
            </section>
          ))}
          <TunnelSection
            tunnels={tunnels}
            data={data}
            isRestarting={isRestarting}
            onRestart={onRestart}
            openRowName={openRowName}
            onOpenRow={setOpenRowName}
            registerChevron={registerChevron}
          />
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

      <footer className="muted-more mt-6">discovered from portless routes + LaunchAgents · local.mattstack</footer>

      <AddAppModal board={board} />
      <EditAppModal board={board} />
      <RemoveConfirm board={board} />
    </main>
  );
}
