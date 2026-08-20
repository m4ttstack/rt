import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { renderWithTheme } from "../../../test/test-utils.tsx";
import { CHECK_ICON, COPY_ICON, Icon, ICONS } from "./Icon.tsx";

/** deck's glyph set, added after mr-board's in ICONS, in Icon.tsx source order. */
const DECK_ICON_NAMES = [
  "plus",
  "external-link",
  "triangle-alert",
  "circle-check",
  "file-warning",
  "refresh-cw",
  "pencil",
  "trash-2",
  "lock-keyhole",
  "user-round-check",
  "rotate-ccw",
];

/**
 * Visual tier for the Icon recipe.
 *
 * BASELINES ARE TRACKED IN GIT. Unlike soribashi, this kit has no CI, so the
 * platform-suffixed PNG a developer generates IS the baseline; .gitignore
 * re-includes them while still dropping tier-2 failure captures.
 *
 * No animation freeze here, deliberately: Icon.module.css declares neither a
 * transition nor an animation, so there is nothing to interpolate mid-capture.
 */

/** Mounts into a fresh container that already carries `dark` when asked. */
async function renderFixture(ui: ReactNode, { dark = false } = {}) {
  // `locator.screenshot()` clips to the viewport rather than scrolling the
  // element into view, so the viewport is set wide enough for the widest
  // fixture below before anything mounts.
  await page.viewport(700, 500);

  const container = document.createElement("div");
  // Pre-mount, so the very first paint is dark: no post-mount class flip, so
  // no chance of capturing a light frame. `.dark` only sets `color-scheme`
  // (src/generated/theme.css), which is why it works on a plain div rather
  // than needing to be on the document root.
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
  fontSize: "var(--font-size-sm)",
} as const;

const cell = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "0.4rem",
  width: "5rem",
} as const;

/** Every ICONS entry, labelled with the key a consumer indexes it by. */
function IconGrid() {
  return (
    <div data-testid="grid" style={{ ...surface }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", width: "26rem" }}>
        {Object.entries(ICONS).map(([name, glyph]) => (
          <div key={name} style={cell}>
            {glyph}
            <span>{name}</span>
          </div>
        ))}
        {(
          [
            ["COPY_ICON", COPY_ICON],
            ["CHECK_ICON", CHECK_ICON],
          ] as const
        ).map(([name, d]) => (
          <div key={name} style={cell}>
            <Icon d={d} />
            <span>{name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Just the 11 deck glyphs, labelled, for the deck-specific baseline. */
function DeckIconGrid() {
  return (
    <div data-testid="deck-grid" style={{ ...surface }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", width: "26rem" }}>
        {DECK_ICON_NAMES.map((name) => (
          <div key={name} style={cell}>
            {ICONS[name]}
            <span>{name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

describe("Icon (visual)", () => {
  it("the glyph grid matches its baseline in light mode", async () => {
    await renderFixture(<IconGrid />);

    await expect(page.getByTestId("grid")).toMatchScreenshot("icon-grid-light");
  });

  it("deck's glyph set matches its baseline (light only: stroke is currentColor)", async () => {
    await renderFixture(<DeckIconGrid />);

    await expect(page.getByTestId("deck-grid")).toMatchScreenshot("icon-deck-glyphs");
  });

  it("the glyph grid matches its baseline in dark mode", async () => {
    await renderFixture(<IconGrid />, { dark: true });

    await expect(page.getByTestId("grid")).toMatchScreenshot("icon-grid-dark");
  });

  it("currentColor inheritance matches its baseline", async () => {
    // Icon has no intent axis and no --icon-* vars: its entire colour story is
    // `stroke="currentColor"` picking up whatever `color` is in force. Each
    // cell below sets a different alias-contract colour on the WRAPPER, never
    // on the Icon, so the baseline fails if that inheritance ever regresses to
    // a fixed stroke.
    await renderFixture(
      <div data-testid="colours" style={{ ...surface }}>
        <div style={{ display: "flex", gap: "0.75rem" }}>
          {["--fg", "--muted", "--accent", "--green", "--amber", "--red", "--purple", "--cyan"].map(
            (name) => (
              <div key={name} style={{ ...cell, color: `var(${name})`, width: "4rem" }}>
                <Icon d={CHECK_ICON} />
                <span>{name.slice(2)}</span>
              </div>
            ),
          )}
        </div>
      </div>,
    );

    await expect(page.getByTestId("colours")).toMatchScreenshot("icon-currentcolor");
  });
});
