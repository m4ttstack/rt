import { Chip } from "@mattstack/tui-kit";
import type { TabConfig } from "../../config.ts";

/** Board tabs, rendered as a strip above the content they scope rather than as
    another control in the header row. Renders nothing for a single tab, so a
    board with no tabs configured looks exactly as it did before tabs existed. */
export function TabBar({
  tabs,
  active,
  onPick,
  syncing,
}: {
  tabs: TabConfig[];
  active: string;
  onPick: (tab: string) => void;
  /** The active codeowners tab's section is still mid-backfill. */
  syncing: boolean;
}) {
  if (tabs.length < 2) return null;
  return (
    <div className="tui-tabs" role="tablist" aria-label="board tabs">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          type="button"
          aria-selected={tab.id === active}
          className={`tui-tab${tab.id === active ? " active" : ""}`}
          onClick={() => onPick(tab.id)}
        >
          {tab.label}
        </button>
      ))}
      {syncing && (
        <Chip intent="warn" data-flag="" title="rt hasn't finished backfilling this codeowner section... counts may be low">
          syncing
        </Chip>
      )}
    </div>
  );
}
