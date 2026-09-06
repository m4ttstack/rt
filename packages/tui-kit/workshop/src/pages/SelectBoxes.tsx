import { SelectBox } from "@mattstack/tui-kit";
import { useState } from "react";

/**
 * The SelectBox recipe's workshop page.
 *
 * Imports from the BARREL (`@mattstack/tui-kit`), never a deep
 * `../../src/recipes/…` path — see Chips.tsx's identical comment.
 *
 * No scheme toggle of its own — the sidebar's Dark button flips `.dark` on
 * <html>, and the accent-checked / muted-resting colours both follow through
 * the theme.
 */

const row = { display: "flex", alignItems: "center", gap: "0.75rem", marginTop: "1rem" } as const;

export function SelectBoxes() {
  // Live state, so clicking actually toggles the glyph — the interactive
  // proof the four-file test suite already covers statically.
  const [checked, setChecked] = useState(false);

  return (
    <div>
      <h1>SelectBox</h1>
      <p>
        mr-board's row/card selection checkbox — <code>.tui-selectbox</code>. A
        real <code>role="checkbox"</code> button: <code>▣</code> checked,{" "}
        <code>☐</code> unchecked, always visible (not hover-revealed) so it
        stays usable in the mobile drawer layout.
      </p>

      <div style={row}>
        <SelectBox checked={checked} onToggle={() => setChecked((c) => !c)} />
        <code style={{ color: "var(--muted)" }}>{checked ? "checked" : "unchecked"}</code>
      </div>

      <h2 style={{ marginTop: "2rem" }}>data-part</h2>
      <p>
        The control above carries <code>data-part="selectbox"</code>. That
        replaces the hashed CSS-module class name as mr-board's cross-boundary
        selector hook: <code>.tui-selectbox</code> becomes{" "}
        <code>[data-part="selectbox"]</code>, and{" "}
        <code>.tui-selectbox.checked</code> becomes{" "}
        <code>[data-part="selectbox"][data-checked]</code>.
      </p>
    </div>
  );
}
