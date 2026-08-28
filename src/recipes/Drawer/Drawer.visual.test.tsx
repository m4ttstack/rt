import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { renderWithTheme } from "../../../test/test-utils.tsx";
import { Drawer, type DrawerScreen } from "./Drawer.tsx";

/**
 * Visual tier for the Drawer recipe.
 *
 * BASELINES ARE TRACKED IN GIT — see Icon.visual.test.tsx.
 *
 * THE ANIMATION FREEZE IS INSTALLED HERE, following ToastHost's precedent:
 * the panel Drawer composes slides in from its edge (SideDrawer.keyframes.css,
 * sidedrawer-in), so a capture mid-slide would be non-deterministic between
 * runs.
 *
 * THE OVERLAY IS THE CAPTURE TARGET, not the panel — same reasoning as
 * SideDrawer.visual.test.tsx: it is `position: fixed; inset: 0`, so its
 * layout box IS the viewport, and the screenshot carries the scrim and the
 * panel's shadow thrown across the page behind it.
 */

const NO_MOTION_CLASS = "drawer-visual-no-motion";

function installNoMotionStyle() {
  if (document.getElementById(NO_MOTION_CLASS)) return;
  const style = document.createElement("style");
  style.id = NO_MOTION_CLASS;
  style.textContent = `.${NO_MOTION_CLASS}, .${NO_MOTION_CLASS} * {
    animation: none !important;
    transition: none !important;
  }`;
  document.head.appendChild(style);
}

/** Mounts into a fresh container that already carries `dark` when asked. */
async function renderFixture(ui: ReactNode, { dark = false } = {}) {
  await page.viewport(900, 640);
  installNoMotionStyle();

  const container = document.createElement("div");
  container.classList.add(NO_MOTION_CLASS);
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

/** A few board-shaped rows behind the scrim, matching SideDrawer's own
    fixture — the scrim wash has something real to act on. */
function BoardBehind() {
  return (
    <div style={{ padding: "1.5rem", display: "flex", flexDirection: "column", gap: "0.6rem" }}>
      {[42, 41, 38].map((iid) => (
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

/** Three screens: a reading screen, an editing screen with a navAction (the
    demo's push target — the fixture opens ON it, one level deep, so the back
    link and the Save action are both in frame), and a danger screen. */
const READING: DrawerScreen = {
  id: "reading",
  title: "Board settings",
  content: (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
      <p>Polling interval, review thresholds, and notification routing.</p>
    </div>
  ),
};

function EditingScreen(): DrawerScreen {
  return {
    id: "editing",
    title: "Edit polling interval",
    header: (
      <div style={{ color: "var(--amber)", fontSize: "var(--font-size-sm)" }}>unsaved changes</div>
    ),
    navAction: { label: "Save", onAction: () => {} },
    content: (
      <label style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
        interval (seconds)
        <input defaultValue="30" style={{ font: "inherit", padding: "0.3rem 0.5rem" }} />
      </label>
    ),
  };
}

function DrawerFixture() {
  return (
    <>
      <BoardBehind />
      <Drawer
        open
        stack={[READING, EditingScreen()]}
        onBack={() => {}}
        onClose={() => {}}
        ariaLabel="board settings"
      />
    </>
  );
}

/** The overlay has no role of its own — same locator shape SideDrawer's
    visual tier uses. */
function overlayLocator(container: HTMLElement) {
  const el = container.querySelector<HTMLElement>('[data-part="sidedrawer-overlay"]');
  if (!el) throw new Error("no drawer overlay rendered");
  return page.elementLocator(el);
}

describe("Drawer (visual)", () => {
  it("the editing screen, one level deep, matches its baseline in light mode", async () => {
    const screen = await renderFixture(<DrawerFixture />);

    await expect(overlayLocator(screen.container)).toMatchScreenshot("drawer-editing-light");
  });

  it("the editing screen, one level deep, matches its baseline in dark mode", async () => {
    const screen = await renderFixture(<DrawerFixture />, { dark: true });

    await expect(overlayLocator(screen.container)).toMatchScreenshot("drawer-editing-dark");
  });
});
