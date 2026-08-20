import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { renderWithTheme } from "../../../test/test-utils.tsx";
import { Panel } from "./Panel.tsx";

/**
 * Visual tier for the Panel recipe.
 *
 * BASELINES ARE TRACKED IN GIT (`__screenshots__/Panel.visual.test.tsx/*.png`),
 * the spec's declared divergence from soribashi — see Icon.visual.test.tsx's
 * comment for the full rationale.
 *
 * NO TRANSITION/ANIMATION FREEZE IS INSTALLED HERE. `.tui-panel-caret`
 * declares `transition: transform 120ms ease` (lifted verbatim in
 * Panel.module.css), but nothing in mr-board's own CSS — or this recipe's —
 * ever sets a `transform` on it: the expanded/collapsed indication is the ▾/▸
 * GLYPH SWAP in Panel.tsx, not a CSS rotation. The transition is dead board
 * CSS, carried forward unchanged rather than "fixed"; there is nothing for a
 * capture to catch mid-interpolation either way.
 *
 * Fixtures mount already-collapsed by seeding localStorage before the effect
 * runs (rather than clicking then screenshotting), so the capture never races
 * the toggle's own state update.
 */

/** Mounts into a fresh container that already carries `dark` when asked. */
async function renderFixture(ui: ReactNode, { dark = false } = {}) {
  await page.viewport(500, 260);

  const container = document.createElement("div");
  if (dark) container.classList.add("dark");
  document.body.appendChild(container);

  const screen = await renderWithTheme(ui, { container });
  await document.fonts.ready;
  return screen;
}

const surface = {
  display: "block",
  padding: "2rem 1.5rem",
  background: "var(--bg)",
  color: "var(--fg)",
  fontFamily: "var(--font-mono)",
  fontSize: "var(--font-size-sm)",
} as const;

function ExpandedFixture() {
  return (
    <div data-testid="panel" style={surface}>
      <Panel title="open MRs" count={3} storageKey="panel-visual-expanded">
        <div>mr-board/mr!42 — fix: harden team-zone materialize</div>
        <div>mr-board/mr!41 — feat: on-demand team-config materialize</div>
      </Panel>
    </div>
  );
}

function CollapsedFixture() {
  // Seeded BEFORE mount so the panel's own read-on-mount effect finds it
  // already collapsed on the first real render — no click, no post-mount
  // state flip to race against the screenshot.
  window.localStorage.setItem("panel-visual-collapsed", JSON.stringify(["open MRs"]));
  return (
    <div data-testid="panel" style={surface}>
      <Panel title="open MRs" count={3} storageKey="panel-visual-collapsed">
        <div>mr-board/mr!42 — fix: harden team-zone materialize</div>
      </Panel>
    </div>
  );
}

describe("Panel (visual)", () => {
  it("the expanded, framed form matches its baseline in light mode", async () => {
    await renderFixture(<ExpandedFixture />);
    await expect
      .poll(() => document.querySelector('[aria-controls]')?.getAttribute("aria-expanded"))
      .toBe("true");

    await expect(page.getByTestId("panel")).toMatchScreenshot("panel-expanded-light");
  });

  it("the expanded, framed form matches its baseline in dark mode", async () => {
    await renderFixture(<ExpandedFixture />, { dark: true });
    await expect
      .poll(() => document.querySelector('[aria-controls]')?.getAttribute("aria-expanded"))
      .toBe("true");

    await expect(page.getByTestId("panel")).toMatchScreenshot("panel-expanded-dark");
  });

  it("the collapsed, full-width bar form matches its baseline in light mode", async () => {
    await renderFixture(<CollapsedFixture />);
    await expect
      .poll(() => document.querySelector('[aria-controls]')?.getAttribute("aria-expanded"))
      .toBe("false");

    await expect(page.getByTestId("panel")).toMatchScreenshot("panel-collapsed-light");
  });

  it("the collapsed, full-width bar form matches its baseline in dark mode", async () => {
    await renderFixture(<CollapsedFixture />, { dark: true });
    await expect
      .poll(() => document.querySelector('[aria-controls]')?.getAttribute("aria-expanded"))
      .toBe("false");

    await expect(page.getByTestId("panel")).toMatchScreenshot("panel-collapsed-dark");
  });
});
