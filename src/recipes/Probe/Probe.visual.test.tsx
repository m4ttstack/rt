import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { renderWithTheme } from "../../../test/test-utils.tsx";
import { Probe } from "./Probe.tsx";

/**
 * TEMPORARY — see Probe.tsx. Proves the visual half of the browser tier:
 * `page.viewport`, `toMatchScreenshot` with the pixelmatch comparator
 * configured in vitest.browser.config.ts, and baseline creation on first run.
 */
describe("Probe (visual)", () => {
  it("light and dark side by side", async () => {
    await page.viewport(400, 200);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const screen = await renderWithTheme(
      <div style={{ display: "flex", gap: 8 }}>
        <Probe>light</Probe>
        <div className="dark">
          <Probe>dark</Probe>
        </div>
      </div>,
      { container },
    );
    await document.fonts.ready;

    await expect(screen.container.firstElementChild!).toMatchScreenshot("probe-schemes");
  });
});
