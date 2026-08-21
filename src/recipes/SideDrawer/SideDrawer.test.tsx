import { createTheme } from "@soribashi/core";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { renderWithTheme } from "../../../test/test-utils.tsx";
import { tuiTheme } from "../../theme.ts";
import { SIDEDRAWER_PARTS, SideDrawer } from "./SideDrawer.tsx";

/**
 * Browser tier for the SideDrawer recipe.
 *
 * Conventions inherited from every prior recipe: renders go through
 * `renderWithTheme`; assertions observe rendered behaviour, never emitted CSS
 * text; the one sanctioned structural assertion is
 * `data-part`.
 *
 * THIS RECIPE MERGES TWO mr-board FAMILIES into one side-driven surface
 * (`.tui-cd-overlay`/`.tui-cd` for the right drawer, `.tui-drawer-overlay`/
 * `.tui-drawer` for the left), so the cases below are written to fail if
 * EITHER side regresses toward the other. Anything the two families share is
 * asserted once; everything they differ on (width, which edge carries the
 * border, which shadow, z-index, the left panel's own padding/gap) is asserted
 * per side.
 *
 * WIDTHS ARE ASSERTED AGAINST THE `min()` FORMULA, NOT A FIXED PIXEL COUNT.
 * mr-board's widths are `min(460px, 92vw)` (right) and `min(320px, 85vw)`
 * (left), so the rendered value depends on the runner's viewport. Recomputing
 * the expectation from `window.innerWidth` keeps the assertion exact and real
 * (`getBoundingClientRect()`, actual laid-out geometry) without this tier
 * having to mutate the shared viewport — which the visual tier does, and which
 * would race any test file running beside it. The comparison carries a
 * sub-pixel tolerance because `vw` resolves against the fractional layout
 * viewport while `window.innerWidth` is rounded to whole CSS pixels; a
 * measured 381.875px against a computed 380.88px is that rounding, not a
 * width bug. It is also an OUTER measure on both sides, which is what pins
 * `.root`'s `box-sizing: border-box` (see SideDrawer.module.css for why that
 * declaration is an addition rather than a lift).
 *
 * THE OVERLAY IS CLICKED PROGRAMMATICALLY (`el.click()`) for the reason
 * Modal.test.tsx spells out: a driver click resolves an element's CENTRE, and
 * for the right drawer the panel occupies it.
 */

function overlayOf(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-part="${SIDEDRAWER_PARTS.overlay}"]`);
  if (!el) throw new Error("no drawer overlay rendered");
  return el;
}

function panelOf(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-part="${SIDEDRAWER_PARTS.root}"]`);
  if (!el) throw new Error("no drawer panel rendered");
  return el;
}

/** mr-board's own two width expressions, evaluated against the live viewport. */
function expectedWidth(side: "left" | "right"): number {
  return side === "right"
    ? Math.min(460, window.innerWidth * 0.92)
    : Math.min(320, window.innerWidth * 0.85);
}

/** Asserts a laid-out OUTER width against the `min()` formula, within the
    sub-pixel tolerance the file header explains. */
function expectPanelWidth(panel: HTMLElement, side: "left" | "right"): void {
  const actual = panel.getBoundingClientRect().width;
  expect(
    Math.abs(actual - expectedWidth(side)),
    `${side} drawer laid out at ${actual}px, expected ~${expectedWidth(side)}px`,
  ).toBeLessThan(1.5);
}

const noop = () => {};

describe("SideDrawer (browser)", () => {
  it("renders its children inside a labelled dialog", async () => {
    const screen = await renderWithTheme(
      <SideDrawer side="right" ariaLabel="comment threads" onClose={noop}>
        <div className="tui-cd-head">a head the caller owns</div>
      </SideDrawer>,
    );

    const dialog = screen.getByRole("dialog", { name: "comment threads" });
    await expect.element(dialog).toBeVisible();
    expect(screen.container.textContent).toContain("a head the caller owns");
  });

  it("carries NO aria-modal, matching mr-board (unlike Modal, which does)", async () => {
    // A straight-port pin, not an oversight: mr-board's SideDrawer sets
    // role="dialog" and an aria-label and stops there, while its Modal also
    // sets aria-modal. Adding it here would be a behaviour change to how a
    // screen reader treats the rest of the page while a drawer is open.
    const screen = await renderWithTheme(
      <SideDrawer side="left" ariaLabel="menu" onClose={noop}>
        body
      </SideDrawer>,
    );

    expect(panelOf(screen.container).getAttribute("aria-modal")).toBeNull();
  });

  it("the side prop flips which viewport edge the panel is pinned to", async () => {
    const right = await renderWithTheme(
      <SideDrawer side="right" ariaLabel="right" onClose={noop}>
        body
      </SideDrawer>,
    );
    // `justify-content: flex-end` is what pushes the panel to the right edge.
    expect(getComputedStyle(overlayOf(right.container)).justifyContent).toBe("flex-end");
    // Real geometry, not just the declaration: the panel's right edge sits on
    // the viewport's right edge.
    const rightBox = panelOf(right.container).getBoundingClientRect();
    expect(Math.round(rightBox.right)).toBe(Math.round(window.innerWidth));
    await right.unmount();

    const left = await renderWithTheme(
      <SideDrawer side="left" ariaLabel="left" onClose={noop}>
        body
      </SideDrawer>,
    );
    // mr-board's `.tui-drawer-overlay` sets NO justify-content at all, so the
    // initial value stands — asserted as `normal` rather than `flex-start`
    // precisely because that is what an unset property computes to, and
    // writing `justify-content: flex-start` into the recipe would have been a
    // computed-style change, not a port.
    expect(getComputedStyle(overlayOf(left.container)).justifyContent).toBe("normal");
    const leftBox = panelOf(left.container).getBoundingClientRect();
    expect(Math.round(leftBox.left)).toBe(0);
  });

  it("each side keeps its own width from the census", async () => {
    const right = await renderWithTheme(
      <SideDrawer side="right" ariaLabel="right" onClose={noop}>
        body
      </SideDrawer>,
    );
    expectPanelWidth(panelOf(right.container), "right");
    await right.unmount();

    const left = await renderWithTheme(
      <SideDrawer side="left" ariaLabel="left" onClose={noop}>
        body
      </SideDrawer>,
    );
    expectPanelWidth(panelOf(left.container), "left");
  });

  it("each side borders and shadows the edge it faces, not the other one", async () => {
    const right = await renderWithTheme(
      <SideDrawer side="right" ariaLabel="right" onClose={noop}>
        body
      </SideDrawer>,
    );
    const rightStyle = getComputedStyle(panelOf(right.container));
    expect(rightStyle.borderLeftWidth).toBe("1px");
    expect(rightStyle.borderRightWidth).toBe("0px");
    // `--shadow-drawer`: `-6px 0 32px rgba(0, 0, 0, 0.3)`, throwing left.
    expect(rightStyle.boxShadow).toContain("-6px");
    await right.unmount();

    const left = await renderWithTheme(
      <SideDrawer side="left" ariaLabel="left" onClose={noop}>
        body
      </SideDrawer>,
    );
    const leftStyle = getComputedStyle(panelOf(left.container));
    expect(leftStyle.borderRightWidth).toBe("1px");
    expect(leftStyle.borderLeftWidth).toBe("0px");
    // `--shadow-drawer-left`: `4px 0 28px rgba(0, 0, 0, 0.3)`, throwing right.
    expect(leftStyle.boxShadow).toContain("4px");
    expect(leftStyle.boxShadow).not.toContain("-6px");
  });

  it("keeps the two families' different stacking order (right 100, left 90)", async () => {
    const right = await renderWithTheme(
      <SideDrawer side="right" ariaLabel="right" onClose={noop}>
        body
      </SideDrawer>,
    );
    expect(getComputedStyle(overlayOf(right.container)).zIndex).toBe("100");
    await right.unmount();

    const left = await renderWithTheme(
      <SideDrawer side="left" ariaLabel="left" onClose={noop}>
        body
      </SideDrawer>,
    );
    expect(getComputedStyle(overlayOf(left.container)).zIndex).toBe("90");
  });

  it("only the LEFT panel carries mr-board's own padding and gap", async () => {
    // `.tui-drawer` pads itself (14px) and gaps its children; `.tui-cd` does
    // neither, because its head/body children carry their own padding. This
    // asymmetry is the easiest part of the merge to flatten by accident.
    const left = await renderWithTheme(
      <SideDrawer side="left" ariaLabel="left" onClose={noop}>
        body
      </SideDrawer>,
    );
    const leftStyle = getComputedStyle(panelOf(left.container));
    expect(leftStyle.paddingTop).toBe("14px");
    expect(leftStyle.rowGap).toBe("14px");
    await left.unmount();

    const right = await renderWithTheme(
      <SideDrawer side="right" ariaLabel="right" onClose={noop}>
        body
      </SideDrawer>,
    );
    const rightStyle = getComputedStyle(panelOf(right.container));
    expect(rightStyle.paddingTop).toBe("0px");
    expect(rightStyle.rowGap).toBe("normal");
  });

  it("shows BOTH sides' overlays — the left one's mobile-only gate stays app-side", async () => {
    // mr-board's `.tui-drawer-overlay` is `display: none` until a
    // `max-width: 720px` media query flips it to flex, because ITS left drawer
    // is the burger menu and only exists on mobile. That is a board layout
    // decision, not a property of "a left drawer", so it is deliberately NOT
    // lifted (see SideDrawer.module.css). This case pins that decision: a
    // consumer's left drawer is visible at any width.
    const left = await renderWithTheme(
      <SideDrawer side="left" ariaLabel="left" onClose={noop}>
        body
      </SideDrawer>,
    );
    expect(getComputedStyle(overlayOf(left.container)).display).toBe("flex");
  });

  it("closes on an overlay click", async () => {
    const onClose = vi.fn();
    const screen = await renderWithTheme(
      <SideDrawer side="right" ariaLabel="d" onClose={onClose}>
        body
      </SideDrawer>,
    );

    overlayOf(screen.container).click();

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("onOverlayClick REPLACES onClose on the overlay when given", async () => {
    // CommentsDrawer's case: the drawer renders inside a clickable row, so it
    // needs to stopPropagation before closing. mr-board expresses that as
    // `onClick={onOverlayClick ?? onClose}` — a replacement, not an addition,
    // and this pins that onClose is NOT also called.
    const onClose = vi.fn();
    const onOverlayClick = vi.fn();
    const screen = await renderWithTheme(
      <SideDrawer side="right" ariaLabel="d" onClose={onClose} onOverlayClick={onOverlayClick}>
        body
      </SideDrawer>,
    );

    overlayOf(screen.container).click();

    expect(onOverlayClick).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("an overlay click does not bubble past the drawer when onOverlayClick stops it", async () => {
    // The behaviour CommentsDrawer actually needs, end to end: an ancestor
    // row's own onClick must not fire.
    const rowClick = vi.fn();
    const onClose = vi.fn();
    const screen = await renderWithTheme(
      // A plain div with an onClick is exactly mr-board's own row shape (the
      // whole row opens the MR), which is the ancestor this case exists to
      // prove the drawer's overlay click does not reach.
      <div onClick={rowClick}>
        <SideDrawer
          side="right"
          ariaLabel="d"
          onClose={onClose}
          onOverlayClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          body
        </SideDrawer>
      </div>,
    );

    overlayOf(screen.container).click();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(rowClick).not.toHaveBeenCalled();
  });

  it("does not close on a click inside the panel (the panel stops propagation)", async () => {
    const onClose = vi.fn();
    const screen = await renderWithTheme(
      <SideDrawer side="left" ariaLabel="d" onClose={onClose}>
        <button type="button">an action inside the drawer</button>
      </SideDrawer>,
    );

    await screen.getByRole("button", { name: "an action inside the drawer" }).click();

    expect(onClose).not.toHaveBeenCalled();
  });

  it("Escape closes the drawer, and only the TOP layer when two are stacked", async () => {
    const onCloseLower = vi.fn();
    const onCloseUpper = vi.fn();

    await renderWithTheme(
      <>
        <SideDrawer side="left" ariaLabel="lower drawer" onClose={onCloseLower}>
          lower
        </SideDrawer>
        <SideDrawer side="right" ariaLabel="upper drawer" onClose={onCloseUpper}>
          upper
        </SideDrawer>
      </>,
    );

    await userEvent.keyboard("{Escape}");

    expect(onCloseUpper).toHaveBeenCalledTimes(1);
    expect(onCloseLower).not.toHaveBeenCalled();
  });

  it("locks body scroll while open and restores the previous value on unmount", async () => {
    const before = document.body.style.overflow;

    const screen = await renderWithTheme(
      <SideDrawer side="right" ariaLabel="d" onClose={noop}>
        body
      </SideDrawer>,
    );
    expect(document.body.style.overflow).toBe("hidden");

    await screen.unmount();
    expect(document.body.style.overflow).toBe(before);
  });

  it("stamps a stable data-part and data-side on both slots", async () => {
    const screen = await renderWithTheme(
      <SideDrawer side="right" ariaLabel="d" onClose={noop}>
        body
      </SideDrawer>,
    );

    const overlay = overlayOf(screen.container);
    const panel = panelOf(screen.container);
    expect(overlay.getAttribute("data-part")).toBe("sidedrawer-overlay");
    expect(panel.getAttribute("data-part")).toBe("sidedrawer");
    // `data-side` lands on BOTH, because both carry side-driven rules — the
    // overlay's alignment and stacking, the panel's width/border/shadow.
    expect(overlay.getAttribute("data-side")).toBe("right");
    expect(panel.getAttribute("data-side")).toBe("right");
  });

  it("a consumer-supplied data-part or data-side does not win", async () => {
    const screen = await renderWithTheme(
      <SideDrawer side="left" ariaLabel="d" onClose={noop} data-part="hijacked" data-side="right">
        body
      </SideDrawer>,
    );

    const panel = panelOf(screen.container);
    expect(panel.getAttribute("data-part")).toBe("sidedrawer");
    expect(panel.getAttribute("data-side")).toBe("left");
    expect(screen.container.querySelectorAll('[data-part="hijacked"]')).toHaveLength(0);
    // ...and the CSS that keys on it is unaffected: still a left drawer.
    expect(getComputedStyle(panel).borderRightWidth).toBe("1px");
  });

  it("never hand-emits the vocabulary-axis data attributes", async () => {
    const screen = await renderWithTheme(
      <SideDrawer side="right" ariaLabel="d" onClose={noop}>
        body
      </SideDrawer>,
    );
    const panel = panelOf(screen.container);

    // `side` is a recipe-local prop stamped as `data-side`, NOT a vocabulary
    // variant — tuiTheme's variant axis is ["solid","outline","subtle","ghost"] and
    // has nothing to say about which edge a drawer is pinned to.
    expect(panel.getAttribute("data-variant")).toBeNull();
    expect(panel.getAttribute("data-intent")).toBeNull();
    expect(panel.getAttribute("data-size")).toBeNull();
  });

  it("applies its layered stylesheet to both the overlay and the panel", async () => {
    const screen = await renderWithTheme(
      <SideDrawer side="right" ariaLabel="d" onClose={noop}>
        body
      </SideDrawer>,
    );

    // A <div> defaults to `static` / `visible`; both values below come from
    // the recipe's own stylesheet.
    expect(getComputedStyle(overlayOf(screen.container)).position).toBe("fixed");
    expect(getComputedStyle(panelOf(screen.container)).overflowY).toBe("auto");
  });

  it("accepts universal style props with zero recipe wiring", async () => {
    const screen = await renderWithTheme(
      <SideDrawer side="right" ariaLabel="d" onClose={noop} p="lg">
        body
      </SideDrawer>,
    );

    // tuiTheme's --spacing-lg is 0.7rem, i.e. 11.2px at a 16px root. Landing on
    // the PANEL is part of the contract: `root` is the panel, not the scrim.
    expect(getComputedStyle(panelOf(screen.container)).paddingTop).toBe("11.2px");
  });

  it("extend threads defaultProps (invariant 1 stays load-bearing)", async () => {
    const extended = createTheme({
      extends: tuiTheme,
      components: [SideDrawer.extend({ defaultProps: { side: "left" } })],
    });

    const screen = await renderWithTheme(
      // @ts-expect-error -- `side` is required on the own type; the theme
      // default satisfies it at runtime, which is exactly what this pins.
      <SideDrawer ariaLabel="d" onClose={noop}>
        body
      </SideDrawer>,
      undefined,
      extended,
    );

    // Asserts the RENDERED CONSEQUENCE of the default prop, not that the theme
    // object contains it: the panel really laid out as a left drawer.
    expect(panelOf(screen.container).getAttribute("data-side")).toBe("left");
    expectPanelWidth(panelOf(screen.container), "left");
  });

  it("a stateful caller can close the drawer and reopen it", async () => {
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            open
          </button>
          {open && (
            <SideDrawer side="left" ariaLabel="menu" onClose={() => setOpen(false)}>
              drawer body
            </SideDrawer>
          )}
        </>
      );
    }

    const screen = await renderWithTheme(<Harness />);
    expect(screen.container.textContent).toContain("drawer body");

    await userEvent.keyboard("{Escape}");
    expect(screen.container.textContent).not.toContain("drawer body");
    // The lock released with the last drawer, so the page scrolls again.
    expect(document.body.style.overflow).toBe("");

    await screen.getByRole("button", { name: "open" }).click();
    expect(screen.container.textContent).toContain("drawer body");
    expect(document.body.style.overflow).toBe("hidden");
  });
});
