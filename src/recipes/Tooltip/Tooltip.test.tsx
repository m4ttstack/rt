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
 *
 * The card is a real portaled element now (TooltipCard.tsx), not a CSS
 * `::after` — every assertion here reads `document.body`, not the render
 * container, since that is where `createPortal` actually lands it.
 */

function rootOf(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-part="${TOOLTIP_PARTS.root}"]`);
  if (!el) throw new Error("no Tooltip root rendered");
  return el;
}

function cardInBody(): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-part="${TOOLTIP_PARTS.card}"]`);
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

  it("the card is absent from the DOM entirely while hidden, not merely invisible", async () => {
    // The old `::after` stayed laid out at all times (opacity 0, visibility
    // hidden); the portaled card is unmounted instead — the fix for the
    // ancestor scrollHeight inflation this same file's overflow test below
    // pins directly.
    await renderWithTheme(
      <Tooltip data-testid="tip" tip="hover me">
        child
      </Tooltip>,
    );

    expect(cardInBody()).toBeNull();
  });

  it("the card appears in document.body on real hover, after the show delay, and hides immediately on leave", async () => {
    const screen = await renderWithTheme(
      <Tooltip data-testid="tip" tip="hover me">
        child
      </Tooltip>,
    );

    // A real pointer hover (vitest-browser's Locator, backed by a real
    // Playwright pointer move), not a synthetic dispatchEvent.
    await screen.getByTestId("tip").hover();

    // Still gone right after the hover lands — proves the show delay is real,
    // not a same-tick reveal.
    expect(cardInBody()).toBeNull();

    await expect.poll(() => cardInBody()?.textContent, { timeout: 1000 }).toBe("hover me");
    const card = cardInBody();
    expect(card).not.toBeNull();
    expect(card?.getAttribute("aria-hidden")).toBe("true");

    await screen.getByTestId("tip").unhover();
    await expect.poll(() => cardInBody(), { timeout: 500 }).toBeNull();
  });

  it("also shows on focus-within, the improvement over StatusDot's hover-only card", async () => {
    const screen = await renderWithTheme(
      <Tooltip tip="keyboard reachable">
        <button type="button">focus me</button>
      </Tooltip>,
    );

    expect(cardInBody()).toBeNull();

    await screen.getByRole("button", { name: "focus me" }).element().focus();

    await expect.poll(() => cardInBody()?.textContent, { timeout: 1000 }).toBe("keyboard reachable");

    (screen.getByRole("button", { name: "focus me" }).element() as HTMLElement).blur();
    await expect.poll(() => cardInBody(), { timeout: 500 }).toBeNull();
  });

  it("the shown card is positioned below and left-aligned to the trigger", async () => {
    const screen = await renderWithTheme(
      <Tooltip data-testid="tip" tip="positioned">
        child
      </Tooltip>,
    );

    await screen.getByTestId("tip").hover();
    await expect.poll(() => cardInBody(), { timeout: 1000 }).not.toBeNull();

    const trigger = rootOf(screen.container);
    const triggerRect = trigger.getBoundingClientRect();
    const cardRect = cardInBody()!.getBoundingClientRect();

    expect(cardRect.left).toBe(triggerRect.left);
    expect(cardRect.top).toBeGreaterThan(triggerRect.bottom);
    // The gap is `--sb-tooltip-gap` (0.15rem, 2.4px at the 16px test root) —
    // small on purpose (Tooltip.tsx's own doc comment), so this pins it as a
    // bounded gap rather than an exact float that would be brittle against
    // sub-pixel rounding.
    expect(cardRect.top - triggerRect.bottom).toBeGreaterThan(0);
    expect(cardRect.top - triggerRect.bottom).toBeLessThan(8);

    await screen.getByTestId("tip").unhover();
  });

  it("clamps the card's left edge so it never overflows the right viewport edge", async () => {
    const screen = await renderWithTheme(
      <div style={{ position: "fixed", top: 0, right: 0 }}>
        <Tooltip data-testid="tip" tip={"a much longer tip line that pushes the card wide\nsecond line"}>
          child
        </Tooltip>
      </div>,
    );

    await screen.getByTestId("tip").hover();
    await expect.poll(() => cardInBody(), { timeout: 1000 }).not.toBeNull();

    const cardRect = cardInBody()!.getBoundingClientRect();
    expect(cardRect.right).toBeLessThanOrEqual(window.innerWidth);

    await screen.getByTestId("tip").unhover();
  });

  it("closes on window scroll while shown", async () => {
    const screen = await renderWithTheme(
      <div style={{ height: "200vh" }}>
        <Tooltip data-testid="tip" tip="scroll closes me">
          child
        </Tooltip>
      </div>,
    );

    await screen.getByTestId("tip").hover();
    await expect.poll(() => cardInBody(), { timeout: 1000 }).not.toBeNull();

    window.scrollTo(0, 100);
    window.dispatchEvent(new Event("scroll"));

    await expect.poll(() => cardInBody(), { timeout: 500 }).toBeNull();

    window.scrollTo(0, 0);
    await screen.getByTestId("tip").unhover();
  });

  it("a Tooltip inside an overflow-x: auto container adds zero scrollable overflow when hidden, and the shown card is not clipped by that container", async () => {
    const container = document.createElement("div");
    container.setAttribute("data-testid", "scroller");
    container.style.cssText = "overflow-x:auto;overflow-y:hidden;width:120px;height:32px;position:relative;";
    document.body.appendChild(container);

    const inner = document.createElement("div");
    inner.style.cssText = "width:400px;display:flex;align-items:center;height:32px;";
    container.appendChild(inner);

    const screen = await renderWithTheme(
      <Tooltip data-testid="tip" tip="clipped no more">
        <button type="button">near the edge</button>
      </Tooltip>,
      { container: inner },
    );

    // Hidden: the container's scrollable area is exactly its content width —
    // no hidden card inflates it, unlike the old always-laid-out `::after`.
    expect(container.scrollHeight).toBe(container.clientHeight);

    await screen.getByTestId("tip").hover();
    await expect.poll(() => cardInBody(), { timeout: 1000 }).not.toBeNull();

    const containerRect = container.getBoundingClientRect();
    const cardRect = cardInBody()!.getBoundingClientRect();

    // Not clipped by the scroller: the card's own box extends below the
    // scroller's bottom edge, which a clipped `position: fixed` descendant
    // (the reverted CSS-only attempt) could never do.
    expect(cardRect.bottom).toBeGreaterThan(containerRect.bottom);

    await screen.getByTestId("tip").unhover();
    await expect.poll(() => cardInBody(), { timeout: 500 }).toBeNull();
    document.body.removeChild(container);
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
