import { createTheme } from "@soribashi/core";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { renderWithTheme } from "../../../test/test-utils.tsx";
import { tuiTheme } from "../../theme.ts";
import { MODAL_PARTS, Modal } from "./Modal.tsx";

/**
 * Browser tier for the Modal recipe.
 *
 * Conventions inherited from Icon/Chip/CopyButton/Segmented/StatusDot/
 * ToastHost/Panel: every render goes through `renderWithTheme`; assertions
 * observe rendered behaviour, never emitted CSS text;
 * the one sanctioned structural assertion is `data-part`.
 *
 * THREE INTERACTION MECHANICS ARE SPECIFIC TO AN OVERLAY RECIPE and are
 * spelled out here because each one has a wrong-looking-but-correct shape:
 *
 *  1. THE OVERLAY IS CLICKED PROGRAMMATICALLY (`el.click()`), NOT THROUGH THE
 *     DRIVER. A driver click resolves the element's CENTRE, and the modal
 *     frame sits exactly there — a `locator.click()` on the overlay would land
 *     on the frame and prove the opposite of what it claims. `el.click()`
 *     dispatches a real bubbling MouseEvent on the overlay itself, which is
 *     what React's delegated listener sees. The complementary case (a click
 *     INSIDE the frame must not close) uses a genuine driver click on the
 *     title, since there the centre is the element under test.
 *  2. ESCAPE GOES THROUGH `userEvent.keyboard`, a real browser key event
 *     delivered to the focused element (`<body>` by default), which then
 *     bubbles to the `document` listener `useEscapeClose` installs. Nothing
 *     here dispatches a synthetic KeyboardEvent.
 *  3. THE LAYER STACK AND THE SCROLL-LOCK COUNTER ARE MODULE-GLOBAL
 *     (src/hooks/layers.ts, src/hooks/scroll-lock.ts). vitest-browser-react's
 *     automatic per-test cleanup unmounts every rendered tree, which pops the
 *     layers and releases the locks, so no test here has to reset them by
 *     hand — but a test that leaked a mounted modal WOULD poison its
 *     successors, which is why the stacked-modal cases build their own
 *     harness component rather than rendering two trees.
 */

function overlayOf(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-part="${MODAL_PARTS.overlay}"]`);
  if (!el) throw new Error("no modal overlay rendered");
  return el;
}

function frameOf(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-part="${MODAL_PARTS.root}"]`);
  if (!el) throw new Error("no modal frame rendered");
  return el;
}

const noop = () => {};

describe("Modal (browser)", () => {
  it("renders the title, the children, and the dialog semantics", async () => {
    const screen = await renderWithTheme(
      <Modal title="❯ team members" ariaLabel="team settings" onClose={noop}>
        <p>body content</p>
      </Modal>,
    );

    const dialog = screen.getByRole("dialog", { name: "team settings" });
    await expect.element(dialog).toBeVisible();
    expect(frameOf(screen.container).getAttribute("aria-modal")).toBe("true");
    expect(screen.container.textContent).toContain("❯ team members");
    expect(screen.container.textContent).toContain("body content");
  });

  it("closes on a click on the overlay", async () => {
    const onClose = vi.fn();
    const screen = await renderWithTheme(
      <Modal title="t" ariaLabel="m" onClose={onClose}>
        body
      </Modal>,
    );

    overlayOf(screen.container).click();

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close on a click inside the frame (the frame stops propagation)", async () => {
    const onClose = vi.fn();
    const screen = await renderWithTheme(
      <Modal title="a title" ariaLabel="m" onClose={onClose}>
        body
      </Modal>,
    );

    // A real driver click, on an element whose centre IS the target.
    await screen.getByText("a title").click();

    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes from the close button, which is reachable by its accessible name", async () => {
    const onClose = vi.fn();
    const screen = await renderWithTheme(
      <Modal title="t" ariaLabel="m" onClose={onClose}>
        body
      </Modal>,
    );

    await screen.getByRole("button", { name: "close" }).click();

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders ICONS.close by default and a caller's closeGlyph instead when given", async () => {
    const withDefault = await renderWithTheme(
      <Modal title="t" ariaLabel="default glyph" onClose={noop}>
        body
      </Modal>,
    );
    const defaultBtn = withDefault.container.querySelector<HTMLElement>(
      `[data-part="${MODAL_PARTS.close}"]`,
    ) as HTMLElement;
    expect(defaultBtn.querySelector("svg")).not.toBeNull();

    await withDefault.unmount();

    // SettingsModal's literal "✕" — a real visual difference mr-board keeps on
    // purpose (see Modal.tsx's own comment), so it is pinned, not unified away.
    const withGlyph = await renderWithTheme(
      <Modal title="t" ariaLabel="literal glyph" onClose={noop} closeGlyph="✕">
        body
      </Modal>,
    );
    const glyphBtn = withGlyph.container.querySelector<HTMLElement>(
      `[data-part="${MODAL_PARTS.close}"]`,
    ) as HTMLElement;
    expect(glyphBtn.querySelector("svg")).toBeNull();
    expect(glyphBtn.textContent).toBe("✕");
  });

  it("Escape closes exactly the TOP layer when two modals are stacked", async () => {
    const onCloseLower = vi.fn();
    const onCloseUpper = vi.fn();

    await renderWithTheme(
      <>
        <Modal title="lower" ariaLabel="lower modal" onClose={onCloseLower}>
          lower body
        </Modal>
        <Modal title="upper" ariaLabel="upper modal" onClose={onCloseUpper}>
          upper body
        </Modal>
      </>,
    );

    await userEvent.keyboard("{Escape}");

    expect(onCloseUpper).toHaveBeenCalledTimes(1);
    expect(onCloseLower).not.toHaveBeenCalled();
  });

  it("Escape falls through to the lower layer once the top one has unmounted", async () => {
    const onCloseLower = vi.fn();

    function Stack() {
      const [upperOpen, setUpperOpen] = useState(true);
      return (
        <>
          <Modal title="lower" ariaLabel="lower modal" onClose={onCloseLower}>
            lower body
          </Modal>
          {upperOpen && (
            <Modal title="upper" ariaLabel="upper modal" onClose={() => setUpperOpen(false)}>
              upper body
            </Modal>
          )}
        </>
      );
    }

    const screen = await renderWithTheme(<Stack />);

    // First press pops the upper layer only...
    await userEvent.keyboard("{Escape}");
    expect(onCloseLower).not.toHaveBeenCalled();
    expect(screen.container.textContent).not.toContain("upper body");

    // ...and the second now reaches the lower one, proving the stack is LIFO
    // and that the popped registration really left it.
    await userEvent.keyboard("{Escape}");
    expect(onCloseLower).toHaveBeenCalledTimes(1);
  });

  it("locks body scroll while open and restores the previous value on unmount", async () => {
    const before = document.body.style.overflow;

    const screen = await renderWithTheme(
      <Modal title="t" ariaLabel="m" onClose={noop}>
        body
      </Modal>,
    );
    expect(document.body.style.overflow).toBe("hidden");

    await screen.unmount();
    expect(document.body.style.overflow).toBe(before);
  });

  it("keeps the body locked until the LAST of two stacked modals unmounts", async () => {
    function Stack() {
      const [upperOpen, setUpperOpen] = useState(true);
      return (
        <>
          <Modal title="lower" ariaLabel="lower modal" onClose={noop}>
            lower body
          </Modal>
          {upperOpen && (
            <Modal title="upper" ariaLabel="upper modal" onClose={() => setUpperOpen(false)}>
              upper body
            </Modal>
          )}
        </>
      );
    }

    const screen = await renderWithTheme(<Stack />);
    expect(document.body.style.overflow).toBe("hidden");

    await userEvent.keyboard("{Escape}");
    // One of two lockers released; the counter is still 1, so the page must
    // stay locked (scroll-lock.ts's whole reason for being counter-based).
    expect(document.body.style.overflow).toBe("hidden");

    await screen.unmount();
    expect(document.body.style.overflow).toBe("");
  });

  it("stamps a stable data-part on every slot", async () => {
    const screen = await renderWithTheme(
      <Modal title="t" ariaLabel="m" onClose={noop}>
        body
      </Modal>,
    );

    // Literals, not MODAL_PARTS references: the point of this case is that
    // the CONTRACT's values are what they are, so reading them out of the
    // constant under test would make it vacuous.
    expect(overlayOf(screen.container).getAttribute("data-part")).toBe("modal-overlay");
    expect(frameOf(screen.container).getAttribute("data-part")).toBe("modal");
    for (const part of ["modal-head", "modal-title", "modal-close"]) {
      expect(screen.container.querySelectorAll(`[data-part="${part}"]`)).toHaveLength(1);
    }
  });

  it("a consumer-supplied data-part does not win", async () => {
    const screen = await renderWithTheme(
      <Modal title="t" ariaLabel="m" onClose={noop} data-part="hijacked">
        body
      </Modal>,
    );

    expect(frameOf(screen.container).getAttribute("data-part")).toBe("modal");
    expect(screen.container.querySelectorAll('[data-part="hijacked"]')).toHaveLength(0);
  });

  it("never hand-emits the vocabulary-axis data attributes", async () => {
    const screen = await renderWithTheme(
      <Modal title="t" ariaLabel="m" onClose={noop}>
        body
      </Modal>,
    );
    const frame = frameOf(screen.container);

    expect(frame.getAttribute("data-variant")).toBeNull();
    expect(frame.getAttribute("data-intent")).toBeNull();
    expect(frame.getAttribute("data-size")).toBeNull();
  });

  it("applies its layered stylesheet to both the overlay and the frame", async () => {
    const screen = await renderWithTheme(
      <Modal title="t" ariaLabel="m" onClose={noop}>
        body
      </Modal>,
    );

    // `.tui-modal-overlay`'s fixed scrim (a <div> defaults to `static`)...
    expect(getComputedStyle(overlayOf(screen.container)).position).toBe("fixed");
    // ...and `.tui-modal`'s own cap + radius, neither of which a bare <div> has.
    const frameStyle = getComputedStyle(frameOf(screen.container));
    expect(frameStyle.maxWidth).toBe("420px");
    expect(frameStyle.borderRadius).toBe("10px");
    expect(frameStyle.overflowY).toBe("auto");
  });

  it("the frame's declared width is an OUTER measure, so it never overflows the scrim", async () => {
    // mr-board's `.tui-modal` is `width: 100%` inside an overlay that pads
    // itself `8vh 1rem`, and relies on a GLOBAL `* { box-sizing: border-box }`
    // reset for that 100% to mean the outer box. This kit's copy of that reset
    // is in the OPTIONAL `src/canvas.css`, so the recipe declares the
    // box-sizing itself — without it the frame's own ~35px of padding and
    // border push it past the overlay's content box. Asserted as real
    // geometry: the frame fills exactly the overlay minus its 1rem gutters.
    const screen = await renderWithTheme(
      <Modal title="t" ariaLabel="m" onClose={noop}>
        body
      </Modal>,
    );

    const overlayBox = overlayOf(screen.container).getBoundingClientRect();
    const frameBox = frameOf(screen.container).getBoundingClientRect();
    const cap = 420;
    const expected = Math.min(cap, overlayBox.width - 32);
    expect(Math.abs(frameBox.width - expected)).toBeLessThan(1.5);
  });

  it("routes className to the FRAME and overlayClassName to the OVERLAY (mr-board parity)", async () => {
    // ReviewModal passes both, and each one has to land where mr-board's own
    // `.tui-review-modal` / `.tui-review-overlay` rules expect it.
    const screen = await renderWithTheme(
      <Modal
        title="t"
        ariaLabel="m"
        onClose={noop}
        className="tui-review-modal"
        overlayClassName="tui-review-overlay"
      >
        body
      </Modal>,
    );

    expect(frameOf(screen.container).classList.contains("tui-review-modal")).toBe(true);
    expect(frameOf(screen.container).classList.contains("tui-review-overlay")).toBe(false);
    expect(overlayOf(screen.container).classList.contains("tui-review-overlay")).toBe(true);
  });

  it("accepts universal style props with zero recipe wiring", async () => {
    const screen = await renderWithTheme(
      <Modal title="t" ariaLabel="m" onClose={noop} p="lg">
        body
      </Modal>,
    );

    // tuiTheme's --spacing-lg is 0.7rem, i.e. 11.2px at a 16px root. Landing on
    // the FRAME is itself part of the contract: `root` is the frame, not the
    // overlay, so a style prop dresses the dialog box, not the scrim.
    expect(getComputedStyle(frameOf(screen.container)).paddingTop).toBe("11.2px");
  });

  it("extend threads defaultProps (invariant 1 stays load-bearing)", async () => {
    const extended = createTheme({
      extends: tuiTheme,
      components: [Modal.extend({ defaultProps: { ariaLabel: "themed label" } })],
    });

    const screen = await renderWithTheme(
      // @ts-expect-error -- `ariaLabel` is required on the own type; the theme
      // default satisfies it at runtime, which is exactly what this pins.
      <Modal title="t" onClose={noop}>
        body
      </Modal>,
      undefined,
      extended,
    );

    await expect.element(screen.getByRole("dialog", { name: "themed label" })).toBeVisible();
  });
});
