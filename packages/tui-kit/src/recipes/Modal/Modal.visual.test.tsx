import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { renderWithTheme } from "../../../test/test-utils.tsx";
import { Modal } from "./Modal.tsx";

/**
 * Visual tier for the Modal recipe.
 *
 *  * NO MOTION FREEZE IS INSTALLED, deliberately: Modal.module.css declares
 * neither a `transition` nor an `animation` (mr-board's `.tui-modal*` family
 * has none either — the dialog appears and disappears with its mount), so
 * there is no interpolating frame a capture could land mid-way through.
 * Copying ToastHost's/Chip's freeze in anyway would teach the next recipe to
 * cargo-cult it.
 *
 * THE OVERLAY IS THE CAPTURE TARGET, not the frame. It is `position: fixed;
 * inset: 0`, so its layout box IS the viewport — the screenshot therefore
 * carries the scrim wash, the backdrop blur, and the frame's shadow against
 * them, which is the whole visual contract of a modal. A frame-only capture
 * would prove none of the three.
 *
 * THE FIXTURE PAINTS A PAGE BEHIND THE SCRIM for the same reason. A modal over
 * a blank white test surface makes `--surface-wash-bg-55` and
 * `backdrop-filter: blur(2px)` invisible: 55% of the page colour over the page
 * colour is the page colour, and there is nothing to blur. The backdrop block
 * below is deliberately text-heavy so the blur has edges to soften.
 */

/** Mounts into a fresh container that already carries `dark` when asked. */
async function renderFixture(ui: ReactNode, { dark = false } = {}) {
  await page.viewport(700, 500);

  const container = document.createElement("div");
  if (dark) container.classList.add("dark");
  // The container IS the page: fixed and full-bleed, so the board background
  // sits behind the scrim, and carrying the board's own text colour and mono
  // face so `children` render the way mr-board renders them (the same
  // `surface` treatment Panel.visual.test.tsx's fixtures use, moved onto the
  // container here because Modal's overlay is `position: fixed` and would
  // escape an in-flow wrapper's box).
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
    something to act on. */
function BoardBehind() {
  return (
    <div style={{ padding: "1.5rem", display: "flex", flexDirection: "column", gap: "0.6rem" }}>
      {[42, 41, 38, 37, 31].map((iid) => (
        <div
          key={iid}
          style={{
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            background: "var(--panel)",
            padding: "0.45rem 0.7rem",
          }}
        >
          mr-board/mr!{iid} — feat: on-demand team-config materialize
        </div>
      ))}
    </div>
  );
}

/** The settings modal, near enough verbatim: mr-board's own title register,
    its literal "✕" closeGlyph, and a `.tui-modal-sub`-shaped subtitle plus a
    few rows, so the capture shows a real content block inside the frame
    rather than an empty box. */
function SettingsLikeModal() {
  return (
    <>
      <BoardBehind />
      <Modal title="❯ team members" ariaLabel="team settings" onClose={() => {}} closeGlyph="✕">
        <p
          style={{
            color: "var(--muted)",
            fontSize: "var(--font-size-md)",
            margin: "0.2rem 0 0.9rem",
          }}
        >
          # check people out to hide them from the board
        </p>
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: "2px",
          }}
        >
          {["matt", "bob", "carol"].map((name) => (
            <li
              key={name}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "10px",
                padding: "5px 6px",
                borderRadius: "var(--radius-md)",
              }}
            >
              <span>{name}</span>
              <span style={{ color: "var(--muted)" }}>3</span>
            </li>
          ))}
        </ul>
      </Modal>
    </>
  );
}

/** The overlay has no role and takes no `{...rest}` (everything a consumer
    passes belongs to the frame), so there is no `data-testid` route to it —
    `page.elementLocator` on the element the `data-part` contract identifies is
    the locator this tier needs. */
function overlayLocator(container: HTMLElement) {
  const el = container.querySelector<HTMLElement>('[data-part="modal-overlay"]');
  if (!el) throw new Error("no modal overlay rendered");
  return page.elementLocator(el);
}

describe("Modal (visual)", () => {
  it("an open modal matches its baseline in light mode", async () => {
    const screen = await renderFixture(<SettingsLikeModal />);

    await expect(overlayLocator(screen.container)).toMatchScreenshot("modal-open-light");
  });

  it("an open modal matches its baseline in dark mode", async () => {
    const screen = await renderFixture(<SettingsLikeModal />, { dark: true });

    await expect(overlayLocator(screen.container)).toMatchScreenshot("modal-open-dark");
  });
});
