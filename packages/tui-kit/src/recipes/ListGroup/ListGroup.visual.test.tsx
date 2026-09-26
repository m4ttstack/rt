import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { renderWithTheme } from "../../../test/test-utils.tsx";
import { ListGroup } from "./ListGroup.tsx";

/**
 * Visual tier for the ListGroup recipe.
 *
 * BASELINES ARE TRACKED IN GIT — see Icon.visual.test.tsx.
 *
 * This is also the recipe's MATRIX_CLASSIFICATION `toneMapCoveredBy` pin:
 * Action's `intent` is a recipe-local accent/bad map (ListGroup.module.css's
 * `[data-intent]` rules), not the shared Button resolver -- the light+dark
 * captures below are the visual-baseline test src/a11y/matrix-classification.ts
 * points at for both intent values.
 *
 * No perpetual animation in ListGroup.module.css (only a hover/focus
 * `transition`, which does not interpolate at rest), so unlike Badge/StatusDot
 * there is no motion freeze to install here.
 */

/** Mounts into a fresh container that already carries `dark` when asked. */
async function renderFixture(ui: ReactNode, { dark = false } = {}) {
  await page.viewport(700, 900);

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
  background: "var(--bg)",
  width: "24rem",
} as const;

const stack = { display: "flex", flexDirection: "column", gap: "1rem" } as const;

/** Every row variant, both Action intents, Danger, busy and disabled states,
    plus a footer -- the brief's full row-variant sweep in one capture. */
function ListGroupStates() {
  return (
    <div data-testid="listgroup-states" style={surface}>
      <div style={stack}>
        <ListGroup footer="Changes apply immediately.">
          <ListGroup.Nav label="Region" value="us-east-1" onClick={() => {}} />
          <ListGroup.Nav label="Notifications" onClick={() => {}} disabled />
          <ListGroup.Toggle label="Dark mode" checked={true} onChange={() => {}} />
          <ListGroup.Fact label="Plan" value="Pro" />
          <ListGroup.Input label="Slug" value="mr-board" onChange={() => {}} />
        </ListGroup>
        <ListGroup>
          <ListGroup.Action label="Restart service" onClick={() => {}} intent="accent" />
          <ListGroup.Action label="Retrying…" onClick={() => {}} busy />
          <ListGroup.Danger label="Delete workspace" onClick={() => {}} />
        </ListGroup>
      </div>
    </div>
  );
}

describe("ListGroup (visual)", () => {
  it("every row variant, both Action intents, busy/disabled states match their baseline in light mode", async () => {
    await renderFixture(<ListGroupStates />);

    await expect(page.getByTestId("listgroup-states")).toMatchScreenshot("listgroup-states-light");
  });

  it("every row variant, both Action intents, busy/disabled states match their baseline in dark mode", async () => {
    await renderFixture(<ListGroupStates />, { dark: true });

    await expect(page.getByTestId("listgroup-states")).toMatchScreenshot("listgroup-states-dark");
  });
});
