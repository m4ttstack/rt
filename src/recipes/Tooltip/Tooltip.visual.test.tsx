import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { renderWithTheme } from "../../../test/test-utils.tsx";
import { Tooltip } from "./Tooltip.tsx";

/**
 * Visual tier for the Tooltip recipe.
 *
 * THE ANIMATION FREEZE IS INSTALLED HERE, following StatusDot's precedent:
 * Tooltip.module.css's hover card carries a real `transition` (opacity, with
 * a delay), so a capture mid-fade would be non-deterministic between runs.
 */

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

/** Mounts into a fresh container that already carries `dark` when asked. */
async function renderFixture(ui: ReactNode, { dark = false } = {}) {
  await page.viewport(700, 400);
  installNoMotionStyle();

  const container = document.createElement("div");
  container.classList.add(NO_MOTION_CLASS);
  if (dark) container.classList.add("dark");
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

    await expect(page.getByTestId("tooltip")).toMatchScreenshot("tooltip-hovered-light");
  });

  it("the hovered card matches its baseline in dark mode", async () => {
    await renderFixture(<Fixture />, { dark: true });

    await page.getByTestId("tip").hover();

    await expect(page.getByTestId("tooltip")).toMatchScreenshot("tooltip-hovered-dark");
  });
});
