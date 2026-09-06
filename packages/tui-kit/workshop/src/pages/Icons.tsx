import { CHECK_ICON, COPY_ICON, Icon, ICONS } from "@mattstack/tui-kit";

/**
 * The Icon recipe's workshop page — the first recipe page, so it is also the
 * shape tasks 9-15 copy.
 *
 * The page imports from the BARREL (`@mattstack/tui-kit`, aliased to `../src`
 * by workshop/vite.config.ts), never from a deep `../../src/recipes/…` path:
 * the workshop's job is to exercise the surface a consumer actually gets, and a
 * deep import would quietly pass even if the barrel forgot the export.
 *
 * No scheme toggle of its own — the sidebar's Dark button flips `.dark` on
 * <html> and every token below follows, which is exactly the behaviour worth
 * showing.
 */

/** Every ICONS entry plus the two standalone path constants CopyButton uses. */
const STANDALONE: Array<[string, string]> = [
  ["COPY_ICON", COPY_ICON],
  ["CHECK_ICON", CHECK_ICON],
];

/**
 * The alias-contract colours a glyph can inherit. Icon has no intent axis: its
 * whole colour story is `stroke="currentColor"`, so the swatch row sets `color`
 * on the WRAPPER and lets the glyph follow.
 */
const COLOURS = ["--fg", "--muted", "--accent", "--green", "--amber", "--red", "--purple", "--cyan"];

const grid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(7rem, 1fr))",
  gap: "0.75rem",
  marginTop: "1rem",
} as const;

const cellStyle = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "0.4rem",
  padding: "0.75rem",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  background: "var(--panel)",
  fontSize: "var(--font-size-sm)",
} as const;

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={cellStyle}>
      {children}
      <code style={{ color: "var(--muted)" }}>{label}</code>
    </div>
  );
}

export function Icons() {
  return (
    <div>
      <h1>Icon</h1>
      <p>
        mr-board's glyph set, moved verbatim. <code>Icon</code> takes a path{" "}
        <code>d</code> and an optional <code>circle</code>; it is decorative
        (<code>aria-hidden</code>) unless a consumer overrides that. Colour is{" "}
        <code>currentColor</code> — there is no <code>intent</code> axis.
      </p>

      <h2 style={{ marginTop: "2rem" }}>ICONS</h2>
      <div style={grid}>
        {Object.entries(ICONS).map(([name, glyph]) => (
          <Cell key={name} label={name}>
            {glyph}
          </Cell>
        ))}
      </div>

      <h2 style={{ marginTop: "2rem" }}>Standalone paths</h2>
      <div style={grid}>
        {STANDALONE.map(([name, d]) => (
          <Cell key={name} label={name}>
            <Icon d={d} />
          </Cell>
        ))}
      </div>

      <h2 style={{ marginTop: "2rem" }}>currentColor</h2>
      <div style={grid}>
        {COLOURS.map((name) => (
          <div key={name} style={{ ...cellStyle, color: `var(${name})` }}>
            <Icon d={CHECK_ICON} />
            <Icon circle d={CHECK_ICON} />
            <code>{name}</code>
          </div>
        ))}
      </div>

      <h2 style={{ marginTop: "2rem" }}>data-part</h2>
      <p>
        Every glyph above carries <code>data-part="icon"</code>. That is the
        tui-kit convention that replaces the hashed CSS-module class name as
        mr-board's cross-boundary selector hook — <code>.tui-review svg</code>{" "}
        becomes <code>.tui-review [data-part="icon"]</code>.
      </p>
    </div>
  );
}
