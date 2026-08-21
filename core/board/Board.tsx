import { Button, ICONS } from "@mattstack/tui-kit";
import { AppsTable } from "./AppsTable.tsx";
import { TunnelSection } from "./TunnelSection.tsx";
import { useBoardState } from "./useBoardState.ts";

export function Board() {
  const board = useBoardState();
  const { data, sections, tunnels, subline, isRestarting, onRestart, reloadingProxy, onProxyReload, openAdd } = board;

  return (
    <main className="board" data-board-ready={data != null ? "" : undefined}>
      <header className="board-header">
        <h1>Deck</h1>
        {data && data.canManage && (
          <span className="header-actions">
            <Button variant="outline" size="sm" busy={reloadingProxy} onClick={onProxyReload}>
              {reloadingProxy ? "restarting…" : "reload proxy"}
            </Button>
            <Button size="sm" onClick={openAdd}>
              {ICONS.plus} add app
            </Button>
          </span>
        )}
      </header>
      <p className="board-subline">{subline}</p>

      {data != null && (
        <>
          {sections.map((section) => (
            <section key={section.key} className={section.title ? "mt-6" : undefined}>
              {section.title && <h2>{section.title}</h2>}
              <AppsTable section={section} data={data} board={board} />
            </section>
          ))}
          <TunnelSection tunnels={tunnels} data={data} isRestarting={isRestarting} onRestart={onRestart} />
        </>
      )}

      <footer className="muted-more mt-6">discovered from portless routes + LaunchAgents · local.mattstack</footer>
    </main>
  );
}
