import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { renderWithTheme } from "../../../test/test-utils.tsx";
import { Spinner } from "./Spinner.tsx";

/**
 * Visual tier for the Spinner recipe.
 *
 * THE ANIMATION FREEZE IS INSTALLED HERE, following StatusDot's precedent,
 * but `animation: none` rather than `transition: none`: Spinner.keyframes.css
 * puts a perpetual `animation` (the spin) on `[data-part="spinner"]`, not a
 * transition, so a capture mid-rotation would be non-deterministic between runs.
 */

const NO_MOTION_CLASS = "spinner-visual-no-motion";

function installNoMotionStyle() {
  if (document.getElementById(NO_MOTION_CLASS)) return;
  const style = document.createElement("style");
  style.id = NO_MOTION_CLASS;
  style.textContent = `.${NO_MOTION_CLASS}, .${NO_MOTION_CLASS} * {
    animation: none !important;
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

const row = { display: "flex", alignItems: "center", gap: "1.5rem" } as const;
const cell = { display: "flex", alignItems: "center", gap: "0.4rem" } as const;

/** Both sizes, side by side, each labelled. */
function SizeRow() {
  return (
    <div data-testid="sizes" style={surface}>
      <div style={row}>
        {(["xs", "sm"] as const).map((size) => (
          <span key={size} style={cell}>
            <Spinner size={size} />
            {size}
          </span>
        ))}
      </div>
    </div>
  );
}

describe("Spinner (visual)", () => {
  it("both sizes match their baseline in light mode", async () => {
    await renderFixture(<SizeRow />);

    await expect(page.getByTestId("sizes")).toMatchScreenshot("spinner-sizes-light");
  });

  it("both sizes match their baseline in dark mode", async () => {
    await renderFixture(<SizeRow />, { dark: true });

    await expect(page.getByTestId("sizes")).toMatchScreenshot("spinner-sizes-dark");
  });
});
