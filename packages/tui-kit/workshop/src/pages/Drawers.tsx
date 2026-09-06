import { Drawer, type DrawerScreen } from "@mattstack/tui-kit";
import { useState } from "react";

/**
 * The Drawer recipe's workshop page.
 *
 * Imports from the BARREL, never a deep `../../src/recipes/…` path — same
 * rule every other page follows.
 *
 * No scheme toggle of its own — the sidebar's Dark button flips `.dark` on
 * <html>, which is what proves the panel, nav bar and slide-in read
 * correctly in both schemes (same as SideDrawers.tsx).
 *
 * Three screens on one stack: READING (root, no back link, no navAction),
 * EDITING (pushed on top — back link, header strip, navAction "save" slot),
 * and DANGER (pushed again — a destructive action with no navAction of its
 * own, so the nav bar shows only back + close at that depth).
 */

const READING: DrawerScreen = {
  id: "reading",
  title: "Board settings",
  content: (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
      <p>Polling interval, review thresholds, and notification routing live here.</p>
      <p style={{ color: "var(--muted)", fontSize: "var(--font-size-sm)" }}>
        Root screen: no back link, no navAction.
      </p>
    </div>
  ),
};

function editingScreen(interval: string, onChangeInterval: (v: string) => void): DrawerScreen {
  return {
    id: "editing",
    title: "Edit polling interval",
    header: (
      <div style={{ color: "var(--amber)", fontSize: "var(--font-size-sm)" }}>unsaved changes</div>
    ),
    navAction: { label: "Save", onAction: () => {} },
    content: (
      <label style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
        interval (seconds)
        <input
          value={interval}
          onChange={(e) => onChangeInterval(e.target.value)}
          style={{
            font: "inherit",
            padding: "0.35rem 0.5rem",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            background: "var(--panel)",
            color: "var(--fg)",
          }}
        />
      </label>
    ),
  };
}

const DANGER: DrawerScreen = {
  id: "danger",
  title: "Reset board",
  content: (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
      <p>Clears every cached MR state and re-polls from scratch.</p>
      <p style={{ color: "var(--muted)", fontSize: "var(--font-size-sm)" }}>
        Pushed one level deeper: back link present, no navAction here.
      </p>
    </div>
  ),
};

export function Drawers() {
  const [open, setOpen] = useState(false);
  const [stack, setStack] = useState<DrawerScreen[]>([READING]);
  const [interval, setInterval_] = useState("30");

  function openDrawer() {
    setStack([READING]);
    setOpen(true);
  }

  function pushEditing() {
    setStack((s) => [...s, editingScreen(interval, setInterval_)]);
  }

  function pushDanger() {
    setStack((s) => [...s, DANGER]);
  }

  function back() {
    setStack((s) => s.slice(0, -1));
  }

  return (
    <div>
      <h1>Drawer</h1>
      <p>
        A right-edge screen-stack panel, composed on top of <code>SideDrawer</code> rather than
        owning its own overlay: <code>side="right"</code> and the panel width both route through
        SideDrawer's own <code>vars</code> prop, so its public contract for existing consumers
        (mr-board) never changes. Drawer adds the nav bar, the screen stack and its slide
        transition, focus management, and the narrow-viewport full-width behaviour.
      </p>

      <h2 style={{ marginTop: "2rem" }}>the stack</h2>
      <p>
        <code>stack</code> is consumer-owned — Drawer renders only the top screen and never
        mutates the array. Push a screen, then use the back link (or Escape) to pop it; the ✕
        always closes fully, from any depth.
      </p>
      <button type="button" onClick={openDrawer}>
        open (reading)
      </button>

      <Drawer
        open={open}
        stack={stack}
        onBack={back}
        onClose={() => setOpen(false)}
        ariaLabel="board settings"
      />

      <h2 style={{ marginTop: "2rem" }}>from inside the drawer</h2>
      <p style={{ color: "var(--muted)", fontSize: "var(--font-size-sm)" }}>
        These buttons stand in for controls that would live in the drawer's own content — pushing
        a screen from here mirrors what a real consumer does from a row inside <code>content</code>.
      </p>
      <div style={{ display: "flex", gap: "0.6rem" }}>
        <button type="button" onClick={pushEditing} disabled={!open}>
          push editing screen
        </button>
        <button type="button" onClick={pushDanger} disabled={!open}>
          push danger screen
        </button>
      </div>
    </div>
  );
}
