import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { renderWithTheme } from "../../../test/test-utils.tsx";
import { Switch } from "./Switch.tsx";

/**
 * Visual tier for the Switch recipe.
 *
 * THE ANIMATION FREEZE IS INSTALLED HERE, following Badge/StatusDot's
 * precedent: Switch.module.css's track/thumb both carry a real `transition`
 * (background, border-color, left), so a capture mid-slide would be
 * non-deterministic between runs.
 */

const NO_MOTION_CLASS = "switch-visual-no-motion";

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
  display: "inline-block",
  padding: "1rem",
  background: "var(--panel)",
  color: "var(--fg)",
  fontFamily: "var(--font-mono)",
  fontSize: "var(--font-size-sm)",
} as const;

const column = { display: "flex", flexDirection: "column", gap: "0.6rem" } as const;

/** Off, on, disabled-off, disabled-on, one labeled -- the brief's five cells. */
function SwitchGrid() {
  return (
    <div data-testid="switches" style={surface}>
      <div style={column}>
        <Switch checked={false} onChange={() => {}} aria-label="off" />
        <Switch checked={true} onChange={() => {}} aria-label="on" />
        <Switch checked={false} onChange={() => {}} aria-label="disabled off" disabled />
        <Switch checked={true} onChange={() => {}} aria-label="disabled on" disabled />
        <Switch checked={false} onChange={() => {}} label="Password protected" />
      </div>
    </div>
  );
}

describe("Switch (visual)", () => {
  it("the five states match their baseline in light mode", async () => {
    await renderFixture(<SwitchGrid />);

    await expect(page.getByTestId("switches")).toMatchScreenshot("switch-states-light");
  });

  it("the five states match their baseline in dark mode", async () => {
    await renderFixture(<SwitchGrid />, { dark: true });

    await expect(page.getByTestId("switches")).toMatchScreenshot("switch-states-dark");
  });
});
