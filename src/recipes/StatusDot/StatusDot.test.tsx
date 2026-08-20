import { createTheme } from "@soribashi/core";
import { describe, expect, it } from "vitest";
import { renderWithTheme } from "../../../test/test-utils.tsx";
import { tuiTheme } from "../../theme.ts";
import { STATUSDOT_PARTS, StatusDot } from "./StatusDot.tsx";

/**
 * Browser tier for the StatusDot recipe.
 *
 * Conventions inherited from Icon/Chip/CopyButton/Segmented: every render
 * goes through `renderWithTheme`; assertions observe rendered behaviour
 * (computed styles, the accessibility tree, real interaction), never emitted
 * CSS text (authoring skill § 18); the one sanctioned structural assertion is
 * `data-part`.
 *
 * StatusDot declares NO vocabulary axes. `intent` is a recipe-OWN three-value
 * prop (`'ok' | 'warn' | 'bad'`), mapped DIRECTLY to `--dot-ok`/`--dot-warn`/
 * `--dot-bad` via StatusDot.tsx's own `STATUSDOT_TONES` table in its `vars`
 * resolver -- NOT through `autoVars`/the theme's intent resolver (which would
 * route through `--color-green-500` and friends, mr-board's ORDINARY text
 * greens, not the dot family's own more-saturated palette). So there is
 * nothing to opt into `vocabularyAxes` for, and `data-intent` is never
 * emitted by anything in this file.
 */

function rootOf(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-part="${STATUSDOT_PARTS.root}"]`);
  if (!el) throw new Error("no StatusDot root rendered");
  return el;
}

function dotOf(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-part="${STATUSDOT_PARTS.dot}"]`);
  if (!el) throw new Error("no StatusDot dot glyph rendered");
  return el;
}

describe("StatusDot (browser)", () => {
  it("renders the ● glyph inside the wrap", async () => {
    const screen = await renderWithTheme(<StatusDot intent="ok" />);

    const dot = dotOf(screen.container);
    expect(dot.textContent).toBe("●");
  });

  it("stamps stable data-parts on both slots (the kit's cross-boundary hook)", async () => {
    const screen = await renderWithTheme(<StatusDot intent="warn" />);

    expect(rootOf(screen.container).getAttribute("data-part")).toBe("statusdot");
    expect(dotOf(screen.container).getAttribute("data-part")).toBe("statusdot-dot");
    expect(screen.container.querySelectorAll('[data-part="statusdot"]')).toHaveLength(1);
    expect(screen.container.querySelectorAll('[data-part="statusdot-dot"]')).toHaveLength(1);
  });

  it("a consumer-supplied data-part does not win", async () => {
    // data-part is a CONTRACT between the kit and mr-board's stylesheet, not a
    // consumer-facing prop: stamped in the non-overridable tail, AFTER
    // {...rest}. Same pin as Icon.test.tsx / Chip.test.tsx.
    const screen = await renderWithTheme(<StatusDot intent="ok" data-part="hijacked" />);

    expect(rootOf(screen.container).getAttribute("data-part")).toBe("statusdot");
    expect(screen.container.querySelectorAll('[data-part="hijacked"]')).toHaveLength(0);
  });

  it("never hand-emits the vocabulary-axis data attributes", async () => {
    // getStyles('root') owns data-variant/data-intent/data-size and emits
    // them only for axes the recipe opted into via vocabularyAxes. StatusDot
    // opts into none -- its own `intent` prop is a recipe-local scalar, not
    // the theme's seven-value vocabulary axis -- so none may appear anywhere,
    // on either slot.
    const screen = await renderWithTheme(<StatusDot intent="bad" />);

    for (const el of [rootOf(screen.container), dotOf(screen.container)]) {
      expect(el.getAttribute("data-variant")).toBeNull();
      expect(el.getAttribute("data-intent")).toBeNull();
      expect(el.getAttribute("data-size")).toBeNull();
    }
  });

  it("intent switches the colour var: each tone resolves to its own --dot-* token", async () => {
    // Compared against a plain probe painted with the SAME token, the same
    // shape Icon.test.tsx's currentColor case uses -- proves the dot's colour
    // really is the theme's --dot-ok/--dot-warn/--dot-bad, not merely "some
    // green-ish value".
    const screen = await renderWithTheme(
      <div>
        <span data-testid="probe-ok" style={{ color: "var(--dot-ok)" }} />
        <span data-testid="probe-warn" style={{ color: "var(--dot-warn)" }} />
        <span data-testid="probe-bad" style={{ color: "var(--dot-bad)" }} />
        <StatusDot data-testid="dot-ok" intent="ok" />
        <StatusDot data-testid="dot-warn" intent="warn" />
        <StatusDot data-testid="dot-bad" intent="bad" />
      </div>,
    );

    const probe = (testid: string) =>
      getComputedStyle(
        screen.container.querySelector(`[data-testid="${testid}"]`) as HTMLElement,
      ).color;
    const dotColor = (testid: string) =>
      getComputedStyle(
        (
          screen.container.querySelector(`[data-testid="${testid}"]`) as HTMLElement
        ).querySelector(`[data-part="${STATUSDOT_PARTS.dot}"]`) as HTMLElement,
      ).color;

    expect(dotColor("dot-ok")).toBe(probe("probe-ok"));
    expect(dotColor("dot-warn")).toBe(probe("probe-warn"));
    expect(dotColor("dot-bad")).toBe(probe("probe-bad"));
    // And the three tones are genuinely distinct, not all falling back to one
    // colour.
    expect(new Set([dotColor("dot-ok"), dotColor("dot-warn"), dotColor("dot-bad")]).size).toBe(3);
  });

  it("the tooltip content renders from tip, hidden by default and shown on real hover", async () => {
    const screen = await renderWithTheme(
      <StatusDot data-testid="dot" intent="bad" tip="pipeline failing" />,
    );
    const root = rootOf(screen.container);
    expect(root.getAttribute("data-tip")).toBe("pipeline failing");

    const before = getComputedStyle(root, "::after");
    expect(before.opacity).toBe("0");
    expect(before.visibility).toBe("hidden");

    // A real pointer hover (vitest-browser's Locator, backed by a real
    // Playwright pointer move), not a synthetic dispatchEvent -- the CSS
    // tooltip is gated behind `:hover`, a real UA pseudo-class no synthetic
    // event can satisfy.
    await screen.getByTestId("dot").hover();

    // `visibility` is not a listed `transition` property (only `opacity` is),
    // so it flips the instant `:hover` matches -- the immediate, non-flaky
    // signal that the tooltip is now showing.
    expect(getComputedStyle(root, "::after").visibility).toBe("visible");
    // `opacity` DOES transition, with a 0.15s delay before its own 0.1s
    // run -- polled rather than read synchronously, so this isn't racing the
    // delay.
    await expect.poll(() => getComputedStyle(root, "::after").opacity, { timeout: 1000 }).toBe(
      "1",
    );
  });

  it("without a tip, data-tip is absent and the tooltip never appears", async () => {
    const screen = await renderWithTheme(<StatusDot data-testid="dot" intent="ok" />);
    const root = rootOf(screen.container);

    expect(root.hasAttribute("data-tip")).toBe(false);
  });

  it("applies its layered stylesheet to the rendered elements", async () => {
    const screen = await renderWithTheme(<StatusDot intent="ok" />);

    // .tui-dot's `display: inline-block` (the CSS-less default for a <span>
    // is `inline`), proving StatusDot.module.css actually reached the DOM.
    expect(getComputedStyle(dotOf(screen.container)).display).toBe("inline-block");
  });

  it("a consumer can promote the dot to an announced status", async () => {
    // Band ordering pin, the same shape as Icon's "promote to labelled
    // image": nothing in the overridable head pre-empts a consumer's own
    // aria-label/role passed through {...rest}.
    const screen = await renderWithTheme(
      <StatusDot intent="bad" role="img" aria-label="pipeline failing" />,
    );

    await expect
      .element(screen.getByRole("img", { name: "pipeline failing" }))
      .toBeVisible();
  });

  it("accepts universal style props with zero recipe wiring", async () => {
    const screen = await renderWithTheme(<StatusDot intent="ok" m="md" />);

    // tuiTheme's --spacing-md is 0.6rem, i.e. 9.6px at a 16px root.
    expect(getComputedStyle(rootOf(screen.container)).marginTop).toBe("9.6px");
  });

  it("extend threads defaultProps (invariant 1 stays load-bearing)", async () => {
    const extended = createTheme({
      extends: tuiTheme,
      components: [StatusDot.extend({ defaultProps: { intent: "warn" } })],
    });

    const screen = await renderWithTheme(
      // @ts-expect-error -- `intent` is required on the own type; the theme
      // default satisfies it at runtime, which is exactly what this pins.
      <StatusDot />,
      undefined,
      extended,
    );

    const probe = document.createElement("span");
    probe.style.color = "var(--dot-warn)";
    screen.container.appendChild(probe);

    expect(getComputedStyle(dotOf(screen.container)).color).toBe(getComputedStyle(probe).color);
  });
});
