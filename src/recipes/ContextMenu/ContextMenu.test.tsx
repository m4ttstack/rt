import { createTheme } from "@soribashi/core";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { renderWithTheme } from "../../../test/test-utils.tsx";
import { tuiTheme } from "../../theme.ts";
import { CONTEXTMENU_PARTS, ContextMenu } from "./ContextMenu.tsx";

/**
 * Browser tier for the ContextMenu recipe — the kit's ONLY `defineCompound`.
 *
 * Each render goes through
 * `renderWithTheme`; assertions observe rendered behaviour, never emitted CSS
 * text; the one sanctioned structural assertion is
 * `data-part`.
 *
 * FOUR MECHANICS ARE SPECIFIC TO A CURSOR-ANCHORED MENU and each has a
 * wrong-looking-but-correct shape, so they are spelled out once here:
 *
 *  1. THE CLAMP IS ASSERTED AS REAL GEOMETRY, not as the `left`/`top` inline
 *     style strings. `getBoundingClientRect()` is what the user sees; the
 *     inline style is an implementation detail that happens to agree today.
 *     The requested point is deliberately pushed FAR outside the viewport
 *     (`innerWidth + 400`) so a recipe that forgot to clamp would fail by a
 *     mile rather than by a rounding error.
 *  2. DISMISSAL EVENTS ARE DISPATCHED, NOT DRIVEN. `mousedown` on `<body>`,
 *     `scroll`/`resize` on `window`: a driver click resolves an element's
 *     centre, and the menu is `position: fixed` over exactly that region, so
 *     `userEvent.click(document.body)` would land ON the menu and prove the
 *     opposite of what it claims. Escape is the exception — it goes through
 *     `userEvent.keyboard`, a real key event to the focused element, which
 *     bubbles to the `document` listener `useEscapeClose` installs.
 *  3. A DISABLED ITEM IS CLICKED PROGRAMMATICALLY (`el.click()`). Playwright's
 *     actionability check makes a driver click on a disabled control hang
 *     until it times out; `HTMLElement.click()` on a disabled form control is
 *     a defined no-op (the activation behaviour returns early), which is
 *     exactly the browser behaviour the `disabled` prop is claiming.
 *  4. THE LAYER STACK IS MODULE-GLOBAL (src/hooks/layers.ts).
 *     vitest-browser-react's per-test cleanup unmounts every tree, which pops
 *     the registration, so no test resets it by hand.
 */

const noop = () => {};

function rootOf(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-part="${CONTEXTMENU_PARTS.root}"]`);
  if (!el) throw new Error("no context menu rendered");
  return el;
}

/** Every element in this render carrying `data-part="<part>"`. Scoped to the
    render's own container, never `document`, so a leaked tree from a previous
    test can never make one of these rows pass or fail by accident. */
function partsIn(container: HTMLElement, part: string): NodeListOf<HTMLElement> {
  return container.querySelectorAll<HTMLElement>(`[data-part="${part}"]`);
}

/** The viewport margin the recipe clamps to, as a literal — reading it out of
    the recipe would make every clamp assertion below vacuous. */
const MARGIN = 8;

/**
 * The element's box AFTER its entry animation has finished.
 *
 * This is load-bearing, not defensive. `contextmenu-in` opens on
 * `scale(0.97) translateY(-2px)`, and `getBoundingClientRect()` reports the
 * TRANSFORMED box — so a rect read while the animation is in flight is ~3%
 * narrow and 3px off, and `getComputedStyle(...).opacity` reads the
 * animation's `0`, not the element's own value. Waiting for
 * `Animation.finished` makes every geometry row below assert the box the user
 * ends up looking at, which is also what makes them able to fail: the recipe
 * measures with `offsetWidth`/`offsetHeight` precisely so the SETTLED box fits
 * inside the margin, and a `getBoundingClientRect()` measure (mr-board's own)
 * overhangs it by ~6px and fails here.
 */
async function settledBox(el: HTMLElement): Promise<DOMRect> {
  await Promise.all(el.getAnimations().map((a) => a.finished.catch(() => undefined)));
  return el.getBoundingClientRect();
}

describe("ContextMenu (browser)", () => {
  it("renders a labelled menu whose items are menuitems", async () => {
    const screen = await renderWithTheme(
      <ContextMenu x={40} y={40} ariaLabel="actions for !42" onClose={noop}>
        <ContextMenu.Label>!42</ContextMenu.Label>
        <ContextMenu.Item label="open in gitlab" onClick={noop} />
        <ContextMenu.Item label="copy for slack" onClick={noop} />
      </ContextMenu>,
    );

    await expect.element(screen.getByRole("menu", { name: "actions for !42" })).toBeVisible();
    await expect.element(screen.getByRole("menuitem", { name: "open in gitlab" })).toBeVisible();
    expect(screen.container.textContent).toContain("!42");
  });

  it("an item fires its onClick, and does NOT close the menu by itself", async () => {
    // mr-board's Slack-mark items stay open so several marks can be set in one
    // visit; closing is the CALLER's decision (RowMenu's own `run()` helper).
    const onClick = vi.fn();
    const onClose = vi.fn();
    const screen = await renderWithTheme(
      <ContextMenu x={40} y={40} ariaLabel="m" onClose={onClose}>
        <ContextMenu.Item label="mark reviewed on slack" onClick={onClick} />
      </ContextMenu>,
    );

    await screen.getByRole("menuitem", { name: "mark reviewed on slack" }).click();

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("a disabled item is disabled in the DOM and does not fire", async () => {
    const onClick = vi.fn();
    const screen = await renderWithTheme(
      <ContextMenu x={40} y={40} ariaLabel="m" onClose={noop}>
        <ContextMenu.Item label="mark reviewed on slack" disabled onClick={onClick} />
      </ContextMenu>,
    );

    const item = rootOf(screen.container).querySelector<HTMLButtonElement>("button") as HTMLButtonElement;
    expect(item.disabled).toBe(true);
    item.click();

    expect(onClick).not.toHaveBeenCalled();
  });

  it("renders `hint` as its own slot, and lets `trailing` replace it", async () => {
    // RowMenu's two item shapes: a plain right-hand hint ("herdr", "gitlab",
    // "peer"), and an arbitrary trailing node (the ✓ mark / the spinner).
    const screen = await renderWithTheme(
      <ContextMenu x={40} y={40} ariaLabel="m" onClose={noop}>
        <ContextMenu.Item label="review" hint="herdr" onClick={noop} />
        <ContextMenu.Item
          label="unmark ✅ on slack"
          hint="ignored"
          trailing={<span data-testid="check">✓</span>}
          onClick={noop}
        />
      </ContextMenu>,
    );

    const hints = partsIn(screen.container, CONTEXTMENU_PARTS.hint);
    expect(hints).toHaveLength(1);
    expect(hints[0]?.textContent).toBe("herdr");
    expect(screen.container.textContent).not.toContain("ignored");
    await expect.element(screen.getByTestId("check")).toBeVisible();
  });

  it("clamps a point beyond the right/bottom edge back inside the viewport", async () => {
    const screen = await renderWithTheme(
      <ContextMenu
        x={window.innerWidth + 400}
        y={window.innerHeight + 400}
        ariaLabel="m"
        onClose={noop}
      >
        <ContextMenu.Item label="open in gitlab" onClick={noop} />
        <ContextMenu.Item label="copy for slack" onClick={noop} />
      </ContextMenu>,
    );

    const box = await settledBox(rootOf(screen.container));
    expect(box.left).toBeLessThanOrEqual(window.innerWidth - MARGIN);
    expect(box.top).toBeLessThanOrEqual(window.innerHeight - MARGIN);
    // The whole box, not just its origin, is what has to fit.
    expect(box.right).toBeLessThanOrEqual(window.innerWidth - MARGIN + 0.5);
    expect(box.bottom).toBeLessThanOrEqual(window.innerHeight - MARGIN + 0.5);
  });

  it("clamps a negative point to the near edge's own margin", async () => {
    const screen = await renderWithTheme(
      <ContextMenu x={-500} y={-500} ariaLabel="m" onClose={noop}>
        <ContextMenu.Item label="open in gitlab" onClick={noop} />
      </ContextMenu>,
    );

    const box = await settledBox(rootOf(screen.container));
    expect(Math.abs(box.left - MARGIN)).toBeLessThan(0.5);
    expect(Math.abs(box.top - MARGIN)).toBeLessThan(0.5);
  });

  it("is hidden until it has been measured, then visible at the clamped point", async () => {
    // The `visibility: hidden` first paint is what stops the menu flashing at
    // the un-clamped point; by the time the render promise resolves the layout
    // effect has run, so the settled state is what is observable here.
    const screen = await renderWithTheme(
      <ContextMenu x={30} y={30} ariaLabel="m" onClose={noop}>
        <ContextMenu.Item label="open in gitlab" onClick={noop} />
      </ContextMenu>,
    );

    const root = rootOf(screen.container);
    expect(getComputedStyle(root).visibility).toBe("visible");
    const box = await settledBox(root);
    expect(Math.abs(box.left - 30)).toBeLessThan(0.5);
    expect(Math.abs(box.top - 30)).toBeLessThan(0.5);
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    await renderWithTheme(
      <ContextMenu x={40} y={40} ariaLabel="m" onClose={onClose}>
        <ContextMenu.Item label="open in gitlab" onClick={noop} />
      </ContextMenu>,
    );

    await userEvent.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on a mousedown OUTSIDE it, but not on one inside", async () => {
    const onClose = vi.fn();
    const screen = await renderWithTheme(
      <ContextMenu x={40} y={40} ariaLabel="m" onClose={onClose}>
        <ContextMenu.Item label="open in gitlab" onClick={noop} />
      </ContextMenu>,
    );

    rootOf(screen.container).dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();

    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on scroll and on resize", async () => {
    const onScrollClose = vi.fn();
    const screenA = await renderWithTheme(
      <ContextMenu x={40} y={40} ariaLabel="m" onClose={onScrollClose}>
        <ContextMenu.Item label="open in gitlab" onClick={noop} />
      </ContextMenu>,
    );
    window.dispatchEvent(new Event("scroll"));
    expect(onScrollClose).toHaveBeenCalledTimes(1);
    await screenA.unmount();

    const onResizeClose = vi.fn();
    await renderWithTheme(
      <ContextMenu x={40} y={40} ariaLabel="m" onClose={onResizeClose}>
        <ContextMenu.Item label="open in gitlab" onClick={noop} />
      </ContextMenu>,
    );
    window.dispatchEvent(new Event("resize"));
    expect(onResizeClose).toHaveBeenCalledTimes(1);
  });

  it("tears its listeners down on unmount", async () => {
    const onClose = vi.fn();
    const screen = await renderWithTheme(
      <ContextMenu x={40} y={40} ariaLabel="m" onClose={onClose}>
        <ContextMenu.Item label="open in gitlab" onClick={noop} />
      </ContextMenu>,
    );
    await screen.unmount();

    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    window.dispatchEvent(new Event("scroll"));
    window.dispatchEvent(new Event("resize"));
    await userEvent.keyboard("{Escape}");

    expect(onClose).not.toHaveBeenCalled();
  });

  it("stamps a stable data-part on every slot", async () => {
    // Literals, not CONTEXTMENU_PARTS references: the point of this case is
    // that the CONTRACT's values are what they are, so reading them out of the
    // constant under test would make it vacuous.
    const screen = await renderWithTheme(
      <ContextMenu x={40} y={40} ariaLabel="m" onClose={noop}>
        <ContextMenu.Label>!42</ContextMenu.Label>
        <ContextMenu.Item label="review" hint="herdr" onClick={noop} />
        <ContextMenu.Separator />
      </ContextMenu>,
    );

    for (const part of [
      "contextmenu",
      "contextmenu-item",
      "contextmenu-label",
      "contextmenu-separator",
      "contextmenu-hint",
    ]) {
      expect(partsIn(screen.container, part), part).toHaveLength(1);
    }
  });

  it("a consumer-supplied data-part does not win, on the root or on a part", async () => {
    const screen = await renderWithTheme(
      <ContextMenu x={40} y={40} ariaLabel="m" onClose={noop} data-part="hijacked-root">
        <ContextMenu.Item label="review" onClick={noop} data-part="hijacked-item" />
        <ContextMenu.Label data-part="hijacked-label">!42</ContextMenu.Label>
        <ContextMenu.Separator data-part="hijacked-sep" />
      </ContextMenu>,
    );

    expect(screen.container.querySelectorAll('[data-part^="hijacked"]')).toHaveLength(0);
    expect(partsIn(screen.container, "contextmenu")).toHaveLength(1);
    expect(partsIn(screen.container, "contextmenu-item")).toHaveLength(1);
  });

  it("never hand-emits the vocabulary-axis data attributes", async () => {
    const screen = await renderWithTheme(
      <ContextMenu x={40} y={40} ariaLabel="m" onClose={noop}>
        <ContextMenu.Item label="review" onClick={noop} />
      </ContextMenu>,
    );
    const root = rootOf(screen.container);

    expect(root.getAttribute("data-variant")).toBeNull();
    expect(root.getAttribute("data-intent")).toBeNull();
    expect(root.getAttribute("data-size")).toBeNull();
  });

  it("applies its layered stylesheet to the root and to every part", async () => {
    const screen = await renderWithTheme(
      <ContextMenu x={40} y={40} ariaLabel="m" onClose={noop}>
        <ContextMenu.Label>!42</ContextMenu.Label>
        <ContextMenu.Item label="review" hint="herdr" onClick={noop} />
        <ContextMenu.Separator />
      </ContextMenu>,
    );
    const root = rootOf(screen.container);

    // `.tui-menu`'s own fixed positioning + radius (a bare <div> has neither).
    const rootStyle = getComputedStyle(root);
    expect(rootStyle.position).toBe("fixed");
    expect(rootStyle.borderRadius).toBe("8px");
    expect(rootStyle.minWidth).toBe("200px");

    // `.tui-menu-item`'s flex row (a bare <button> is inline-block).
    const item = partsIn(screen.container, CONTEXTMENU_PARTS.item)[0] as HTMLElement;
    expect(getComputedStyle(item).display).toBe("flex");
    expect(getComputedStyle(item).justifyContent).toBe("space-between");

    // `.tui-menu-sep`'s 1px rule, and `.tui-menu-label`'s mono face.
    const sep = partsIn(screen.container, CONTEXTMENU_PARTS.separator)[0] as HTMLElement;
    expect(getComputedStyle(sep).height).toBe("1px");
    const label = partsIn(screen.container, CONTEXTMENU_PARTS.label)[0] as HTMLElement;
    expect(getComputedStyle(label).fontFamily).toContain("JetBrains Mono");
  });

  it("the item's declared width is an OUTER measure, so it never overflows the menu", async () => {
    // mr-board's `.tui-menu-item` is `width: 100%` inside a `padding: 4px`
    // menu and relies on a GLOBAL `* { box-sizing: border-box }` reset. This
    // kit's copy of that reset is in the OPTIONAL src/canvas.css (the browser
    // tier loads theme.css only), so the recipe declares it itself.
    const screen = await renderWithTheme(
      <ContextMenu x={40} y={40} ariaLabel="m" onClose={noop}>
        <ContextMenu.Item label="review" onClick={noop} />
      </ContextMenu>,
    );

    const rootBox = await settledBox(rootOf(screen.container));
    const item = partsIn(screen.container, CONTEXTMENU_PARTS.item)[0] as HTMLElement;
    const itemBox = item.getBoundingClientRect();

    expect(itemBox.right).toBeLessThanOrEqual(rootBox.right + 0.5);
    expect(itemBox.left).toBeGreaterThanOrEqual(rootBox.left - 0.5);
  });

  it("accepts universal style props with zero recipe wiring", async () => {
    const screen = await renderWithTheme(
      <ContextMenu x={40} y={40} ariaLabel="m" onClose={noop} p="lg">
        <ContextMenu.Item label="review" onClick={noop} />
      </ContextMenu>,
    );

    // tuiTheme's --spacing-lg is 0.7rem, i.e. 11.2px at a 16px root.
    expect(getComputedStyle(rootOf(screen.container)).paddingTop).toBe("11.2px");
  });

  it("keeps the clamped position when a consumer also passes a style prop", async () => {
    // The positioning style is computed by the recipe and merged ON TOP of
    // whatever `getStyles` produced, so a consumer `style` can dress the menu
    // without knocking it off its anchor.
    const screen = await renderWithTheme(
      <ContextMenu x={60} y={70} ariaLabel="m" onClose={noop} style={{ opacity: "0.5" }}>
        <ContextMenu.Item label="review" onClick={noop} />
      </ContextMenu>,
    );

    const root = rootOf(screen.container);
    const box = await settledBox(root);
    expect(getComputedStyle(root).opacity).toBe("0.5");
    expect(Math.abs(box.left - 60)).toBeLessThan(0.5);
    expect(Math.abs(box.top - 70)).toBeLessThan(0.5);
  });

  it("focuses initialFocusRef once the clamp has positioned it", async () => {
    // The ticket's repro: a child relying on `autoFocus` comes up unfocused
    // because the anti-flash `visibility: hidden` blocks focus entirely until
    // the clamp commits. This pins the first-class answer — `initialFocusRef`
    // lands focus in the SAME effect chain, right after the clamp's `setPos`
    // has landed and `visibility` has flipped to `visible`.
    function Menu() {
      const textareaRef = useRef<HTMLTextAreaElement | null>(null);
      return (
        <ContextMenu x={40} y={40} ariaLabel="m" onClose={noop} initialFocusRef={textareaRef}>
          <ContextMenu.Item label="open in gitlab" onClick={noop} />
          <textarea ref={textareaRef} aria-label="note" />
        </ContextMenu>
      );
    }
    const screen = await renderWithTheme(<Menu />);
    await settledBox(rootOf(screen.container));

    const textarea = screen.getByRole("textbox", { name: "note" }).element();
    expect(document.activeElement).toBe(textarea);
  });

  it("steals no focus when initialFocusRef is omitted", async () => {
    // The negative case: nothing in the recipe reaches for focus on its own
    // when the consumer never opted in.
    function Menu() {
      const textareaRef = useRef<HTMLTextAreaElement | null>(null);
      return (
        <ContextMenu x={40} y={40} ariaLabel="m" onClose={noop}>
          <ContextMenu.Item label="open in gitlab" onClick={noop} />
          <textarea ref={textareaRef} aria-label="note" />
        </ContextMenu>
      );
    }
    const screen = await renderWithTheme(<Menu />);
    await settledBox(rootOf(screen.container));

    const textarea = screen.getByRole("textbox", { name: "note" }).element();
    expect(document.activeElement).not.toBe(textarea);
  });

  it("calls onPositioned once the clamp has committed", async () => {
    const onPositioned = vi.fn();
    const screen = await renderWithTheme(
      <ContextMenu x={40} y={40} ariaLabel="m" onClose={noop} onPositioned={onPositioned}>
        <ContextMenu.Item label="open in gitlab" onClick={noop} />
      </ContextMenu>,
    );
    await settledBox(rootOf(screen.container));

    expect(onPositioned).toHaveBeenCalledTimes(1);
  });

  it("extend threads defaultProps (invariant 1 stays load-bearing)", async () => {
    const extended = createTheme({
      extends: tuiTheme,
      components: [ContextMenu.extend({ defaultProps: { ariaLabel: "themed label" } })],
    });

    const screen = await renderWithTheme(
      // @ts-expect-error -- `ariaLabel` is required on the own type; the theme
      // default satisfies it at runtime, which is exactly what this pins.
      <ContextMenu x={40} y={40} onClose={noop}>
        <ContextMenu.Item label="review" onClick={noop} />
      </ContextMenu>,
      undefined,
      extended,
    );

    await expect.element(screen.getByRole("menu", { name: "themed label" })).toBeVisible();
  });
});
