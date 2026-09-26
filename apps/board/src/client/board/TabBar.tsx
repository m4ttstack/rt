import { Fragment } from 'react';

import { Chip } from '@mattstack/tui-kit';
import type { TabConfig } from '../../config.ts';

/** Board tabs, rendered as a strip above the content they scope rather than as
    another control in the header row. Renders nothing for a single tab, so a
    board with no tabs configured looks exactly as it did before tabs existed. */
export function TabBar({
  tabs,
  active,
  counts = {},
  onPick,
  syncing,
  unknown,
}: {
  tabs: TabConfig[];
  active: string;
  /** Live counts shown beside a tab's label, keyed by tab id. */
  counts?: Record<string, number>;
  onPick: (tab: string) => void;
  /** The active codeowners tab's section is still mid-backfill. */
  syncing: boolean;
  /** Ids of codeowners tabs whose section is not in the project's CODEOWNERS.
      Marked on every tab, active or not: the alarm must be visible from
      wherever the reader is. */
  unknown: string[];
}) {
  if (tabs.length < 2) return null;
  return (
    <div className="tui-tabs" role="tablist" aria-label="board tabs">
      {tabs.map(tab => (
        <Fragment key={tab.id}>
          <button
            role="tab"
            type="button"
            aria-selected={tab.id === active}
            className={`tui-tab${tab.id === active ? ' active' : ''}`}
            onClick={() => onPick(tab.id)}
          >
            {tab.label}
            {counts[tab.id] !== undefined && (
              <span className="tui-tab-count">{counts[tab.id]}</span>
            )}
          </button>
          {unknown.includes(tab.id) && (
            <Chip
              intent="bad"
              data-flag=""
              title="this tab's section is not in the project's CODEOWNERS"
            >
              no such section
            </Chip>
          )}
        </Fragment>
      ))}
      {syncing && !unknown.includes(active) && (
        <Chip
          intent="warn"
          data-flag=""
          title="rt hasn't finished backfilling this codeowner section... counts may be low"
        >
          syncing
        </Chip>
      )}
    </div>
  );
}
