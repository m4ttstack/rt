import { CopyButton } from "@mattstack/tui-kit";

/**
 * The CopyButton recipe's workshop page.
 *
 * Imports from the BARREL (`@mattstack/tui-kit`), never a deep
 * `../../src/recipes/…` path — see Chips.tsx's identical comment.
 *
 * No scheme toggle of its own — the sidebar's Dark button flips `.dark` on
 * <html>, and the panel background / green copied state both follow through
 * the theme.
 */

const row = { display: "flex", alignItems: "center", gap: "0.75rem", marginTop: "1rem" } as const;

export function CopyButtons() {
  return (
    <div>
      <h1>CopyButton</h1>
      <p>
        mr-board's copy-to-clipboard button — <code>.tui-copy</code>. Click one:
        it writes <code>text</code> to the clipboard and flashes a green check
        for 1200ms. The copied state is a data attribute
        (<code>data-copied</code>), not a class toggle.
      </p>

      <div style={row}>
        <CopyButton text="mr-board/mr!42" title="copy link" />
        <code style={{ color: "var(--muted)" }}>icon only (the header form)</code>
      </div>
      <div style={row}>
        <CopyButton text="mr-board/mr!42" title="copy link" label="copy link" />
        <code style={{ color: "var(--muted)" }}>with a label (the drawer action)</code>
      </div>

      <h2 style={{ marginTop: "2rem" }}>data-part</h2>
      <p>
        Every button above carries <code>data-part="copybutton"</code>. That
        replaces the hashed CSS-module class name as mr-board's cross-boundary
        selector hook: <code>.tui-copy</code> becomes{" "}
        <code>[data-part="copybutton"]</code>, and{" "}
        <code>.tui-copy.copied</code> becomes{" "}
        <code>[data-part="copybutton"][data-copied]</code>.
      </p>
    </div>
  );
}
