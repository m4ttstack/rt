import { MODAL_PARTS, Modal } from "@mattstack/tui-kit";
import { useState } from "react";

/**
 * The Modal recipe's workshop page.
 *
 * Imports from the BARREL (`@mattstack/tui-kit`, aliased to `../src` by
 * workshop/vite.config.ts), never a deep `../../src/recipes/…` path — same
 * rule every other page follows.
 *
 * No scheme toggle of its own — the sidebar's Dark button flips `.dark` on
 * <html>, which is what proves the scrim wash (`--surface-wash-bg-55`), the
 * backdrop blur and the frame's shadow hold up in both schemes.
 *
 * Each demo is OPENED BY A BUTTON rather than rendered permanently: a modal
 * takes the whole viewport and locks body scroll for as long as it is
 * mounted, so a page with three of them mounted at once would be unusable and
 * would prove nothing about the recipe.
 */

const modalRow = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "10px",
  padding: "5px 6px",
  borderRadius: "var(--radius-md)",
} as const;

export function Modals() {
  const [open, setOpen] = useState<null | "settings" | "review">(null);

  return (
    <div>
      <h1>Modal</h1>
      <p>
        mr-board's <code>.tui-modal*</code> centred dialog frame: a fixed scrim
        (click to close) around a <code>stopPropagation</code>'d panel with a
        title row and a close button. Escape closes it, and only the TOP layer
        when several are stacked; body scroll stays locked until the last one
        unmounts.
      </p>

      <h2 style={{ marginTop: "2rem" }}>the settings modal</h2>
      <p>
        SettingsModal's shape, including the literal <code>✕</code>{" "}
        <code>closeGlyph</code> it has always rendered instead of the{" "}
        <code>ICONS.close</code> svg every other modal uses.
      </p>
      <button type="button" onClick={() => setOpen("settings")}>
        open settings modal
      </button>

      <h2 style={{ marginTop: "2rem" }}>a per-modal override</h2>
      <p>
        ReviewModal passes <code>className</code> (which dresses the FRAME) and{" "}
        <code>overlayClassName</code> (which dresses the SCRIM). Both are merged
        with the recipe's own classes rather than replacing them, which is how
        mr-board's <code>.tui-review-modal</code> / <code>.tui-review-overlay</code>{" "}
        keep working unchanged.
      </p>
      <button type="button" onClick={() => setOpen("review")}>
        open a wide, centred modal
      </button>

      {open === "settings" && (
        <Modal
          title="❯ team members"
          ariaLabel="team settings"
          onClose={() => setOpen(null)}
          closeGlyph="✕"
        >
          <p
            style={{
              color: "var(--muted)",
              fontSize: "var(--font-size-md)",
              margin: "0.2rem 0 0.9rem",
            }}
          >
            # check people out to hide them from the board
          </p>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {["matt", "bob", "carol", "dave"].map((name) => (
              <li key={name} style={modalRow}>
                <span>{name}</span>
                <span style={{ color: "var(--muted)" }}>3</span>
              </li>
            ))}
          </ul>
        </Modal>
      )}

      {open === "review" && (
        <Modal
          title={<>❯ review · !42</>}
          ariaLabel="review for !42"
          onClose={() => setOpen(null)}
          // The two style-prop escape hatches a per-modal override needs, done
          // here through the universal style props rather than a board class,
          // since the workshop has no `.tui-review-modal` rule of its own.
          style={{ maxWidth: "900px", alignSelf: "center" }}
        >
          <p style={{ color: "var(--muted)", fontSize: "var(--font-size-md)" }}>
            fix: harden team-zone materialize and manifest slug edge cases
          </p>
          <p>
            A wide reading surface. The frame is the <code>root</code> slot, so a{" "}
            <code>style</code> or a style prop dresses the dialog box, not the
            scrim.
          </p>
        </Modal>
      )}

      <h2 style={{ marginTop: "2rem" }}>data-part</h2>
      <p>
        Every slot carries its own <code>data-part</code> — the tui-kit
        convention that replaces the hashed CSS-module class name as mr-board's
        cross-boundary selector hook:
      </p>
      <ul>
        <li>
          <code>.tui-modal</code> becomes <code>[data-part="{MODAL_PARTS.root}"]</code>
        </li>
        <li>
          <code>.tui-modal-overlay</code> becomes{" "}
          <code>[data-part="{MODAL_PARTS.overlay}"]</code>
        </li>
        <li>
          <code>.tui-modal-head</code> becomes <code>[data-part="{MODAL_PARTS.head}"]</code>
        </li>
        <li>
          <code>.tui-modal-title</code> becomes <code>[data-part="{MODAL_PARTS.title}"]</code>
        </li>
        <li>
          <code>.tui-modal-x</code> becomes <code>[data-part="{MODAL_PARTS.close}"]</code>
        </li>
      </ul>
    </div>
  );
}
