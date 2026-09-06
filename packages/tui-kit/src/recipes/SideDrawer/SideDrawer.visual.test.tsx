import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { renderWithTheme } from "../../../test/test-utils.tsx";
import { SideDrawer, type SideDrawerSide } from "./SideDrawer.tsx";

/**
 * Visual tier for the SideDrawer recipe.
 *
 *  * FOUR BASELINES, NOT TWO: this recipe merges two mr-board families, so both
 * SIDES are captured in both SCHEMES. Each side has its own width, its own
 * border edge, its own shadow token (`--shadow-drawer` throws left,
 * `--shadow-drawer-left` throws right) and, for the left, its own padding and
 * gap — a two-baseline set would leave half the recipe unpinned.
 *
 * THE ANIMATION FREEZE IS INSTALLED HERE: SideDrawer.keyframes.css slides the
 * panel in from its own edge (sidedrawer-in), so a capture mid-slide would be
 * non-deterministic between runs. `animation: none !important` is what closes
 * that.
 *
 * THE OVERLAY IS THE CAPTURE TARGET, not the panel: it is `position: fixed;
 * inset: 0`, so its layout box IS the viewport, and the screenshot carries the
 * scrim, the blur, WHICH EDGE THE PANEL SAT ON, and the panel's shadow thrown
 * across the page behind it. A panel-only capture would prove none of those.
 * The fixture paints a page behind the scrim for the same reason Modal's
 * does — 55% of the page colour over the page colour is invisible.
 */

const NO_MOTION_CLASS = "sidedrawer-visual-no-motion";

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
  await page.viewport(700, 460);
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

/** A few board-shaped rows behind the scrim, so the wash, the blur and the
    panel's shadow have something to act on. */
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

/**
 * The two real call sites, side by side in one fixture function.
 *
 * `right` is CommentsDrawer: a sticky head plus threads, all of it app-side
 * markup passed through `children` (the drawer owns overlay + panel and
 * nothing inside). `left` is Board.tsx's burger menu: a head row and a stack
 * of controls, which is why that side's panel pads and gaps itself.
 */
function DrawerFixture({ side }: { side: SideDrawerSide }) {
  return (
    <>
      <BoardBehind />
      <SideDrawer side={side} ariaLabel={side === "right" ? "comment threads" : "menu"} onClose={() => {}}>
        {side === "right" ? <CommentsChildren /> : <MenuChildren />}
      </SideDrawer>
    </>
  );
}

function CommentsChildren() {
  return (
    <>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: "0.6rem",
          padding: "0.9rem 1rem 0.5rem",
          background: "var(--panel)",
        }}
      >
        <div style={{ fontWeight: 600, fontSize: "var(--font-size-xl)", lineHeight: 1.4 }}>
          <span style={{ color: "var(--muted)" }}>!42</span> harden team-zone materialize
        </div>
        <span style={{ color: "var(--muted)" }}>✕</span>
      </div>
      <div
        style={{
          padding: "0.8rem 1rem 1.4rem",
          display: "flex",
          flexDirection: "column",
          gap: "1rem",
        }}
      >
        {["awaiting", "replied", "resolved"].map((state) => (
          <div
            key={state}
            style={{
              border: "1px solid var(--border-soft)",
              borderLeft: "3px solid var(--accent)",
              borderRadius: "var(--radius-md)",
              padding: "0.55rem 0.7rem",
            }}
          >
            <div style={{ color: "var(--muted)", fontSize: "var(--font-size-xs)" }}>{state}</div>
            <div>the manifest slug edge case needs a test</div>
          </div>
        ))}
      </div>
    </>
  );
}

function MenuChildren() {
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontWeight: 700, color: "var(--accent)" }}>❯ menu</span>
        <span style={{ color: "var(--muted)" }}>✕</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
        {["matt", "bob", "carol"].map((name) => (
          <div key={name} style={{ padding: "0.25rem 0.4rem" }}>
            {name}
          </div>
        ))}
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "stretch",
          gap: "8px",
          paddingTop: "12px",
          borderTop: "1px solid var(--border-soft)",
        }}
      >
        <button
          type="button"
          style={{
            width: "100%",
            padding: "8px",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            background: "transparent",
            color: "var(--fg)",
            font: "inherit",
          }}
        >
          copy board link
        </button>
      </div>
    </>
  );
}

/** The overlay has no role and takes no `{...rest}`, so `page.elementLocator`
    on the element the `data-part` contract identifies is the locator this tier
    needs. */
function overlayLocator(container: HTMLElement) {
  const el = container.querySelector<HTMLElement>('[data-part="sidedrawer-overlay"]');
  if (!el) throw new Error("no drawer overlay rendered");
  return page.elementLocator(el);
}

describe("SideDrawer (visual)", () => {
  it("the RIGHT drawer matches its baseline in light mode", async () => {
    const screen = await renderFixture(<DrawerFixture side="right" />);

    await expect(overlayLocator(screen.container)).toMatchScreenshot("sidedrawer-right-light");
  });

  it("the RIGHT drawer matches its baseline in dark mode", async () => {
    const screen = await renderFixture(<DrawerFixture side="right" />, { dark: true });

    await expect(overlayLocator(screen.container)).toMatchScreenshot("sidedrawer-right-dark");
  });

  it("the LEFT drawer matches its baseline in light mode", async () => {
    const screen = await renderFixture(<DrawerFixture side="left" />);

    await expect(overlayLocator(screen.container)).toMatchScreenshot("sidedrawer-left-light");
  });

  it("the LEFT drawer matches its baseline in dark mode", async () => {
    const screen = await renderFixture(<DrawerFixture side="left" />, { dark: true });

    await expect(overlayLocator(screen.container)).toMatchScreenshot("sidedrawer-left-dark");
  });
});
