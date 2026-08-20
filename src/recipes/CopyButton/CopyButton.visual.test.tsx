import { act, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { renderWithTheme } from "../../../test/test-utils.tsx";
import { CopyButton } from "./CopyButton.tsx";

/**
 * Visual tier for the CopyButton recipe.
 *
 * BASELINES ARE TRACKED IN GIT (`__screenshots__/CopyButton.visual.test.tsx/*.png`),
 * the spec's declared divergence from soribashi — see Icon.visual.test.tsx's
 * comment for the full rationale.
 *
 * NO TRANSITION/ANIMATION FREEZE IS INSTALLED HERE. `.tui-copy` declares
 * neither in mr-board's source (unlike Chip's pulse), so CopyButton.module.css
 * declares neither either, and there is nothing to interpolate mid-capture.
 *
 * The copied state (`data-copied`) is exercised by MOUNTING the button
 * pre-copied via `defaultProps`... except `copied` is internal timer state,
 * not a prop, so instead this fixture renders the SAME visual outcome by
 * mounting under fake timers and firing the click before the screenshot,
 * with a stubbed clipboard the same way the browser tier stubs it.
 */

/** Stubs `navigator.clipboard.writeText`; returns a restore function. */
function stubClipboard() {
  const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: () => Promise.resolve() },
    configurable: true,
  });
  return () => {
    if (original) Object.defineProperty(navigator, "clipboard", original);
    else delete (navigator as { clipboard?: unknown }).clipboard;
  };
}

/** Mounts into a fresh container that already carries `dark` when asked. */
async function renderFixture(ui: ReactNode, { dark = false } = {}) {
  await page.viewport(500, 300);

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

function CopyButtonGrid() {
  return (
    <div data-testid="grid" style={{ ...surface }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <div style={row}>
          <span>icon only</span>
          <CopyButton text="mr-board/mr!42" title="copy link" />
        </div>
        <div style={row}>
          <span>with label</span>
          <CopyButton text="mr-board/mr!42" title="copy link" label="copy link" />
        </div>
      </div>
    </div>
  );
}

describe("CopyButton (visual)", () => {
  it("the resting-state grid matches its baseline in light mode", async () => {
    const restore = stubClipboard();
    try {
      await renderFixture(<CopyButtonGrid />);
      await expect(page.getByTestId("grid")).toMatchScreenshot("copybutton-grid-light");
    } finally {
      restore();
    }
  });

  it("the resting-state grid matches its baseline in dark mode", async () => {
    const restore = stubClipboard();
    try {
      await renderFixture(<CopyButtonGrid />, { dark: true });
      await expect(page.getByTestId("grid")).toMatchScreenshot("copybutton-grid-dark");
    } finally {
      restore();
    }
  });

  it("the copied flash matches its baseline (icon-only and labelled forms)", async () => {
    const restore = stubClipboard();
    try {
      await renderFixture(<CopyButtonGrid />);

      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        // `act()`-wrapped for the same reason CopyButton.test.tsx's `advance`
        // helper is: a native `.click()` dispatched in-page (not through a
        // real Playwright/CDP round trip) gives React's scheduler no macrotask
        // boundary to flush against on its own.
        await act(async () => {
          for (const button of Array.from(document.querySelectorAll("button"))) {
            button.click();
          }
          await vi.advanceTimersByTimeAsync(0);
        });
        await expect(page.getByTestId("grid")).toMatchScreenshot("copybutton-grid-copied");
      } finally {
        vi.useRealTimers();
      }
    } finally {
      restore();
    }
  });
});
