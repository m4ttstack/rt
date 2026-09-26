import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { renderWithTheme } from "../../../test/test-utils.tsx";
import { Tooltip, TOOLTIP_PARTS } from "./Tooltip.tsx";

/**
 * Visual tier for the Tooltip recipe.
 *
 * The card is a portaled, JS-mounted element now (TooltipCard.tsx), not a
 * CSS `::after` with a `transition-delay` — so the flakiness risk moved from
 * "captured mid-fade" to "captured before the show timer has fired". Every
 * hovered case awaits the card's actual appearance in `document.body` before
 * screenshotting, rather than trusting `toMatchScreenshot`'s own retry timing.
 */

async function waitForCard(): Promise<void> {
  await expect
    .poll(() => document.querySelector(`[data-part="${TOOLTIP_PARTS.card}"]`), { timeout: 1000 })
    .not.toBeNull();
}

const NO_MOTION_CLASS = "tooltip-visual-no-motion";

function installNoMotionStyle() {
  if (document.getElementById(NO_MOTION_CLASS)) return;
  const style = document.createElement("style");
  style.id = NO_MOTION_CLASS;
  style.textContent = `.${NO_MOTION_CLASS}, .${NO_MOTION_CLASS} * {
    transition: none !important;
  }`;
  document.head.appendChild(style);
}

/** Mounts into a fresh container, toggling `dark` on `document.body` rather
    than on the container itself: the card portals straight to `document.body`
    (outside the container's subtree), and `.dark`'s `color-scheme: dark` only
    reaches a `light-dark()` token through descendants of whichever element
    carries the class — same rule production relies on with `.dark` on
    `<html>`. Explicitly set (not merely added) each call, so a leftover class
    from a previous dark case can't bleed into a later light one. */
async function renderFixture(ui: ReactNode, { dark = false } = {}) {
  await page.viewport(700, 400);
  installNoMotionStyle();
  document.body.classList.toggle("dark", dark);

  const container = document.createElement("div");
  container.classList.add(NO_MOTION_CLASS);
  document.body.appendChild(container);

  const screen = await renderWithTheme(ui, { container });
  await document.fonts.ready;
  return screen;
}

const surface = {
  display: "block",
  width: "22rem",
  padding: "1rem",
  paddingBottom: "6rem",
  background: "var(--panel)",
  color: "var(--fg)",
  fontFamily: "var(--font-mono)",
  fontSize: "var(--font-size-sm)",
} as const;

function Fixture() {
  return (
    <div data-testid="tooltip" style={surface}>
      <Tooltip data-testid="tip" tip={"hover for details\nsecond line"}>
        <button type="button">hover me</button>
      </Tooltip>
    </div>
  );
}

describe("Tooltip (visual)", () => {
  it("the resting wrapper matches its baseline in light mode", async () => {
    await renderFixture(<Fixture />);

    await expect(page.getByTestId("tooltip")).toMatchScreenshot("tooltip-resting-light");
  });

  it("the resting wrapper matches its baseline in dark mode", async () => {
    await renderFixture(<Fixture />, { dark: true });

    await expect(page.getByTestId("tooltip")).toMatchScreenshot("tooltip-resting-dark");
  });

  it("the hovered card matches its baseline in light mode", async () => {
    await renderFixture(<Fixture />);

    await page.getByTestId("tip").hover();
    await waitForCard();

    await expect(page.getByTestId("tooltip")).toMatchScreenshot("tooltip-hovered-light");
  });

  it("the hovered card matches its baseline in dark mode", async () => {
    await renderFixture(<Fixture />, { dark: true });

    await page.getByTestId("tip").hover();
    await waitForCard();

    await expect(page.getByTestId("tooltip")).toMatchScreenshot("tooltip-hovered-dark");
  });
});
