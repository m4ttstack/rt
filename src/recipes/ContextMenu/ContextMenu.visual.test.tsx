import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { renderWithTheme } from "../../../test/test-utils.tsx";
import { ContextMenu } from "./ContextMenu.tsx";

/**
 * Visual tier for the ContextMenu recipe.
 *
 *  * THE ANIMATION FREEZE IS INSTALLED HERE, following Chip's and ToastHost's
 * precedent: ContextMenu.keyframes.css puts a real (one-shot, not
 * perpetual) animation (contextmenu-in) on [data-part="contextmenu"], so a
 * capture mid-open would be non-deterministic between runs in BOTH opacity
 * and geometry — the keyframe
 * opens on `scale(0.97) translateY(-2px)`. `animation: none !important` is
 * what closes that; `transition: none` alone would do nothing for an
 * `animation`.
 */

const NO_MOTION_CLASS = "contextmenu-visual-no-motion";

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
  await page.viewport(520, 460);
  installNoMotionStyle();

  const container = document.createElement("div");
  container.classList.add(NO_MOTION_CLASS);
  // The menu's own `position: fixed` anchors to the VIEWPORT, not this
  // container, so the container carries no positioning of its own — it exists
  // only to scope the no-motion class and hold the dark flag, whose custom
  // properties the menu still inherits through the DOM tree.
  if (dark) container.classList.add("dark");
  document.body.appendChild(container);

  const screen = await renderWithTheme(ui, { container });
  await document.fonts.ready;
  return screen;
}

/**
 * A menu shaped like the one RowMenu actually opens on an MR row: the `!iid`
 * label, pane-launching items carrying their "herdr" hint, an item with no
 * hint at all, a separator, the Slack block, one item bearing a `trailing`
 * node (mr-board's ✓ mark, whose `.tui-menu-check` class stays app-side —
 * hence the inline colour here rather than a kit slot), and one disabled item.
 * Every slot the recipe owns appears at least once.
 */
function boardMenu() {
  return (
    <ContextMenu x={20} y={20} ariaLabel="actions for !4821" onClose={() => {}}>
      <ContextMenu.Label>!4821</ContextMenu.Label>
      <ContextMenu.Item label="review" hint="herdr" onClick={() => {}} />
      <ContextMenu.Item label="focus review tab" hint="herdr" onClick={() => {}} />
      <ContextMenu.Item label="mark as draft" hint="gitlab" onClick={() => {}} />
      <ContextMenu.Item label="open in gitlab" onClick={() => {}} />
      <ContextMenu.Item label="copy for slack" onClick={() => {}} />
      <ContextMenu.Separator />
      <ContextMenu.Item
        label="unmark ✅ on slack"
        trailing={<span style={{ color: "var(--dot-ok)", fontSize: "12px" }}>✓</span>}
        onClick={() => {}}
      />
      <ContextMenu.Item label="post to slack" onClick={() => {}} />
      <ContextMenu.Item label="mark 👀 on slack" disabled onClick={() => {}} />
    </ContextMenu>
  );
}

describe("ContextMenu (visual)", () => {
  it("the board menu matches its baseline in light mode", async () => {
    const screen = await renderFixture(boardMenu());

    // `position: fixed` means the menu paints at the VIEWPORT's own top-left
    // rather than flowing inside `container` — a locator screenshot still
    // resolves the element's own (fixed) layout box, so this captures exactly
    // the menu, nothing more.
    await expect(
      screen.getByRole("menu", { name: "actions for !4821" }),
    ).toMatchScreenshot("contextmenu-board-light");
  });

  it("the board menu matches its baseline in dark mode", async () => {
    const screen = await renderFixture(boardMenu(), { dark: true });

    await expect(
      screen.getByRole("menu", { name: "actions for !4821" }),
    ).toMatchScreenshot("contextmenu-board-dark");
  });

  it("the hovered item's accent wash matches its baseline", async () => {
    // The one state neither still above can show: `.item:hover:not(:disabled)`
    // paints `--surface-wash-accent-16`, the same wash Segmented and SelectBox
    // use, and it is the menu's only interactive colour.
    const screen = await renderFixture(boardMenu());

    await screen.getByRole("menuitem", { name: "open in gitlab" }).hover();

    await expect(
      screen.getByRole("menu", { name: "actions for !4821" }),
    ).toMatchScreenshot("contextmenu-hover-light");
  });
});
