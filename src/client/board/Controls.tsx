import { GROUP_KEYS, SORT_KEYS } from "../../view.ts";
import type { ViewState } from "../../view.ts";
import type { ThemeMode, ViewMode } from "../types.ts";
import { CopyButton, ICONS, LabeledSeg, Segmented } from "@mattstack/tui-kit";
import { GROUP_LABEL, SORT_LABEL } from "./format.ts";
import { SLACK_ICON } from "./chips.tsx";

// ── controls (shared: desktop header + mobile drawer) ───────────────────────

function Controls({
  state,
  update,
  view,
  pickView,
  theme,
  pickTheme,
  canCopy,
  summaryText,
  onRefresh,
  refreshing,
  onPostSummary,
  canPostSummary,
  postingSummary,
  stacked = false,
}: {
  state: ViewState;
  update: (patch: Partial<ViewState>) => void;
  view: ViewMode;
  pickView: (v: ViewMode) => void;
  theme: ThemeMode;
  pickTheme: (m: ThemeMode) => void;
  canCopy: boolean;
  summaryText: string;
  onRefresh: () => void;
  refreshing: boolean;
  onPostSummary?: () => void;
  canPostSummary?: boolean;
  postingSummary?: boolean;
  stacked?: boolean;
}) {
  const group = <LabeledSeg legend="group" options={GROUP_KEYS} labels={GROUP_LABEL} value={state.group} onChange={(g) => update({ group: g })} />;
  const sort = <LabeledSeg legend="sort" options={SORT_KEYS} labels={SORT_LABEL} value={state.sort} onChange={(s) => update({ sort: s })} />;
  const viewSeg = <Segmented options={["rows", "grid"] as const} value={view} onChange={pickView} label="view" />;
  const themeSeg = <Segmented options={["light", "dark", "system"] as const} value={theme} onChange={pickTheme} label="theme" />;

  // Drawer: labeled full-width rows, so a mobile user can tell what each does.
  if (stacked) {
    return (
      <>
        <div className="tui-ctl-row"><span className="tui-ctl-label">group</span>{group}</div>
        <div className="tui-ctl-row"><span className="tui-ctl-label">sort</span>{sort}</div>
        <div className="tui-ctl-row"><span className="tui-ctl-label">view</span>{viewSeg}</div>
        <div className="tui-ctl-row"><span className="tui-ctl-label">theme</span>{themeSeg}</div>
        <button className="tui-drawer-action" onClick={onRefresh} disabled={refreshing}>
          {ICONS.refresh} {refreshing ? "refreshing…" : "refresh now"}
        </button>
        {canCopy && (
          <CopyButton text={summaryText} className="tui-drawer-action" title="copy summary for Slack" label="copy summary" />
        )}
        {canPostSummary && onPostSummary && (
          <button className="tui-drawer-action" onClick={onPostSummary} disabled={postingSummary} title="post this summary to slack">
            {SLACK_ICON} {postingSummary ? "posting…" : "post summary to slack"}
          </button>
        )}
      </>
    );
  }

  // Header: compact inline row.
  return (
    <>
      <button
        className={`tui-copy tui-refresh${refreshing ? " spinning" : ""}`}
        onClick={onRefresh}
        disabled={refreshing}
        title="refresh now"
        aria-label="refresh now"
      >
        {ICONS.refresh}
      </button>
      {/* No `className="tui-copy"`: the CopyButton recipe's own stylesheet IS
          that rule now. `.tui-copy` survives in style.css only to dress the
          board's own plain buttons (the refresh button above, the selection
          bar's post/clear), which are not CopyButton instances. */}
      {canCopy && <CopyButton text={summaryText} title="copy summary for Slack" />}
      {group}
      {sort}
      {viewSeg}
      {themeSeg}
    </>
  );
}

export { Controls };
