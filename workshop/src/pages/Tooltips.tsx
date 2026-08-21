import { Button, Chip, Tooltip } from "@mattstack/tui-kit";

/**
 * The Tooltip recipe's workshop page.
 *
 * Imports from the BARREL (`@mattstack/tui-kit`, aliased to `../src` by
 * workshop/vite.config.ts), never a deep `../../src/recipes/…` path — same
 * rule StatusDots.tsx follows.
 *
 * No scheme toggle of its own — the sidebar's Dark button flips `.dark` on
 * <html>, which is what proves the hover card's `--panel`/`--border` tokens
 * hold up in both schemes.
 */

const row = { display: "flex", alignItems: "center", gap: "2rem", marginTop: "1rem" } as const;

const composedControl = {
  display: "flex",
  flexDirection: "column",
  gap: "0.2rem",
  padding: "0.9rem 1.2rem",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  background: "var(--panel)",
  cursor: "pointer",
} as const;

export function Tooltips() {
  return (
    <div>
      <h1>Tooltip</h1>
      <p>
        Generalised from StatusDot's <code>.tui-dot-wrap</code> CSS tooltip
        (<code>content: attr(data-tip)</code>) for any wrapped child, not just
        the dot glyph. Hover or tab to a wrapped child for its tooltip — this
        recipe shows on both <code>:hover</code> and <code>:focus-within</code>
        , unlike StatusDot's hover-only card.
      </p>

      <h2 style={{ marginTop: "2rem" }}>wrapping a button</h2>
      <div style={row}>
        <Tooltip tip="deploys the current branch">
          <Button>Deploy</Button>
        </Tooltip>
        <Tooltip tip={"multi-line tips\nuse pre-line, same as StatusDot"}>
          <Button>Hover or Tab me</Button>
        </Tooltip>
      </div>

      <h2 style={{ marginTop: "2rem" }}>trigger height</h2>
      <p>
        The card sits below the trigger's own box (<code>top: 100%</code>,
        plus a small gap) rather than a fixed offset off StatusDot's tiny dot
        glyph — so it never overlaps, from a short chip up through a taller
        composed control.
      </p>
      <div style={row}>
        <Tooltip tip="short chip trigger">
          <Chip>build #482</Chip>
        </Tooltip>
        <Tooltip tip="taller composed control, stacked label + sublabel">
          <div style={composedControl}>
            <strong>Deploy pipeline</strong>
            <span style={{ color: "var(--muted)", fontSize: "var(--font-size-xs)" }}>
              main -&gt; production
            </span>
          </div>
        </Tooltip>
      </div>

      <h2 style={{ marginTop: "2rem" }}>accessibility ceiling</h2>
      <p>
        The CSS tooltip exposes nothing to assistive tech — no accessible
        name, no role, no announcement. A consumer whose wrapped content needs
        the tip's information conveyed to AT still supplies its own{" "}
        <code>aria-label</code>/<code>aria-describedby</code>; this recipe
        does not, and cannot, do that for them.
      </p>

      <h2 style={{ marginTop: "2rem" }}>data-part</h2>
      <p>
        Every wrapper carries <code>data-part="tooltip"</code> and{" "}
        <code>data-tip</code> — the tui-kit convention that replaces the
        hashed CSS-module class name as the cross-boundary selector hook.
      </p>
    </div>
  );
}
