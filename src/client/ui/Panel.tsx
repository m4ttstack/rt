import { useEffect, useState } from "react";

const PANEL_STATE_KEY = "mrs-panel-collapsed";

/** Set of collapsed panel titles, persisted so a group folded up on one visit
    stays folded on the next. Keyed on title alone -- group labels are unique
    within a grouping and it's fine if switching groupings orphans keys. */
function readCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(PANEL_STATE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr.filter((s) => typeof s === "string")) : new Set();
  } catch {
    return new Set();
  }
}

function writeCollapsed(set: Set<string>): void {
  try {
    localStorage.setItem(PANEL_STATE_KEY, JSON.stringify([...set]));
  } catch {
    // storage full or blocked; the panel just won't remember its state
  }
}

function Panel({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  // Read once on mount; if the persisted set is huge we don't want to parse it
  // on every re-render (this component mounts once per group per grouping).
  useEffect(() => {
    setCollapsed(readCollapsed().has(title));
  }, [title]);
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    const set = readCollapsed();
    if (next) set.add(title); else set.delete(title);
    writeCollapsed(set);
  };
  return (
    <section className={`tui-panel${collapsed ? " tui-panel-collapsed" : ""}`}>
      <button
        type="button"
        className="tui-panel-title"
        aria-expanded={!collapsed}
        aria-controls={`panel-body-${title}`}
        onClick={toggle}
      >
        <span className="tui-panel-caret" aria-hidden>{collapsed ? "▸" : "▾"}</span>
        {title} <span className="tui-panel-count">{count}</span>
      </button>
      {!collapsed && <div id={`panel-body-${title}`}>{children}</div>}
    </section>
  );
}

export { Panel };
