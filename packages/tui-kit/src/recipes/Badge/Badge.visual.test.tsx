import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { renderWithTheme } from "../../../test/test-utils.tsx";
import { ICONS } from "../Icon/Icon.tsx";
import { Spinner } from "../Spinner/Spinner.tsx";
import { Badge } from "./Badge.tsx";

/**
 * Visual tier for the Badge recipe.
 *
 * BASELINES ARE TRACKED IN GIT — see Icon.visual.test.tsx.
 *
 * THE ANIMATION FREEZE IS INSTALLED HERE, following Button/Spinner's
 * precedent: the warn cell embeds a Spinner, whose ring carries a PERPETUAL
 * `animation` (Spinner.keyframes.css). Without the freeze, that cell would be
 * captured at whatever rotation the keyframe happened to be interpolating
 * through at that instant, different on every run.
 */

const NO_MOTION_CLASS = "badge-visual-no-motion";

function installNoMotionStyle() {
  if (document.getElementById(NO_MOTION_CLASS)) return;
  const style = document.createElement("style");
  style.id = NO_MOTION_CLASS;
  style.textContent = `.${NO_MOTION_CLASS}, .${NO_MOTION_CLASS} * {
    animation: none !important;
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

const row = { display: "flex", alignItems: "center", gap: "0.6rem" } as const;

/** All four intents: one plain, one with an icon glyph, one with a frozen
    Spinner — the same deck health shapes Act 2 composes them into. */
function IntentRow() {
  return (
    <div data-testid="intents" style={surface}>
      <div style={row}>
        <Badge intent="ok" title="HTTP 200">
          200 34ms
        </Badge>
        <Badge intent="warn">
          <Spinner size="xs" /> restarting…
        </Badge>
        <Badge intent="bad">{ICONS["triangle-alert"]} unreachable</Badge>
        <Badge intent="muted">idle</Badge>
      </div>
    </div>
  );
}

describe("Badge (visual)", () => {
  it("the four intents match their baseline in light mode", async () => {
    await renderFixture(<IntentRow />);

    await expect(page.getByTestId("intents")).toMatchScreenshot("badge-intents-light");
  });

  it("the four intents match their baseline in dark mode", async () => {
    await renderFixture(<IntentRow />, { dark: true });

    await expect(page.getByTestId("intents")).toMatchScreenshot("badge-intents-dark");
  });
});
