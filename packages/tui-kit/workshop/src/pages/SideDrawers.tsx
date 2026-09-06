import { SIDEDRAWER_PARTS, SideDrawer, type SideDrawerSide } from "@mattstack/tui-kit";
import { useState } from "react";

/**
 * The SideDrawer recipe's workshop page.
 *
 * Imports from the BARREL (`@mattstack/tui-kit`, aliased to `../src` by
 * workshop/vite.config.ts), never a deep `../../src/recipes/…` path — same
 * rule every other page follows.
 *
 * No scheme toggle of its own — the sidebar's Dark button flips `.dark` on
 * <html>, which is what proves the scrim wash and BOTH shadow tokens
 * (`--shadow-drawer`, `--shadow-drawer-left`) hold up in both schemes.
 *
 * Drawers open from buttons rather than sitting mounted: a drawer covers the
 * viewport and locks body scroll for as long as it is mounted.
 */

const headRow = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
} as const;

export function SideDrawers() {
  const [open, setOpen] = useState<SideDrawerSide | null>(null);
  const [rowClicks, setRowClicks] = useState(0);
  const [inRow, setInRow] = useState(false);

  return (
    <div>
      <h1>SideDrawer</h1>
      <p>
        One recipe for BOTH of mr-board's drawer families. <code>side</code> is
        the API promotion that replaced the raw <code>overlayClassName</code> /{" "}
        <code>panelClassName</code> string props: it drives the panel's width,
        which edge carries the border, which shadow is thrown, the overlay's
        alignment and stacking order, and the left panel's own padding.
      </p>
      <table style={{ borderCollapse: "collapse", margin: "1rem 0" }}>
        <thead>
          <tr>
            {["", 'side="right"', 'side="left"'].map((h) => (
              <th key={h} style={{ textAlign: "left", padding: "0.2rem 0.8rem 0.2rem 0" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[
            ["mr-board family", ".tui-cd*", ".tui-drawer*"],
            ["width", "min(460px, 92vw)", "min(320px, 85vw)"],
            ["border", "border-left", "border-right"],
            ["shadow", "--shadow-drawer", "--shadow-drawer-left"],
            ["z-index", "100", "90"],
            ["panel padding / gap", "none", "14px"],
          ].map(([label, right, left]) => (
            <tr key={label}>
              <td style={{ padding: "0.2rem 0.8rem 0.2rem 0", color: "var(--muted)" }}>{label}</td>
              <td style={{ padding: "0.2rem 0.8rem 0.2rem 0" }}>
                <code>{right}</code>
              </td>
              <td style={{ padding: "0.2rem 0.8rem 0.2rem 0" }}>
                <code>{left}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={{ marginTop: "2rem" }}>the two sides</h2>
      <div style={{ display: "flex", gap: "0.6rem" }}>
        <button type="button" onClick={() => setOpen("left")}>
          open the left drawer (menu)
        </button>
        <button type="button" onClick={() => setOpen("right")}>
          open the right drawer (comments)
        </button>
      </div>

      <h2 style={{ marginTop: "2rem" }}>onOverlayClick</h2>
      <p>
        CommentsDrawer renders inside a clickable board row, so it passes{" "}
        <code>onOverlayClick</code> to stop the click bubbling before it closes.
        The row below counts its own clicks: open the drawer, click the scrim,
        and the count must NOT move.
      </p>
      <div
        onClick={() => setRowClicks((n) => n + 1)}
        onKeyDown={() => {}}
        style={{
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-md)",
          background: "var(--panel)",
          padding: "0.5rem 0.7rem",
          cursor: "pointer",
        }}
      >
        a clickable row — clicked {rowClicks} time(s)
        <button
          type="button"
          style={{ marginLeft: "0.8rem" }}
          onClick={(e) => {
            e.stopPropagation();
            setInRow(true);
          }}
        >
          open a drawer inside this row
        </button>
        {inRow && (
          <SideDrawer
            side="right"
            ariaLabel="comment threads"
            onClose={() => setInRow(false)}
            onOverlayClick={(e) => {
              e.stopPropagation();
              setInRow(false);
            }}
          >
            <div style={{ padding: "0.9rem 1rem" }}>
              Click the scrim. The row's own click handler must not fire.
            </div>
          </SideDrawer>
        )}
      </div>

      {open === "left" && (
        <SideDrawer side="left" ariaLabel="menu" onClose={() => setOpen(null)}>
          <div style={headRow}>
            <span style={{ fontWeight: 700, color: "var(--accent)" }}>❯ menu</span>
            <button type="button" onClick={() => setOpen(null)} aria-label="close menu">
              ✕
            </button>
          </div>
          {["matt", "bob", "carol"].map((name) => (
            <div key={name} style={{ padding: "0.25rem 0.4rem" }}>
              {name}
            </div>
          ))}
          <div style={{ paddingTop: "12px", borderTop: "1px solid var(--border-soft)" }}>
            the panel's own 14px padding and gap are what space these — the
            right drawer has neither, because its children pad themselves.
          </div>
        </SideDrawer>
      )}

      {open === "right" && (
        <SideDrawer side="right" ariaLabel="comment threads" onClose={() => setOpen(null)}>
          <div style={{ ...headRow, alignItems: "flex-start", padding: "0.9rem 1rem 0.5rem" }}>
            <span style={{ fontWeight: 600, fontSize: "var(--font-size-xl)" }}>
              <span style={{ color: "var(--muted)" }}>!42</span> harden team-zone materialize
            </span>
            <button type="button" onClick={() => setOpen(null)} aria-label="close">
              ✕
            </button>
          </div>
          <div style={{ padding: "0.8rem 1rem 1.4rem" }}>
            Every element in here is the caller's, passed through{" "}
            <code>children</code>. The drawer owns the scrim and the panel and
            nothing else — which is why mr-board's <code>.tui-cd-head</code> /{" "}
            <code>.tui-drawer-head</code> rules stay app-side.
          </div>
        </SideDrawer>
      )}

      <h2 style={{ marginTop: "2rem" }}>data-part</h2>
      <p>
        Both slots carry a <code>data-part</code>, and both also carry{" "}
        <code>data-side</code> — which is part of the cross-boundary contract
        here, not just an internal hook, because one <code>data-part</code>{" "}
        value now stands in for two board classes:
      </p>
      <ul>
        <li>
          <code>.tui-cd</code> becomes{" "}
          <code>
            [data-part="{SIDEDRAWER_PARTS.root}"][data-side="right"]
          </code>
        </li>
        <li>
          <code>.tui-drawer</code> becomes{" "}
          <code>
            [data-part="{SIDEDRAWER_PARTS.root}"][data-side="left"]
          </code>
        </li>
        <li>
          <code>.tui-cd-overlay</code> becomes{" "}
          <code>
            [data-part="{SIDEDRAWER_PARTS.overlay}"][data-side="right"]
          </code>
        </li>
        <li>
          <code>.tui-drawer-overlay</code> becomes{" "}
          <code>
            [data-part="{SIDEDRAWER_PARTS.overlay}"][data-side="left"]
          </code>
        </li>
      </ul>
    </div>
  );
}
