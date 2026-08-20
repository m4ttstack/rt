import { createTheme } from "@soribashi/core";
import { describe, expect, it } from "vitest";
import { renderWithTheme } from "../../../test/test-utils.tsx";
import { tuiTheme } from "../../theme.ts";
import { CHECK_ICON, COPY_ICON, Icon, ICONS } from "./Icon.tsx";

/**
 * Browser tier for the Icon recipe.
 *
 * Every case renders through `renderWithTheme`, never vitest-browser-react's
 * `render` directly: the helper pairs `registerTheme(tuiTheme)` with a real
 * `<SoribashiProvider>`, and BOTH are silent when missing.
 *
 * Assertions observe rendered behaviour rather than emitted CSS text. The one
 * structural exception is `data-part`, which IS the observable contract — what
 * app-side CSS selects on across the package boundary.
 */

/** The glyph names mr-board's src/client/ui/Icon.tsx shipped, in source order. */
const MR_BOARD_ICON_NAMES = [
  "rows",
  "grid",
  "light",
  "dark",
  "system",
  "menu",
  "close",
  "refresh",
  "people",
  "settings",
];

function svgOf(container: HTMLElement): SVGSVGElement {
  const svg = container.querySelector("svg");
  if (!svg) throw new Error("no <svg> rendered");
  return svg;
}

describe("Icon (browser)", () => {
  it("renders the glyph path inside an svg", async () => {
    const screen = await renderWithTheme(<Icon d={CHECK_ICON} />);
    const svg = svgOf(screen.container);

    expect(svg.tagName.toLowerCase()).toBe("svg");
    expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
    const path = svg.querySelector("path");
    expect(path?.getAttribute("d")).toBe(CHECK_ICON);
    // A real, painted glyph: the path has non-zero rendered geometry rather
    // than merely existing as a node with a `d` attribute.
    expect((path as SVGPathElement).getTotalLength()).toBeGreaterThan(0);
  });

  it("is decorative by default: hidden from the accessibility tree", async () => {
    const screen = await renderWithTheme(<Icon d={CHECK_ICON} />);

    expect(svgOf(screen.container).getAttribute("aria-hidden")).toBe("true");
    // Nothing for a screen reader to land on: no accessible image is exposed.
    expect(screen.container.querySelectorAll('[role="img"]')).toHaveLength(0);
  });

  it("a consumer can promote it to a labelled image", async () => {
    // Props spread AFTER the recipe's own svg defaults, so `aria-hidden` and
    // friends are overridable rather than baked in. Pins that ordering by
    // reading the real accessibility tree, not the attribute.
    const screen = await renderWithTheme(
      <Icon d={CHECK_ICON} role="img" aria-label="Done" aria-hidden={false} />,
    );

    await expect.element(screen.getByRole("img", { name: "Done" })).toBeVisible();
  });

  it("the circle prop adds a circle element alongside the path", async () => {
    const plain = await renderWithTheme(<Icon d={CHECK_ICON} />);
    expect(svgOf(plain.container).querySelectorAll("circle")).toHaveLength(0);

    const circled = await renderWithTheme(<Icon circle d={CHECK_ICON} />);
    const svg = svgOf(circled.container);
    const circle = svg.querySelector("circle");
    expect(circle).not.toBeNull();
    // Painted, not just present: a real bounding box inside the viewBox.
    expect((circle as SVGCircleElement).getBBox().width).toBeGreaterThan(0);
    expect(svg.querySelector("path")?.getAttribute("d")).toBe(CHECK_ICON);
  });

  it("stamps a stable data-part on its root (the kit's cross-boundary hook)", async () => {
    // tui-kit convention, NOT soribashi's: hashed CSS-module class names cannot
    // be selected from mr-board's own stylesheet, so every addressable slot
    // carries a stable `data-part`. Icon is single-slot, so its root stamps the
    // bare lowercased recipe name — the direct replacement for the `svg` in
    // mr-board's `.tui-review svg { … }`.
    const screen = await renderWithTheme(<Icon d={CHECK_ICON} />);

    expect(svgOf(screen.container).getAttribute("data-part")).toBe("icon");
    expect(screen.container.querySelectorAll('[data-part="icon"]')).toHaveLength(1);
  });

  it("a consumer-supplied data-part does not win", async () => {
    // data-part is a CONTRACT between the kit and mr-board's stylesheet, not a
    // consumer-facing prop: it is stamped in the non-overridable tail, AFTER
    // {...rest}. A consumer who passes one (by accident, or by cargo-culting
    // some other attribute) must not be able to sever every app-side
    // `[data-part="icon"]` rule — a failure that would otherwise be silent on
    // both sides of the boundary. Reordering the stamp back in front of
    // {...rest} fails this case.
    const screen = await renderWithTheme(<Icon d={CHECK_ICON} data-part="hijacked" />);
    const svg = svgOf(screen.container);

    expect(svg.getAttribute("data-part")).toBe("icon");
    // ...and the selector app-side CSS actually writes still matches.
    expect(screen.container.querySelectorAll('[data-part="icon"]')).toHaveLength(1);
    expect(screen.container.querySelectorAll('[data-part="hijacked"]')).toHaveLength(0);
  });

  it("never hand-emits the vocabulary-axis data attributes", async () => {
    // getStyles('root') owns data-variant/data-intent/data-size and emits them
    // only for axes the recipe opted into. Icon opts into none, so none may
    // appear — a recipe that hand-stamped them would fail here.
    const screen = await renderWithTheme(<Icon d={CHECK_ICON} />);
    const svg = svgOf(screen.container);

    expect(svg.getAttribute("data-variant")).toBeNull();
    expect(svg.getAttribute("data-intent")).toBeNull();
    expect(svg.getAttribute("data-size")).toBeNull();
  });

  it("applies its layered stylesheet to the rendered element", async () => {
    // Icon.module.css's only declaration, observed as a computed style rather
    // than as an emitted class name: this is what proves the recipe's CSS
    // module is actually reaching the DOM inside @layer soribashi.recipes.
    const screen = await renderWithTheme(<Icon d={CHECK_ICON} />);

    expect(getComputedStyle(svgOf(screen.container)).flexShrink).toBe("0");
  });

  it("takes its colour from the surrounding text (currentColor stroke)", async () => {
    // The whole colour contract of this recipe: no intent axis, no --icon-*
    // vars, just `stroke="currentColor"`. Asserted against a real theme token
    // so the reading also proves the provider/theme wiring resolved.
    const screen = await renderWithTheme(
      <div style={{ color: "var(--accent)" }}>
        <Icon d={CHECK_ICON} />
      </div>,
    );
    const svg = svgOf(screen.container);
    const parent = svg.parentElement as HTMLElement;

    const stroke = getComputedStyle(svg).stroke;
    expect(stroke).toBe(getComputedStyle(parent).color);
    expect(stroke).toMatch(/^rgb/);
  });

  it("accepts universal style props with zero recipe wiring", async () => {
    // Style props arrive from the builder (useStyleProps), not from anything
    // Icon.tsx does — the same free-of-charge surface every recipe gets.
    const screen = await renderWithTheme(<Icon d={CHECK_ICON} m="md" />);

    // tuiTheme's --spacing-md is 0.6rem, i.e. 9.6px at a 16px root.
    expect(getComputedStyle(svgOf(screen.container)).marginTop).toBe("9.6px");
  });

  it("ships mr-board's ICONS record verbatim, every entry rendering a glyph", async () => {
    expect(Object.keys(ICONS)).toEqual(MR_BOARD_ICON_NAMES);

    const screen = await renderWithTheme(
      <div>
        {Object.entries(ICONS).map(([name, node]) => (
          <span key={name} data-testid={`icon-${name}`}>
            {node}
          </span>
        ))}
      </div>,
    );

    const glyph = (name: string) =>
      svgOf(screen.container.querySelector(`[data-testid="icon-${name}"]`) as HTMLElement);

    for (const name of MR_BOARD_ICON_NAMES) {
      const path = glyph(name).querySelector("path") as SVGPathElement;
      expect(path.getTotalLength(), `${name} renders an empty path`).toBeGreaterThan(0);
    }

    // The two entries mr-board built with the `circle` flag keep it.
    expect(glyph("light").querySelector("circle")).not.toBeNull();
    expect(glyph("settings").querySelector("circle")).not.toBeNull();
    expect(glyph("dark").querySelector("circle")).toBeNull();
  });

  it("exports the two standalone path constants as usable glyphs", async () => {
    const screen = await renderWithTheme(
      <div>
        <span data-testid="copy">
          <Icon d={COPY_ICON} />
        </span>
        <span data-testid="check">
          <Icon d={CHECK_ICON} />
        </span>
      </div>,
    );

    const dOf = (testid: string) =>
      svgOf(screen.container.querySelector(`[data-testid="${testid}"]`) as HTMLElement)
        .querySelector("path")
        ?.getAttribute("d");

    expect(dOf("copy")).toBe(COPY_ICON);
    expect(dOf("check")).toBe(CHECK_ICON);
    expect(dOf("copy")).not.toBe(dOf("check"));
  });

  it("extend threads defaultProps (invariant 1 stays load-bearing)", async () => {
    // Recipe.extend() is first-class public API. A theme entry supplying
    // `circle` must reach the render, which is only observable as the circle
    // element actually appearing.
    const extended = createTheme({
      extends: tuiTheme,
      components: [Icon.extend({ defaultProps: { circle: true } })],
    });

    const screen = await renderWithTheme(<Icon d={CHECK_ICON} />, undefined, extended);

    expect(svgOf(screen.container).querySelector("circle")).not.toBeNull();
  });
});
