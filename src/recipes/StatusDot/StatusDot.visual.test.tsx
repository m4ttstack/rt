import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { renderWithTheme } from "../../../test/test-utils.tsx";
import { StatusDot } from "./StatusDot.tsx";

/**
 * Visual tier for the StatusDot recipe.
 *
 *  * THE ANIMATION FREEZE IS INSTALLED HERE, following Chip's precedent:
 * StatusDot.module.css's tooltip carries a real `transition` (opacity, with a
 * delay), so a capture mid-fade would be non-deterministic between runs.
 * `transition: none` is exactly what closes that gap here (unlike Chip's
 * pulse, there is no perpetual `animation` to also freeze).
 */

const NO_MOTION_CLASS = "statusdot-visual-no-motion";

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

const row = { display: "flex", alignItems: "center", gap: "1.5rem" } as const;
const cell = { display: "flex", alignItems: "center", gap: "0.4rem" } as const;

/** The three tones, each labelled, resting (no hover). */
function ToneRow() {
  return (
    <div data-testid="tones" style={surface}>
      <div style={row}>
        {(["ok", "warn", "bad"] as const).map((intent) => (
          <span key={intent} style={cell}>
            <StatusDot intent={intent} tip={`${intent} status`} />
            {intent}
          </span>
        ))}
      </div>
    </div>
  );
}

describe("StatusDot (visual)", () => {
  it("the three tones match their baseline in light mode", async () => {
    await renderFixture(<ToneRow />);

    await expect(page.getByTestId("tones")).toMatchScreenshot("statusdot-tones-light");
  });

  it("the three tones match their baseline in dark mode", async () => {
    await renderFixture(<ToneRow />, { dark: true });

    await expect(page.getByTestId("tones")).toMatchScreenshot("statusdot-tones-dark");
  });

  it("the hovered tooltip matches its baseline", async () => {
    await renderFixture(
      <div
        data-testid="tooltip"
        style={{ ...surface, display: "block", width: "22rem", paddingBottom: "6rem" }}
      >
        <StatusDot
          data-testid="dot"
          intent="bad"
          tip={"pipeline failing\nconflicts + red pipeline"}
        />
      </div>,
    );

    await page.getByTestId("dot").hover();

    await expect(page.getByTestId("tooltip")).toMatchScreenshot("statusdot-tooltip");
  });
});
