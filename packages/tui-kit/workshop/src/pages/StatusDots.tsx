import { STATUSDOT_PARTS, StatusDot } from "@mattstack/tui-kit";

/**
 * The StatusDot recipe's workshop page.
 *
 * Imports from the BARREL (`@mattstack/tui-kit`, aliased to `../src` by
 * workshop/vite.config.ts), never a deep `../../src/recipes/…` path — same
 * rule Chips.tsx/Icons.tsx follow.
 *
 * No scheme toggle of its own — the sidebar's Dark button flips `.dark` on
 * <html>, which is what proves the dot tokens (deliberately separate from,
 * and more saturated than, the ordinary text greens Chip's `intent="ok"`
 * uses) hold up in both schemes.
 */

const INTENTS = ["ok", "warn", "bad"] as const;

const row = { display: "flex", alignItems: "center", gap: "2rem", marginTop: "1rem" } as const;

const cell = { display: "flex", alignItems: "center", gap: "0.5rem" } as const;

const boardRow = {
  display: "flex",
  flexDirection: "column",
  gap: "0.5rem",
  marginTop: "1rem",
  padding: "0.7rem",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  background: "var(--panel)",
} as const;

const mrRow = { display: "flex", alignItems: "center", gap: "0.5rem" } as const;

export function StatusDots() {
  return (
    <div>
      <h1>StatusDot</h1>
      <p>
        mr-board's <code>.tui-dot</code>/<code>.tui-dot-wrap</code> status
        glyph plus its CSS-only tooltip. <code>intent</code> maps DIRECTLY to
        the dot tokens (<code>--dot-ok</code>/<code>--dot-warn</code>/
        <code>--dot-bad</code>) — a separate, more saturated palette from the
        ordinary <code>--green</code>/<code>--amber</code>/<code>--red</code>{" "}
        text hues Chip's <code>intent</code> vocabulary reaches for, so a wall
        of status dots stays legible at a glance. Hover a dot for its tooltip.
      </p>

      <h2 style={{ marginTop: "2rem" }}>the three tones</h2>
      <div style={row}>
        {INTENTS.map((intent) => (
          <span key={intent} style={cell}>
            <StatusDot intent={intent} tip={`${intent} status\nhover me`} />
            {intent}
          </span>
        ))}
      </div>

      <h2 style={{ marginTop: "2rem" }}>a real board row</h2>
      <p>Three MRs, each with its own status dot and multi-line tooltip.</p>
      <div style={boardRow}>
        <div style={mrRow}>
          <StatusDot intent="ok" tip="approved by 2 reviewers" />
          <span>fix: harden team-zone materialize</span>
        </div>
        <div style={mrRow}>
          <StatusDot intent="warn" tip={"awaiting review\nrequested from bob"} />
          <span>feat: on-demand team-config materialize</span>
        </div>
        <div style={mrRow}>
          <StatusDot intent="bad" tip={"has conflicts\npipeline failing"} />
          <span>fix: resync vendored resolvers</span>
        </div>
      </div>

      <h2 style={{ marginTop: "2rem" }}>data-part</h2>
      <p>
        Every dot's wrap carries <code>data-part="{STATUSDOT_PARTS.root}"</code>
        , and its glyph <code>data-part="{STATUSDOT_PARTS.dot}"</code> — the
        tui-kit convention that replaces the hashed CSS-module class name as
        mr-board's cross-boundary selector hook: <code>.tui-dot-wrap</code>{" "}
        becomes <code>[data-part="statusdot"]</code>, and <code>.tui-dot</code>{" "}
        becomes <code>[data-part="statusdot-dot"]</code>.
      </p>
    </div>
  );
}
