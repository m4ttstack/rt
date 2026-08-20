import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { renderWithTheme } from "../../../test/test-utils.tsx";
import { LabeledSeg, Segmented } from "./Segmented.tsx";

/**
 * Visual tier for the Segmented recipe (+ LabeledSeg).
 *
 *  * NO TRANSITION/ANIMATION FREEZE IS INSTALLED HERE, deliberately. Neither
 * `.tui-seg` nor `.tui-seg-text` declares a `transition` or `animation` in
 * mr-board's source (unlike Chip's pulse), so Segmented.module.css declares
 * neither either, and there is nothing to interpolate mid-capture — the same
 * reasoning Icon's file states for itself.
 */

/** Mounts into a fresh container that already carries `dark` when asked. */
async function renderFixture(ui: ReactNode, { dark = false } = {}) {
  await page.viewport(700, 500);

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

type Tab = "rows" | "grid" | "light" | "dark" | "settings";
const TAB_OPTIONS: readonly Tab[] = ["rows", "grid", "light", "dark", "settings"];
const TAB_LABELS: Record<Tab, string> = {
  rows: "Rows",
  grid: "Grid",
  light: "Light",
  dark: "Dark",
  settings: "Settings",
};

/** The icon-only control (mr-board's view-switch header control) at each
 * possible active option, plus LabeledSeg's text form (the drawer control). */
function SegmentedGrid() {
  return (
    <div data-testid="grid" style={{ ...surface }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <div style={row}>
          <span>active: rows</span>
          <Segmented options={TAB_OPTIONS} value="rows" onChange={() => {}} label="view" />
        </div>
        <div style={row}>
          <span>active: settings</span>
          <Segmented options={TAB_OPTIONS} value="settings" onChange={() => {}} label="view" />
        </div>
        <div style={row}>
          <span>labeled, active: grid</span>
          <LabeledSeg
            legend="view mode"
            options={TAB_OPTIONS.slice(0, 3)}
            labels={TAB_LABELS}
            value="grid"
            onChange={() => {}}
          />
        </div>
      </div>
    </div>
  );
}

describe("Segmented (visual)", () => {
  it("the control grid matches its baseline in light mode", async () => {
    await renderFixture(<SegmentedGrid />);

    await expect(page.getByTestId("grid")).toMatchScreenshot("segmented-grid-light");
  });

  it("the control grid matches its baseline in dark mode", async () => {
    await renderFixture(<SegmentedGrid />, { dark: true });

    await expect(page.getByTestId("grid")).toMatchScreenshot("segmented-grid-dark");
  });
});
