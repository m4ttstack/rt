import { Invadr } from "invadrs/react";
import type { RosterMember } from "../types.ts";
import { ICONS } from "../ui/Icon.tsx";

function Sidebar({
  members,
  total,
  active,
  onPick,
  onSettings,
  scopeUncovered,
}: {
  members: RosterMember[];
  total: number;
  active: string;
  onPick: (member: string) => void;
  onSettings: () => void;
  /** Authors demanded from rt but not yet backfilled -- their counts may be
      undercounts, so the row says so instead of quietly showing a low number. */
  scopeUncovered: string[];
}) {
  return (
    <nav className="tui-sidebar" aria-label="team members">
      <div className="tui-side-head">
        <button className={active === "all" ? "tui-side-item active" : "tui-side-item"} onClick={() => onPick("all")}>
          <span className="tui-side-name">◉ All</span>
          <span className="tui-side-count">{total}</span>
        </button>
        <button className="tui-side-gear" onClick={onSettings} title="manage roster — check people in/out" aria-label="manage roster">
          {ICONS.people}
        </button>
      </div>
      {members.map((m) => (
        <button
          key={m.username}
          className={
            (active === m.username ? "tui-side-item active" : "tui-side-item") + (m.count === 0 ? " tui-side-empty" : "")
          }
          onClick={() => onPick(m.username)}
          title={m.name ?? m.username}
        >
          <span className="tui-side-name">
            <Invadr id={m.username} palette="css-vars" className="tui-avatar" /> {m.name ?? m.username}
          </span>
          <span className="tui-side-right">
            {scopeUncovered.includes(m.username) && (
              <span className="tui-flag t-warn" title="rt hasn't finished backfilling this author's MRs... the count may be low">
                syncing
              </span>
            )}
            <span className="tui-side-count">{m.count}</span>
          </span>
        </button>
      ))}
    </nav>
  );
}

export { Sidebar };
