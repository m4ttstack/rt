import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { renderWithTheme } from "../../../test/test-utils.tsx";
import { Chip } from "./Chip.tsx";

/**
 * Visual tier for the Chip recipe.
 *
 * BASELINES ARE TRACKED IN GIT — see Icon.visual.test.tsx.
 *
 * THE ANIMATION FREEZE IS INSTALLED HERE because Chip.module.css carries a
 * PERPETUAL `animation` (the pulse), and
 * `transition: none` does nothing for an animation — they are separate CSS
 * mechanisms. Without the freeze a pulse cell would be
 * captured at whatever opacity the keyframe happened to be interpolating
 * through at that instant, different on every run. The rule below pins every
 * capture to the animation's resting frame.
 */

const NO_MOTION_CLASS = "chip-visual-no-motion";

/**
 * Installed once per file. Covers descendants too, and sets BOTH properties:
 * `animation` for the pulse, `transition` because a future chip transition
 * would otherwise reintroduce the same flake without anything failing.
 */
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
  // `locator.screenshot()` clips to the viewport rather than scrolling the
  // element into view, so the viewport is set before anything mounts.
  await page.viewport(900, 700);
  installNoMotionStyle();

  const container = document.createElement("div");
  container.classList.add(NO_MOTION_CLASS);
  // Pre-mount, so the very first paint is dark: no post-mount class flip, so
  // no chance of capturing a light frame. `.dark` only sets `color-scheme`
  // (src/generated/theme.css), which is why it works on a plain div.
  if (dark) container.classList.add("dark");
  document.body.appendChild(container);

  const screen = await renderWithTheme(ui, { container });
  // Settle any font swap before capturing, so text metrics are the final ones.
  await document.fonts.ready;
  return screen;
}

const surface = {
  display: "inline-block",
  padding: "1rem",
  background: "var(--panel)",
  color: "var(--fg)",
  fontFamily: "var(--font-mono)",
  fontSize: "var(--font-size-md)",
} as const;

const row = {
  display: "flex",
  alignItems: "center",
  gap: "0.6rem",
  padding: "0.25rem 0",
} as const;

const label = { width: "5.5rem", color: "var(--muted)", fontSize: "var(--font-size-sm)" } as const;

/** Every intent word tuiTheme declares, in vocabulary order. */
const INTENTS = ["accent", "ok", "warn", "bad", "cyan", "purple", "muted"] as const;

/**
 * The full intent x (variant, pulse, button) grid the brief asks for, laid out
 * one intent per row. `pulse` is captured frozen at its resting frame, which is
 * why it looks identical to the plain cell — that is the point: the baseline
 * proves the pulse does not change the chip's resting appearance, and the
 * browser tier is what proves the animation actually runs.
 */
function ChipGrid() {
  return (
    <div data-testid="grid" style={{ ...surface }}>
      {INTENTS.map((intent) => (
        <div key={intent} style={row}>
          <span style={label}>{intent}</span>
          <Chip intent={intent}>outline</Chip>
          <Chip intent={intent} variant="light">
            light
          </Chip>
          <Chip intent={intent} pulse>
            pulse
          </Chip>
          <Chip intent={intent} dimmed>
            dimmed
          </Chip>
          <Chip intent={intent} uppercase>
            caps
          </Chip>
          <Chip intent={intent} as="button">
            button ↗
          </Chip>
          <Chip intent={intent} icon={<span>⇄</span>}>
            icon
          </Chip>
        </div>
      ))}
    </div>
  );
}

/**
 * The board rows the recipe actually replaces, rendered the way mr-board's own
 * row renders them: a horizontal run of chips of mixed intents. Catches
 * alignment regressions the per-intent grid cannot — a chip whose box drifted
 * relative to its neighbours.
 */
function BoardRow() {
  return (
    <div data-testid="board-row" style={{ ...surface }}>
      <div style={{ ...row, gap: "0.4rem" }}>
        <Chip intent="muted" variant="light" dimmed>
          queued
        </Chip>
        <Chip intent="warn" pulse>
          reviewing
        </Chip>
        <Chip intent="ok">approved</Chip>
        <Chip intent="purple" pulse>
          drafting
        </Chip>
        <Chip intent="cyan" pulse>
          fixing
        </Chip>
        <Chip intent="accent" icon={<span>⇄</span>}>
          alice: approved
        </Chip>
        <Chip intent="warn" as="button" icon={<span>✉</span>}>
          held: note
        </Chip>
        <Chip intent="bad">conflicts</Chip>
        <Chip intent="muted" variant="light" uppercase>
          draft
        </Chip>
      </div>
    </div>
  );
}

describe("Chip (visual)", () => {
  it("the intent grid matches its baseline in light mode", async () => {
    await renderFixture(<ChipGrid />);

    await expect(page.getByTestId("grid")).toMatchScreenshot("chip-grid-light");
  });

  it("the intent grid matches its baseline in dark mode", async () => {
    await renderFixture(<ChipGrid />, { dark: true });

    await expect(page.getByTestId("grid")).toMatchScreenshot("chip-grid-dark");
  });

  it("a real board row matches its baseline in light mode", async () => {
    await renderFixture(<BoardRow />);

    await expect(page.getByTestId("board-row")).toMatchScreenshot("chip-board-row-light");
  });

  it("a real board row matches its baseline in dark mode", async () => {
    await renderFixture(<BoardRow />, { dark: true });

    await expect(page.getByTestId("board-row")).toMatchScreenshot("chip-board-row-dark");
  });
});
