import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { renderWithTheme } from "../../../test/test-utils.tsx";
import { ICONS } from "../Icon/Icon.tsx";
import { Button } from "./Button.tsx";

/**
 * Visual tier for the Button recipe.
 *
 * BASELINES ARE TRACKED IN GIT — see Icon.visual.test.tsx.
 *
 * THE ANIMATION FREEZE IS INSTALLED HERE, following Chip's precedent: the
 * busy cell embeds a Spinner, whose ring carries a PERPETUAL `animation`
 * (Spinner.module.css). Without the freeze, that cell would be captured at
 * whatever rotation the keyframe happened to be interpolating through at
 * that instant, different on every run.
 */

const NO_MOTION_CLASS = "button-visual-no-motion";

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
  await page.viewport(900, 500);
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
  fontSize: "var(--font-size-md)",
} as const;

const row = { display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.25rem 0" } as const;

const label = { width: "4rem", color: "var(--muted)", fontSize: "var(--font-size-sm)" } as const;

// Column order preserves the PRE-rename fixture layout (`solid, outline,
// subtle, ghost` -> `default, outline, light, subtle`) rather than the
// vocabulary's own declaration order, so a baseline regen changes only cell
// TEXT, never which column a box sits in. `filled` is appended rather than
// interleaved for the same reason.
const VARIANTS = ["default", "outline", "light", "subtle", "filled"] as const;
const INTENTS = ["accent", "bad"] as const;
const SIZES = ["md", "sm", "lg"] as const;

/** variant × intent, at both sizes — one size per row, one variant per cell. */
function ButtonGrid() {
  return (
    <div data-testid="grid" style={surface}>
      {SIZES.map((size) => (
        <div key={size} style={row}>
          <span style={label}>{size}</span>
          {INTENTS.map((intent) =>
            VARIANTS.map((variant) => (
              <Button key={`${intent}-${variant}`} size={size} intent={intent} variant={variant}>
                {intent} {variant}
              </Button>
            )),
          )}
        </div>
      ))}
    </div>
  );
}

/** The three special states the grid above doesn't exercise: busy, iconOnly, disabled. */
function ButtonStates() {
  return (
    <div data-testid="states" style={surface}>
      <div style={row}>
        <Button busy>restarting…</Button>
        <Button iconOnly aria-label="Refresh">
          {ICONS["refresh-cw"]}
        </Button>
        <Button disabled>unavailable</Button>
      </div>
    </div>
  );
}

/** One row per variant, an accent button beside a bad-intent one — only the
    ACCENT button of each row gets hovered before capture (a real pointer can
    only hover one element at a time), so each shot proves that variant's
    hover fill by CONTRAST against its at-rest bad-intent sibling in the same
    frame. `default`'s bad button also shows the red text+border it carries AT
    REST — no hover needed for that part. */
function HoverContrastRow({ variant }: { variant: (typeof VARIANTS)[number] }) {
  return (
    <div data-testid={`hover-${variant}`} style={surface}>
      <div style={row}>
        <Button variant={variant} intent="accent">
          {variant} accent
        </Button>
        <Button variant={variant} intent="bad">
          {variant} bad
        </Button>
      </div>
    </div>
  );
}

describe("Button (visual)", () => {
  it("the variant × intent grid matches its baseline in light mode", async () => {
    await renderFixture(<ButtonGrid />);

    await expect(page.getByTestId("grid")).toMatchScreenshot("button-grid-light");
  });

  it("the variant × intent grid matches its baseline in dark mode", async () => {
    await renderFixture(<ButtonGrid />, { dark: true });

    await expect(page.getByTestId("grid")).toMatchScreenshot("button-grid-dark");
  });

  it("busy / iconOnly / disabled match their baseline in light mode", async () => {
    await renderFixture(<ButtonStates />);

    await expect(page.getByTestId("states")).toMatchScreenshot("button-states-light");
  });

  it("busy / iconOnly / disabled match their baseline in dark mode", async () => {
    await renderFixture(<ButtonStates />, { dark: true });

    await expect(page.getByTestId("states")).toMatchScreenshot("button-states-dark");
  });

  it.each(VARIANTS)("%s's hovered fill matches its baseline in light mode", async (variant) => {
    const screen = await renderFixture(<HoverContrastRow variant={variant} />);

    await screen.getByRole("button", { name: `${variant} accent` }).hover();

    await expect(page.getByTestId(`hover-${variant}`)).toMatchScreenshot(
      `button-hover-${variant}-light`,
    );
  });

  it.each(VARIANTS)("%s's hovered fill matches its baseline in dark mode", async (variant) => {
    const screen = await renderFixture(<HoverContrastRow variant={variant} />, { dark: true });

    await screen.getByRole("button", { name: `${variant} accent` }).hover();

    await expect(page.getByTestId(`hover-${variant}`)).toMatchScreenshot(
      `button-hover-${variant}-dark`,
    );
  });
});
