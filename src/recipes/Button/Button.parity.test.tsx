import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { renderWithTheme } from "../../../test/test-utils.tsx";
import { Button, type ButtonProps, BUTTON_PARTS } from "./Button.tsx";

/**
 * THE PIXEL-PARITY ORACLE for the @soribashi/core 0.2.0 variant-vocabulary
 * adoption (mantine-variant-system task 6).
 *
 * Captured with `getComputedStyle` against the PRE-migration hand-rolled
 * Button (variant vocabulary `solid/outline/subtle/ghost`, colours from
 * `tuiIntentResolver` + `Button.tsx`'s own `OUTLINE_HOVER_TINT` /
 * `GHOST_HOVER_TINT` / `SUBTLE_HOVER_TINT` constants) across every
 * variant x intent x scheme combination, at rest and on a REAL pointer hover.
 * This table is the ground truth: after the resolver swap, every cell below
 * must still equal what the DOM renders — a mismatch is a defect in the new
 * `singleShadeVariantColors` wiring or the intent-to-tone mapping, never a
 * new expectation to record (see the brief, step 3).
 *
 * Keyed by the OLD (pre-migration) variant name, permanently — the table
 * itself is never touched by the rename. `RENDER_VARIANT` below is the one
 * thing the migration edits: it maps each old key to whatever variant string
 * makes today's `<Button>` render that same box. Renaming a KEY here instead
 * would silently stop comparing against last-known-good pixels.
 */
const ORACLE: Record<
  string,
  {
    restBg: string;
    restColor: string;
    restBorder: string;
    hoverBg: string;
    hoverColor: string;
    hoverBorder: string;
  }
> = {
  "ghost|accent|dark": { restBg: "rgba(0, 0, 0, 0)", restColor: "rgb(122, 162, 247)", restBorder: "rgba(0, 0, 0, 0)", hoverBg: "color(srgb 0.133333 0.152157 0.219765)", hoverColor: "rgb(122, 162, 247)", hoverBorder: "rgba(0, 0, 0, 0)" },
  "ghost|accent|light": { restBg: "rgba(0, 0, 0, 0)", restColor: "rgb(46, 125, 233)", restBorder: "rgba(0, 0, 0, 0)", hoverBg: "color(srgb 0.798118 0.838745 0.906824)", hoverColor: "rgb(46, 125, 233)", hoverBorder: "rgba(0, 0, 0, 0)" },
  "ghost|bad|dark": { restBg: "rgba(0, 0, 0, 0)", restColor: "rgb(247, 118, 142)", restBorder: "rgba(0, 0, 0, 0)", hoverBg: "color(srgb 0.192157 0.131451 0.170353)", hoverColor: "rgb(247, 118, 142)", hoverBorder: "rgba(0, 0, 0, 0)" },
  "ghost|bad|light": { restBg: "rgba(0, 0, 0, 0)", restColor: "rgb(245, 42, 101)", restBorder: "rgba(0, 0, 0, 0)", hoverBg: "color(srgb 0.891765 0.799686 0.844706)", hoverColor: "rgb(245, 42, 101)", hoverBorder: "rgba(0, 0, 0, 0)" },
  "ghost|cyan|dark": { restBg: "rgba(0, 0, 0, 0)", restColor: "rgb(125, 207, 255)", restBorder: "rgba(0, 0, 0, 0)", hoverBg: "color(srgb 0.134745 0.173333 0.223529)", hoverColor: "rgb(125, 207, 255)", hoverBorder: "rgba(0, 0, 0, 0)" },
  "ghost|cyan|light": { restBg: "rgba(0, 0, 0, 0)", restColor: "rgb(0, 113, 151)", restBorder: "rgba(0, 0, 0, 0)", hoverBg: "color(srgb 0.776471 0.833098 0.868235)", hoverColor: "rgb(0, 113, 151)", hoverBorder: "rgba(0, 0, 0, 0)" },
  "ghost|muted|dark": { restBg: "rgba(0, 0, 0, 0)", restColor: "rgb(126, 134, 173)", restBorder: "rgba(0, 0, 0, 0)", hoverBg: "color(srgb 0.135216 0.13898 0.184941)", hoverColor: "rgb(126, 134, 173)", hoverBorder: "rgba(0, 0, 0, 0)" },
  "ghost|muted|light": { restBg: "rgba(0, 0, 0, 0)", restColor: "rgb(137, 144, 179)", restBorder: "rgba(0, 0, 0, 0)", hoverBg: "color(srgb 0.840941 0.847686 0.881412)", hoverColor: "rgb(137, 144, 179)", hoverBorder: "rgba(0, 0, 0, 0)" },
  "ghost|ok|dark": { restBg: "rgba(0, 0, 0, 0)", restColor: "rgb(158, 206, 106)", restBorder: "rgba(0, 0, 0, 0)", hoverBg: "color(srgb 0.150275 0.172863 0.153412)", hoverColor: "rgb(158, 206, 106)", hoverBorder: "rgba(0, 0, 0, 0)" },
  "ghost|ok|light": { restBg: "rgba(0, 0, 0, 0)", restColor: "rgb(88, 117, 57)", restBorder: "rgba(0, 0, 0, 0)", hoverBg: "color(srgb 0.817882 0.83498 0.824)", hoverColor: "rgb(88, 117, 57)", hoverBorder: "rgba(0, 0, 0, 0)" },
  "ghost|purple|dark": { restBg: "rgba(0, 0, 0, 0)", restColor: "rgb(187, 154, 247)", restBorder: "rgba(0, 0, 0, 0)", hoverBg: "color(srgb 0.163922 0.148392 0.219765)", hoverColor: "rgb(187, 154, 247)", hoverBorder: "rgba(0, 0, 0, 0)" },
  "ghost|purple|light": { restBg: "rgba(0, 0, 0, 0)", restColor: "rgb(120, 71, 189)", restBorder: "rgba(0, 0, 0, 0)", hoverBg: "color(srgb 0.832941 0.813333 0.886118)", hoverColor: "rgb(120, 71, 189)", hoverBorder: "rgba(0, 0, 0, 0)" },
  "ghost|warn|dark": { restBg: "rgba(0, 0, 0, 0)", restColor: "rgb(224, 175, 104)", restBorder: "rgba(0, 0, 0, 0)", hoverBg: "color(srgb 0.181333 0.158275 0.152471)", hoverColor: "rgb(224, 175, 104)", hoverBorder: "rgba(0, 0, 0, 0)" },
  "ghost|warn|light": { restBg: "rgba(0, 0, 0, 0)", restColor: "rgb(140, 108, 62)", restBorder: "rgba(0, 0, 0, 0)", hoverBg: "color(srgb 0.842353 0.830745 0.826353)", hoverColor: "rgb(140, 108, 62)", hoverBorder: "rgba(0, 0, 0, 0)" },
  "outline|accent|dark": { restBg: "rgba(0, 0, 0, 0)", restColor: "rgb(122, 162, 247)", restBorder: "rgb(122, 162, 247)", hoverBg: "color(srgb 0.105882 0.113725 0.160196)", hoverColor: "rgb(122, 162, 247)", hoverBorder: "rgb(122, 162, 247)" },
  "outline|accent|light": { restBg: "rgba(0, 0, 0, 0)", restColor: "rgb(46, 125, 233)", restBorder: "rgb(46, 125, 233)", hoverBg: "color(srgb 0.847255 0.866471 0.906274)", hoverColor: "rgb(46, 125, 233)", hoverBorder: "rgb(46, 125, 233)" },
  "outline|bad|dark": { restBg: "rgba(0, 0, 0, 0)", restColor: "rgb(247, 118, 142)", restBorder: "rgb(247, 118, 142)", hoverBg: "color(srgb 0.130392 0.105098 0.139608)", hoverColor: "rgb(247, 118, 142)", hoverBorder: "rgb(247, 118, 142)" },
  "outline|bad|light": { restBg: "rgba(0, 0, 0, 0)", restColor: "rgb(245, 42, 101)", restBorder: "rgb(245, 42, 101)", hoverBg: "color(srgb 0.886275 0.850196 0.880392)", hoverColor: "rgb(245, 42, 101)", hoverBorder: "rgb(245, 42, 101)" },
  "outline|cyan|dark": { restBg: "rgba(0, 0, 0, 0)", restColor: "rgb(125, 207, 255)", restBorder: "rgb(125, 207, 255)", hoverBg: "color(srgb 0.106471 0.122549 0.161765)", hoverColor: "rgb(125, 207, 255)", hoverBorder: "rgb(125, 207, 255)" },
  "outline|cyan|light": { restBg: "rgba(0, 0, 0, 0)", restColor: "rgb(0, 113, 151)", restBorder: "rgb(0, 113, 151)", hoverBg: "color(srgb 0.838235 0.864118 0.890196)", hoverColor: "rgb(0, 113, 151)", hoverBorder: "rgb(0, 113, 151)" },
  "outline|muted|dark": { restBg: "rgba(0, 0, 0, 0)", restColor: "rgb(126, 134, 173)", restBorder: "rgb(126, 134, 173)", hoverBg: "color(srgb 0.106667 0.108235 0.145686)", hoverColor: "rgb(126, 134, 173)", hoverBorder: "rgb(126, 134, 173)" },
  "outline|muted|light": { restBg: "rgba(0, 0, 0, 0)", restColor: "rgb(137, 144, 179)", restBorder: "rgb(137, 144, 179)", hoverBg: "color(srgb 0.865098 0.870196 0.895686)", hoverColor: "rgb(137, 144, 179)", hoverBorder: "rgb(137, 144, 179)" },
  "outline|ok|dark": { restBg: "rgba(0, 0, 0, 0)", restColor: "rgb(158, 206, 106)", restBorder: "rgb(158, 206, 106)", hoverBg: "color(srgb 0.112941 0.122353 0.132549)", hoverColor: "rgb(158, 206, 106)", hoverBorder: "rgb(158, 206, 106)" },
  "outline|ok|light": { restBg: "rgba(0, 0, 0, 0)", restColor: "rgb(88, 117, 57)", restBorder: "rgb(88, 117, 57)", hoverBg: "color(srgb 0.85549 0.864902 0.871765)", hoverColor: "rgb(88, 117, 57)", hoverBorder: "rgb(88, 117, 57)" },
  "outline|purple|dark": { restBg: "rgba(0, 0, 0, 0)", restColor: "rgb(187, 154, 247)", restBorder: "rgb(187, 154, 247)", hoverBg: "color(srgb 0.118627 0.112157 0.160196)", hoverColor: "rgb(187, 154, 247)", hoverBorder: "rgb(187, 154, 247)" },
  "outline|purple|light": { restBg: "rgba(0, 0, 0, 0)", restColor: "rgb(120, 71, 189)", restBorder: "rgb(120, 71, 189)", hoverBg: "color(srgb 0.861765 0.855882 0.897647)", hoverColor: "rgb(120, 71, 189)", hoverBorder: "rgb(120, 71, 189)" },
  "outline|warn|dark": { restBg: "rgba(0, 0, 0, 0)", restColor: "rgb(224, 175, 104)", restBorder: "rgb(224, 175, 104)", hoverBg: "color(srgb 0.125882 0.116275 0.132157)", hoverColor: "rgb(224, 175, 104)", hoverBorder: "rgb(224, 175, 104)" },
  "outline|warn|light": { restBg: "rgba(0, 0, 0, 0)", restColor: "rgb(140, 108, 62)", restBorder: "rgb(140, 108, 62)", hoverBg: "color(srgb 0.865686 0.863137 0.872745)", hoverColor: "rgb(140, 108, 62)", hoverBorder: "rgb(140, 108, 62)" },
  "solid|accent|dark": { restBg: "rgb(35, 42, 71)", restColor: "rgb(227, 231, 246)", restBorder: "rgb(59, 66, 97)", hoverBg: "rgb(44, 51, 82)", hoverColor: "rgb(227, 231, 246)", hoverBorder: "rgb(59, 66, 97)" },
  "solid|accent|light": { restBg: "rgb(239, 240, 245)", restColor: "rgb(17, 17, 17)", restBorder: "rgb(200, 202, 214)", hoverBg: "rgb(246, 246, 250)", hoverColor: "rgb(17, 17, 17)", hoverBorder: "rgb(200, 202, 214)" },
  "solid|bad|dark": { restBg: "rgb(35, 42, 71)", restColor: "rgb(247, 118, 142)", restBorder: "rgb(247, 118, 142)", hoverBg: "rgb(44, 51, 82)", hoverColor: "rgb(247, 118, 142)", hoverBorder: "rgb(247, 118, 142)" },
  "solid|bad|light": { restBg: "rgb(239, 240, 245)", restColor: "rgb(245, 42, 101)", restBorder: "rgb(245, 42, 101)", hoverBg: "rgb(246, 246, 250)", hoverColor: "rgb(245, 42, 101)", hoverBorder: "rgb(245, 42, 101)" },
  "solid|cyan|dark": { restBg: "rgb(35, 42, 71)", restColor: "rgb(227, 231, 246)", restBorder: "rgb(59, 66, 97)", hoverBg: "rgb(44, 51, 82)", hoverColor: "rgb(227, 231, 246)", hoverBorder: "rgb(59, 66, 97)" },
  "solid|cyan|light": { restBg: "rgb(239, 240, 245)", restColor: "rgb(17, 17, 17)", restBorder: "rgb(200, 202, 214)", hoverBg: "rgb(246, 246, 250)", hoverColor: "rgb(17, 17, 17)", hoverBorder: "rgb(200, 202, 214)" },
  "solid|muted|dark": { restBg: "rgb(35, 42, 71)", restColor: "rgb(227, 231, 246)", restBorder: "rgb(59, 66, 97)", hoverBg: "rgb(44, 51, 82)", hoverColor: "rgb(227, 231, 246)", hoverBorder: "rgb(59, 66, 97)" },
  "solid|muted|light": { restBg: "rgb(239, 240, 245)", restColor: "rgb(17, 17, 17)", restBorder: "rgb(200, 202, 214)", hoverBg: "rgb(246, 246, 250)", hoverColor: "rgb(17, 17, 17)", hoverBorder: "rgb(200, 202, 214)" },
  "solid|ok|dark": { restBg: "rgb(35, 42, 71)", restColor: "rgb(227, 231, 246)", restBorder: "rgb(59, 66, 97)", hoverBg: "rgb(44, 51, 82)", hoverColor: "rgb(227, 231, 246)", hoverBorder: "rgb(59, 66, 97)" },
  "solid|ok|light": { restBg: "rgb(239, 240, 245)", restColor: "rgb(17, 17, 17)", restBorder: "rgb(200, 202, 214)", hoverBg: "rgb(246, 246, 250)", hoverColor: "rgb(17, 17, 17)", hoverBorder: "rgb(200, 202, 214)" },
  "solid|purple|dark": { restBg: "rgb(35, 42, 71)", restColor: "rgb(227, 231, 246)", restBorder: "rgb(59, 66, 97)", hoverBg: "rgb(44, 51, 82)", hoverColor: "rgb(227, 231, 246)", hoverBorder: "rgb(59, 66, 97)" },
  "solid|purple|light": { restBg: "rgb(239, 240, 245)", restColor: "rgb(17, 17, 17)", restBorder: "rgb(200, 202, 214)", hoverBg: "rgb(246, 246, 250)", hoverColor: "rgb(17, 17, 17)", hoverBorder: "rgb(200, 202, 214)" },
  "solid|warn|dark": { restBg: "rgb(35, 42, 71)", restColor: "rgb(227, 231, 246)", restBorder: "rgb(59, 66, 97)", hoverBg: "rgb(44, 51, 82)", hoverColor: "rgb(227, 231, 246)", hoverBorder: "rgb(59, 66, 97)" },
  "solid|warn|light": { restBg: "rgb(239, 240, 245)", restColor: "rgb(17, 17, 17)", restBorder: "rgb(200, 202, 214)", hoverBg: "rgb(246, 246, 250)", hoverColor: "rgb(17, 17, 17)", hoverBorder: "rgb(200, 202, 214)" },
  "subtle|accent|dark": { restBg: "rgb(44, 51, 82)", restColor: "rgb(122, 162, 247)", restBorder: "rgba(0, 0, 0, 0)", hoverBg: "color(srgb 0.209255 0.252235 0.399216)", hoverColor: "rgb(122, 162, 247)", hoverBorder: "rgba(0, 0, 0, 0)" },
  "subtle|accent|light": { restBg: "rgb(246, 246, 250)", restColor: "rgb(46, 125, 233)", restBorder: "rgba(0, 0, 0, 0)", hoverBg: "color(srgb 0.870588 0.907765 0.972392)", hoverColor: "rgb(46, 125, 233)", hoverBorder: "rgba(0, 0, 0, 0)" },
  "subtle|bad|dark": { restBg: "rgb(44, 51, 82)", restColor: "rgb(247, 118, 142)", restBorder: "rgba(0, 0, 0, 0)", hoverBg: "color(srgb 0.268078 0.231529 0.349804)", hoverColor: "rgb(247, 118, 142)", hoverBorder: "rgba(0, 0, 0, 0)" },
  "subtle|bad|light": { restBg: "rgb(246, 246, 250)", restColor: "rgb(245, 42, 101)", restBorder: "rgba(0, 0, 0, 0)", hoverBg: "color(srgb 0.964235 0.868706 0.910275)", hoverColor: "rgb(245, 42, 101)", hoverBorder: "rgba(0, 0, 0, 0)" },
  "subtle|cyan|dark": { restBg: "rgb(44, 51, 82)", restColor: "rgb(125, 207, 255)", restBorder: "rgba(0, 0, 0, 0)", hoverBg: "color(srgb 0.210667 0.273412 0.40298)", hoverColor: "rgb(125, 207, 255)", hoverBorder: "rgba(0, 0, 0, 0)" },
  "subtle|cyan|light": { restBg: "rgb(246, 246, 250)", restColor: "rgb(0, 113, 151)", restBorder: "rgba(0, 0, 0, 0)", hoverBg: "color(srgb 0.848941 0.902118 0.933804)", hoverColor: "rgb(0, 113, 151)", hoverBorder: "rgba(0, 0, 0, 0)" },
  "subtle|muted|dark": { restBg: "rgb(44, 51, 82)", restColor: "rgb(126, 134, 173)", restBorder: "rgba(0, 0, 0, 0)", hoverBg: "color(srgb 0.211137 0.239059 0.364392)", hoverColor: "rgb(126, 134, 173)", hoverBorder: "rgba(0, 0, 0, 0)" },
  "subtle|muted|light": { restBg: "rgb(246, 246, 250)", restColor: "rgb(137, 144, 179)", restBorder: "rgba(0, 0, 0, 0)", hoverBg: "color(srgb 0.913412 0.916706 0.94698)", hoverColor: "rgb(137, 144, 179)", hoverBorder: "rgba(0, 0, 0, 0)" },
  "subtle|ok|dark": { restBg: "rgb(44, 51, 82)", restColor: "rgb(158, 206, 106)", restBorder: "rgba(0, 0, 0, 0)", hoverBg: "color(srgb 0.226196 0.272941 0.332863)", hoverColor: "rgb(158, 206, 106)", hoverBorder: "rgba(0, 0, 0, 0)" },
  "subtle|ok|light": { restBg: "rgb(246, 246, 250)", restColor: "rgb(88, 117, 57)", restBorder: "rgba(0, 0, 0, 0)", hoverBg: "color(srgb 0.890353 0.904 0.889569)", hoverColor: "rgb(88, 117, 57)", hoverBorder: "rgba(0, 0, 0, 0)" },
  "subtle|purple|dark": { restBg: "rgb(44, 51, 82)", restColor: "rgb(187, 154, 247)", restBorder: "rgba(0, 0, 0, 0)", hoverBg: "color(srgb 0.239843 0.248471 0.399216)", hoverColor: "rgb(187, 154, 247)", hoverBorder: "rgba(0, 0, 0, 0)" },
  "subtle|purple|light": { restBg: "rgb(246, 246, 250)", restColor: "rgb(120, 71, 189)", restBorder: "rgba(0, 0, 0, 0)", hoverBg: "color(srgb 0.905412 0.882353 0.951686)", hoverColor: "rgb(120, 71, 189)", hoverBorder: "rgba(0, 0, 0, 0)" },
  "subtle|warn|dark": { restBg: "rgb(44, 51, 82)", restColor: "rgb(224, 175, 104)", restBorder: "rgba(0, 0, 0, 0)", hoverBg: "color(srgb 0.257255 0.258353 0.331922)", hoverColor: "rgb(224, 175, 104)", hoverBorder: "rgba(0, 0, 0, 0)" },
  "subtle|warn|light": { restBg: "rgb(246, 246, 250)", restColor: "rgb(140, 108, 62)", restBorder: "rgba(0, 0, 0, 0)", hoverBg: "color(srgb 0.914824 0.899765 0.891922)", hoverColor: "rgb(140, 108, 62)", hoverBorder: "rgba(0, 0, 0, 0)" },
};

const OLD_VARIANTS = ["solid", "outline", "subtle", "ghost"] as const;
const INTENTS = ["accent", "ok", "warn", "bad", "cyan", "purple", "muted"] as const;
const SCHEMES = ["light", "dark"] as const;

/**
 * The only line this file's rename step may touch: repoints each oracle key
 * to the variant string that renders the SAME box under today's vocabulary.
 * Typed against the component's own prop union so a vocabulary rename that
 * forgets to update this map is a compile error, not a silent mismatch.
 */
const RENDER_VARIANT: Record<(typeof OLD_VARIANTS)[number], NonNullable<ButtonProps["variant"]>> =
  {
    solid: "default",
    outline: "outline",
    subtle: "light",
    ghost: "subtle",
  };

function buttonOf(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-part="${BUTTON_PARTS.root}"]`);
  if (!el) throw new Error("no Button rendered");
  return el;
}

const NO_MOTION_CLASS = "button-parity-no-motion";
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

describe("Button parity oracle — pixel identity across the variant-vocabulary migration", () => {
  it.each(
    SCHEMES.flatMap((scheme) =>
      INTENTS.flatMap((intent) => OLD_VARIANTS.map((oldVariant) => [scheme, intent, oldVariant] as const)),
    ),
  )("%s scheme, intent=%s, variant=%s matches the recorded oracle", async (scheme, intent, oldVariant) => {
    await page.viewport(900, 500);
    installNoMotionStyle();

    // A fresh container's button often lands at the same screen coordinate a
    // PRIOR case's real pointer hover left the cursor at — parking it
    // off-canvas first stops that from contaminating this case's rest read.
    const park = document.querySelector<HTMLElement>('[data-testid="button-parity-park"]') ??
      (() => {
        const el = document.createElement("div");
        el.setAttribute("data-testid", "button-parity-park");
        Object.assign(el.style, { position: "fixed", right: "0", bottom: "0", width: "1px", height: "1px" });
        document.body.appendChild(el);
        return el;
      })();
    await page.getByTestId("button-parity-park").hover();
    void park;

    const container = document.createElement("div");
    container.classList.add(NO_MOTION_CLASS);
    if (scheme === "dark") container.classList.add("dark");
    document.body.appendChild(container);

    const label = `${oldVariant} ${intent} ${scheme}`;
    const variant = RENDER_VARIANT[oldVariant];
    const screen = await renderWithTheme(
      <Button variant={variant} intent={intent}>
        {label}
      </Button>,
      { container },
    );
    const button = buttonOf(screen.container);
    const rest = getComputedStyle(button);
    const oracleKey = `${oldVariant}|${intent}|${scheme}`;
    const expected = ORACLE[oracleKey];
    if (!expected) throw new Error(`no oracle entry for "${oracleKey}"`);

    expect(rest.backgroundColor).toBe(expected.restBg);
    expect(rest.color).toBe(expected.restColor);
    expect(rest.borderTopColor).toBe(expected.restBorder);

    await screen.getByRole("button", { name: label }).hover();
    const hover = getComputedStyle(button);

    expect(hover.backgroundColor).toBe(expected.hoverBg);
    expect(hover.color).toBe(expected.hoverColor);
    expect(hover.borderTopColor).toBe(expected.hoverBorder);

    container.remove();
  });
});
