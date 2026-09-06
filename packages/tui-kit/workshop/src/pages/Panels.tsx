import { Panel, PANEL_PARTS } from "@mattstack/tui-kit";

/**
 * The Panel recipe's workshop page.
 *
 * Imports from the BARREL (`@mattstack/tui-kit`, aliased to `../src` by
 * workshop/vite.config.ts), never a deep `../../src/recipes/…` path — same
 * rule Chips.tsx/Icons.tsx/StatusDots.tsx follow.
 *
 * No scheme toggle of its own — the sidebar's Dark button flips `.dark` on
 * <html>, which is what proves the panel washes (`--surface-wash-panel-88`/
 * `-70`/`-100`) hold up in both schemes.
 *
 * Each demo panel gets its OWN `storageKey` (distinct from the kit's shared
 * default) so toggling one in this page never collides with another, and a
 * page reload starts every demo expanded again rather than replaying
 * whatever this browser happened to leave collapsed last time.
 */

const boardRow = {
  display: "flex",
  flexDirection: "column",
  gap: "0.35rem",
  padding: "0.5rem 0.7rem",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  background: "var(--panel)",
  fontSize: "var(--font-size-sm)",
} as const;

export function Panels() {
  return (
    <div>
      <h1>Panel</h1>
      <p>
        mr-board's <code>.tui-panel*</code> collapsible section container: a
        framed card with its title stamped on the border, click the title to
        collapse it into a full-width bar. Collapsed state persists to
        <code> localStorage</code> under a configurable <code>storageKey</code>
        , keyed on the panel's own <code>title</code>.
      </p>

      <h2 style={{ marginTop: "2rem" }}>expanded (click the title to collapse)</h2>
      <Panel title="open MRs" count={2} storageKey="workshop-panel-open-mrs">
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <div style={boardRow}>mr-board/mr!42 — fix: harden team-zone materialize</div>
          <div style={boardRow}>mr-board/mr!41 — feat: on-demand team-config materialize</div>
        </div>
      </Panel>

      <h2 style={{ marginTop: "2rem" }}>a second panel, independent state</h2>
      <p>Each Panel instance persists under its own title/storageKey pair.</p>
      <Panel title="stale MRs" count={1} storageKey="workshop-panel-stale-mrs">
        <div style={boardRow}>mr-board/mr!38 — chore: bump lockfile</div>
      </Panel>

      <h2 style={{ marginTop: "2rem" }}>empty count</h2>
      <Panel title="drafts" count={0} storageKey="workshop-panel-drafts">
        <p style={{ color: "var(--muted)" }}>nothing here yet</p>
      </Panel>

      <h2 style={{ marginTop: "2rem" }}>data-part</h2>
      <p>
        Every slot carries its own <code>data-part</code> — the tui-kit
        convention that replaces the hashed CSS-module class name as
        mr-board's cross-boundary selector hook:
      </p>
      <ul>
        <li>
          <code>.tui-panel</code> becomes{" "}
          <code>[data-part="{PANEL_PARTS.root}"]</code>
        </li>
        <li>
          <code>.tui-panel-title</code> becomes{" "}
          <code>[data-part="{PANEL_PARTS.title}"]</code>
        </li>
        <li>
          <code>.tui-panel-caret</code> becomes{" "}
          <code>[data-part="{PANEL_PARTS.caret}"]</code>
        </li>
        <li>
          <code>.tui-panel-count</code> becomes{" "}
          <code>[data-part="{PANEL_PARTS.count}"]</code>
        </li>
        <li>
          the unclassed content wrapper becomes{" "}
          <code>[data-part="{PANEL_PARTS.body}"]</code>
        </li>
      </ul>
    </div>
  );
}
