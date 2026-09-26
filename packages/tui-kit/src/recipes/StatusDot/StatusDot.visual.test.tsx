import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { renderWithTheme } from "../../../test/test-utils.tsx";
import { STATUSDOT_PARTS, StatusDot } from "./StatusDot.tsx";

/**
 * Visual tier for the StatusDot recipe.
 *
 * The card is a portaled, JS-mounted element now (../Tooltip/TooltipCard.tsx),
 * shared with Tooltip's own — see Tooltip.visual.test.tsx's header comment for
 * why the hovered case awaits the card's actual DOM appearance rather than
 * trusting screenshot-retry timing, and why dark mode toggles on
 * `document.body` rather than on the local container.
 */

async function waitForCard(): Promise<void> {
  await expect
    .poll(() => document.querySelector(`[data-part="${STATUSDOT_PARTS.card}"]`), { timeout: 1000 })
    .not.toBeNull();
}

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

/** Mounts into a fresh container, toggling `dark` on `document.body` — see
    Tooltip.visual.test.tsx's `renderFixture` for why. */
async function renderFixture(ui: ReactNode, { dark = false } = {}) {
  await page.viewport(700, 400);
  installNoMotionStyle();
  document.body.classList.toggle("dark", dark);

  const container = document.createElement("div");
  container.classList.add(NO_MOTION_CLASS);
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
    await waitForCard();

    await expect(page.getByTestId("tooltip")).toMatchScreenshot("statusdot-tooltip");
  });
});
