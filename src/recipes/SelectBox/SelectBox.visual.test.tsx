import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { renderWithTheme } from "../../../test/test-utils.tsx";
import { SelectBox } from "./SelectBox.tsx";

/**
 * Visual tier for the SelectBox recipe.
 *
 * BASELINES ARE TRACKED IN GIT (`__screenshots__/SelectBox.visual.test.tsx/*.png`),
 * the spec's declared divergence from soribashi — see Icon.visual.test.tsx's
 * comment for the full rationale.
 *
 * NO TRANSITION FREEZE IS INSTALLED. `.tui-selectbox` has a `transition` (not
 * a perpetual `animation`), and this fixture captures RESTING states only
 * (unchecked / checked / hover), never mid-transition — nothing here would
 * animate at capture time, so there is no need for the freeze idiom Chip's
 * pulse requires.
 */

/** Mounts into a fresh container that already carries `dark` when asked. */
async function renderFixture(ui: ReactNode, { dark = false } = {}) {
  await page.viewport(400, 200);

  const container = document.createElement("div");
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

const row = { display: "flex", alignItems: "center", gap: "0.75rem" } as const;

function SelectBoxGrid() {
  return (
    <div data-testid="grid" style={{ ...surface }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        <div style={row}>
          <span>unchecked</span>
          <SelectBox checked={false} onToggle={() => {}} />
        </div>
        <div style={row}>
          <span>checked</span>
          <SelectBox checked onToggle={() => {}} />
        </div>
      </div>
    </div>
  );
}

describe("SelectBox (visual)", () => {
  it("the checked/unchecked grid matches its baseline in light mode", async () => {
    await renderFixture(<SelectBoxGrid />);

    await expect(page.getByTestId("grid")).toMatchScreenshot("selectbox-grid-light");
  });

  it("the checked/unchecked grid matches its baseline in dark mode", async () => {
    await renderFixture(<SelectBoxGrid />, { dark: true });

    await expect(page.getByTestId("grid")).toMatchScreenshot("selectbox-grid-dark");
  });
});
