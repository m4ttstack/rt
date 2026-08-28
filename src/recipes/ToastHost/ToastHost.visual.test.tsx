import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { renderWithTheme } from "../../../test/test-utils.tsx";
import type { Toast } from "../../hooks/index.ts";
import { ToastHost } from "./ToastHost.tsx";

/**
 * Visual tier for the ToastHost recipe.
 *
 *  * THE ANIMATION FREEZE IS INSTALLED HERE, following Chip's precedent:
 * ToastHost.keyframes.css puts a real (one-shot, not perpetual) animation
 * (toasthost-in) on [data-part="toasthost-toast"], so a capture mid-slide-in
 * would be non-deterministic between runs. `animation: none !important` is what
 * closes that — `transition: none` alone would do nothing for an `animation`
 *.
 */

const NO_MOTION_CLASS = "toasthost-visual-no-motion";

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
  await page.viewport(700, 400);
  installNoMotionStyle();

  const container = document.createElement("div");
  container.classList.add(NO_MOTION_CLASS);
  // ToastHost's own `position: fixed` anchors to the VIEWPORT, not this
  // container, so the container itself carries no positioning of its own —
  // it exists only to scope the no-motion class and hold the dark flag.
  if (dark) container.classList.add("dark");
  document.body.appendChild(container);

  const screen = await renderWithTheme(ui, { container });
  await document.fonts.ready;
  return screen;
}

const TOASTS: Toast[] = [
  { id: 1, text: "posted to slack" },
  { id: 2, text: "copied" },
  { id: 3, text: "re-review requested from bob, carol" },
];

describe("ToastHost (visual)", () => {
  it("the toast stack matches its baseline in light mode", async () => {
    const screen = await renderFixture(<ToastHost toasts={TOASTS} />);

    // `position: fixed` means the host paints at the VIEWPORT's own
    // bottom-right rather than flowing inside `container` -- a locator
    // screenshot still resolves the element's own (fixed) layout box
    // correctly, so this captures exactly the stack, nothing more.
    await expect(screen.getByRole("status")).toMatchScreenshot("toasthost-stack-light");
  });

  it("the toast stack matches its baseline in dark mode", async () => {
    const screen = await renderFixture(<ToastHost toasts={TOASTS} />, { dark: true });

    await expect(screen.getByRole("status")).toMatchScreenshot("toasthost-stack-dark");
  });
});
