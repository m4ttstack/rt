import { SPINNER_PARTS, Spinner } from "@mattstack/tui-kit";

/**
 * The Spinner recipe's workshop page.
 *
 * Imports from the BARREL (`@mattstack/tui-kit`, aliased to `../src` by
 * workshop/vite.config.ts), never a deep `../../src/recipes/…` path — same
 * rule StatusDots.tsx follows.
 *
 * No scheme toggle of its own — the sidebar's Dark button flips `.dark` on
 * <html>, which is what proves the ring's `--border`/`--accent` tokens hold
 * up in both schemes.
 */

const SIZES = ["xs", "sm"] as const;

const row = { display: "flex", alignItems: "center", gap: "2rem", marginTop: "1rem" } as const;

const cell = { display: "flex", alignItems: "center", gap: "0.5rem" } as const;

const disabledButton = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.5rem",
  marginTop: "1rem",
  padding: "0.5rem 1rem",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  background: "var(--panel)",
  color: "var(--fg)",
  opacity: 0.6,
  cursor: "not-allowed",
} as const;

export function Spinners() {
  return (
    <div>
      <h1>Spinner</h1>
      <p>
        An inline busy ring, sized for two hosts: <code>xs</code> for a
        button's own label row, <code>sm</code> for anywhere it stands alone.
        It renders <code>aria-hidden</code> by contract — the busy CONTEXT
        (a button, a badge) owns the accessible state via{" "}
        <code>aria-busy</code>, not the glyph itself.
      </p>

      <h2 style={{ marginTop: "2rem" }}>both sizes, at rest</h2>
      <div style={row}>
        {SIZES.map((size) => (
          <span key={size} style={cell}>
            <Spinner size={size} />
            {size}
          </span>
        ))}
      </div>

      <h2 style={{ marginTop: "2rem" }}>inline with text</h2>
      <p style={cell}>
        <Spinner size="xs" /> syncing team config…
      </p>

      <h2 style={{ marginTop: "2rem" }}>inside a disabled control</h2>
      <p>The shape a submit button embeds: an in-flight action, mid-submit.</p>
      <button type="button" disabled style={disabledButton}>
        <Spinner size="xs" />
        Materializing…
      </button>

      <h2 style={{ marginTop: "2rem" }}>data-part</h2>
      <p>
        Every ring carries <code>data-part="{SPINNER_PARTS.root}"</code> — the
        tui-kit convention that replaces the hashed CSS-module class name as
        the kit's cross-boundary selector hook.
      </p>
    </div>
  );
}
