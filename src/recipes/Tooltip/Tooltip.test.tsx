import { describe, expect, it } from "vitest";
import { renderWithTheme } from "../../../test/test-utils.tsx";
import { Tooltip, TOOLTIP_PARTS } from "./Tooltip.tsx";

/**
 * Browser tier for the Tooltip recipe.
 *
 * Conventions inherited from StatusDot: every render goes through
 * `renderWithTheme`; assertions observe rendered behaviour (computed styles,
 * real interaction), never emitted CSS text; the one sanctioned structural
 * assertion is `data-part`.
 */

function rootOf(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-part="${TOOLTIP_PARTS.root}"]`);
  if (!el) throw new Error("no Tooltip root rendered");
  return el;
}

describe("Tooltip (browser)", () => {
  it("renders its child inside the wrapper span", async () => {
    const screen = await renderWithTheme(
      <Tooltip tip="hello">
        <button type="button">press</button>
      </Tooltip>,
    );

    await expect.element(screen.getByRole("button", { name: "press" })).toBeVisible();
  });

  it("stamps data-tip and data-part on the root", async () => {
    const screen = await renderWithTheme(<Tooltip tip="pipeline failing">child</Tooltip>);

    const root = rootOf(screen.container);
    expect(root.getAttribute("data-tip")).toBe("pipeline failing");
    expect(root.getAttribute("data-part")).toBe("tooltip");
  });

  it("a consumer-supplied data-part does not win", async () => {
    // data-part is a CONTRACT between the kit and the app's stylesheet, not a
    // consumer-facing prop: stamped in the non-overridable tail, AFTER
    // {...rest}. Same pin as StatusDot.test.tsx.
    const screen = await renderWithTheme(
      <Tooltip tip="x" data-part="hijacked">
        child
      </Tooltip>,
    );

    expect(rootOf(screen.container).getAttribute("data-part")).toBe("tooltip");
    expect(screen.container.querySelectorAll('[data-part="hijacked"]')).toHaveLength(0);
  });

  it("merges a consumer className with the recipe's own", async () => {
    const screen = await renderWithTheme(
      <Tooltip tip="x" className="consumer-class">
        child
      </Tooltip>,
    );

    const root = rootOf(screen.container);
    expect(root.classList.contains("consumer-class")).toBe(true);
    // The recipe's own hashed module class is still present alongside it —
    // proves className is merged, not replaced.
    expect(root.className).not.toBe("consumer-class");
  });

  it("the tooltip is hidden by default and shown on real hover", async () => {
    const screen = await renderWithTheme(
      <Tooltip data-testid="tip" tip="hover me">
        child
      </Tooltip>,
    );
    const root = rootOf(screen.container);

    expect(getComputedStyle(root, "::after").visibility).toBe("hidden");

    // A real pointer hover (vitest-browser's Locator, backed by a real
    // Playwright pointer move), not a synthetic dispatchEvent -- the CSS
    // tooltip is gated behind `:hover`, a real UA pseudo-class no synthetic
    // event can satisfy.
    await screen.getByTestId("tip").hover();

    expect(getComputedStyle(root, "::after").visibility).toBe("visible");
    await expect
      .poll(() => getComputedStyle(root, "::after").opacity, { timeout: 1000 })
      .toBe("1");

    // The real Playwright pointer stays wherever `.hover()` left it, even
    // after this tree unmounts -- restore it so a LATER test's fresh render,
    // laid out at the same page position, isn't accidentally `:hover`ed by a
    // stale cursor before it does anything itself.
    await screen.getByTestId("tip").unhover();
  });

  it("also shows on focus-within, the improvement over StatusDot's hover-only card", async () => {
    const screen = await renderWithTheme(
      <Tooltip tip="keyboard reachable">
        <button type="button">focus me</button>
      </Tooltip>,
    );
    const root = rootOf(screen.container);

    expect(getComputedStyle(root, "::after").visibility).toBe("hidden");

    await screen.getByRole("button", { name: "focus me" }).element().focus();

    expect(getComputedStyle(root, "::after").visibility).toBe("visible");
    await expect
      .poll(() => getComputedStyle(root, "::after").opacity, { timeout: 1000 })
      .toBe("1");
  });

  it("applies its layered stylesheet to the rendered root", async () => {
    const screen = await renderWithTheme(<Tooltip tip="x">child</Tooltip>);

    // `position: relative` is the CSS-less default's opposite (`static`),
    // proving Tooltip.module.css actually reached the DOM.
    expect(getComputedStyle(rootOf(screen.container)).position).toBe("relative");
  });

  it("accepts universal style props with zero recipe wiring", async () => {
    const screen = await renderWithTheme(
      <Tooltip tip="x" m="md">
        child
      </Tooltip>,
    );

    // tuiTheme's --spacing-md is 0.6rem, i.e. 9.6px at a 16px root.
    expect(getComputedStyle(rootOf(screen.container)).marginTop).toBe("9.6px");
  });
});
