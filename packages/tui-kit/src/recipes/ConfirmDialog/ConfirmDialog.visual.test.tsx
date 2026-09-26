import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { renderWithTheme } from "../../../test/test-utils.tsx";
import { ConfirmDialog } from "./ConfirmDialog.tsx";

/**
 * Visual tier for the ConfirmDialog recipe.
 *
 * NO MOTION FREEZE IS INSTALLED, same reasoning as Modal.visual.test.tsx:
 * neither Modal.module.css nor ConfirmDialog.module.css declares a
 * `transition` or an `animation`, so there is no interpolating frame a
 * capture could land mid-way through.
 *
 * THE OVERLAY IS THE CAPTURE TARGET, not the frame — same as Modal's own
 * visual tier, and for the same reason: it is the element whose layout box
 * IS the viewport, so the screenshot carries the scrim wash and the frame's
 * shadow against it. ConfirmDialog owns no selector of its own on that
 * element (Modal renders it), so the locator below is Modal's own
 * `[data-part="modal-overlay"]` contract, not a ConfirmDialog part.
 *
 * THE FIXTURE PAINTS A PAGE BEHIND THE SCRIM for the same reason Modal's
 * fixture does: a wash over a blank white surface makes it invisible.
 */

/** Mounts into a fresh container that already carries `dark` when asked. */
async function renderFixture(ui: ReactNode, { dark = false } = {}) {
  await page.viewport(700, 500);

  const container = document.createElement("div");
  if (dark) container.classList.add("dark");
  Object.assign(container.style, {
    position: "fixed",
    inset: "0",
    background: "var(--bg)",
    color: "var(--fg)",
    fontFamily: "var(--font-mono)",
    fontSize: "var(--font-size-sm)",
  });
  document.body.appendChild(container);

  const screen = await renderWithTheme(ui, { container });
  await document.fonts.ready;
  return screen;
}

/** A few board-shaped rows behind the scrim, so the wash and the blur have
    something to act on — mirrors Modal.visual.test.tsx's own fixture. */
function BoardBehind() {
  return (
    <div style={{ padding: "1.5rem", display: "flex", flexDirection: "column", gap: "0.6rem" }}>
      {["myapp", "otherapp", "worker"].map((name) => (
        <div
          key={name}
          style={{
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            background: "var(--panel)",
            padding: "0.45rem 0.7rem",
          }}
        >
          {name}
        </div>
      ))}
    </div>
  );
}

/** The deck remove copy: a destructive confirm for tearing down a service. */
function RemoveConfirm() {
  return (
    <>
      <BoardBehind />
      <ConfirmDialog
        open
        title="Remove myapp?"
        confirmLabel="Remove"
        onConfirm={() => {}}
        onCancel={() => {}}
      >
        This deletes its service and route.
      </ConfirmDialog>
    </>
  );
}

function overlayLocator(container: HTMLElement) {
  const el = container.querySelector<HTMLElement>('[data-part="modal-overlay"]');
  if (!el) throw new Error("no modal overlay rendered");
  return page.elementLocator(el);
}

describe("ConfirmDialog (visual)", () => {
  it("the open remove-confirm dialog matches its baseline in light mode", async () => {
    const screen = await renderFixture(<RemoveConfirm />);

    await expect(overlayLocator(screen.container)).toMatchScreenshot("confirmdialog-open-light");
  });

  it("the open remove-confirm dialog matches its baseline in dark mode", async () => {
    const screen = await renderFixture(<RemoveConfirm />, { dark: true });

    await expect(overlayLocator(screen.container)).toMatchScreenshot("confirmdialog-open-dark");
  });
});
