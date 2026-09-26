import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { renderWithTheme } from "../../../test/test-utils.tsx";
import { Alert } from "./Alert.tsx";

/**
 * Visual tier for the Alert recipe.
 *
 * BASELINES ARE TRACKED IN GIT — see Badge.visual.test.tsx.
 *
 * No perpetual animation anywhere in Alert.module.css, so unlike
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

const surface = {
  display: "inline-block",
  padding: "1rem",
  background: "var(--panel)",
  color: "var(--fg)",
  fontFamily: "var(--font-mono)",
  fontSize: "var(--font-size-sm)",
  width: "22rem",
} as const;

const stack = { display: "flex", flexDirection: "column", gap: "0.6rem" } as const;

/** The deck proxy-notice shape: a bad alert with a command block, alongside
    a plain ok alert -- the same two states Act 2 actually composes. */
function AlertStack() {
  return (
    <div data-testid="alerts" style={surface}>
      <div style={stack}>
        <Alert intent="ok">connected to mattstack</Alert>
        <Alert intent="bad">form could not be saved</Alert>
        <Alert intent="bad" command="npm install -g mattstack">
          your CLI is out of date — update with:
        </Alert>
      </div>
    </div>
  );
}

describe("Alert (visual)", () => {
  it("ok, bad, and bad-with-command match their baseline in light mode", async () => {
    await renderFixture(<AlertStack />);

    await expect(page.getByTestId("alerts")).toMatchScreenshot("alert-intents-light");
  });

  it("ok, bad, and bad-with-command match their baseline in dark mode", async () => {
    await renderFixture(<AlertStack />, { dark: true });

    await expect(page.getByTestId("alerts")).toMatchScreenshot("alert-intents-dark");
  });
});
