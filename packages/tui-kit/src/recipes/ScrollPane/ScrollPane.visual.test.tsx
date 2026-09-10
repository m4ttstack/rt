import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { renderWithTheme } from "../../../test/test-utils.tsx";
import { ScrollPane } from "./ScrollPane.tsx";

/**
 * Visual tier for the ScrollPane recipe.
 *
 * BASELINES ARE TRACKED IN GIT: see Badge.visual.test.tsx.
 *
 * No perpetual animation anywhere in ScrollPane.module.css, so unlike
 * Badge/StatusDot there is no motion freeze to install here.
 */

/** Mounts into a fresh container that already carries `dark` when asked. */
async function renderFixture(ui: ReactNode, { dark = false } = {}) {
  await page.viewport(700, 400);

  const container = document.createElement("div");
  if (dark) container.classList.add("dark");
  document.body.appendChild(container);

  const screen = await renderWithTheme(ui, { container });
  await document.fonts.ready;
  return screen;
}

/** A capped pane with overflowing content, so the band and the border-hugging
    scrollbar both render. */
function DecisionContextPane() {
  return (
    <div data-testid="scrollpane">
      <ScrollPane title="Decision context" maxHeight="12rem" style={{ width: "24rem" }}>
        {Array.from({ length: 20 }, (_, i) => (
          <p key={i}>context line {i + 1} with enough words to wrap once or twice</p>
        ))}
      </ScrollPane>
    </div>
  );
}

describe("ScrollPane (visual)", () => {
  it("matches its baseline in light mode", async () => {
    await renderFixture(<DecisionContextPane />);

    await expect(page.getByTestId("scrollpane")).toMatchScreenshot("scrollpane-light");
  });

  it("matches its baseline in dark mode", async () => {
    await renderFixture(<DecisionContextPane />, { dark: true });

    await expect(page.getByTestId("scrollpane")).toMatchScreenshot("scrollpane-dark");
  });
});
