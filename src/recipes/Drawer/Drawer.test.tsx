import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { renderWithTheme } from "../../../test/test-utils.tsx";
import { animationResolution } from "../../../test/keyframes.ts";
import { DRAWER_PARTS, Drawer, type DrawerScreen } from "./Drawer.tsx";

/**
 * Browser tier for the Drawer recipe.
 *
 * Same conventions as every other recipe: renders go through `renderWithTheme`,
 * assertions observe rendered behaviour, and `data-part` is the one sanctioned
 * structural query.
 *
 * Drawer COMPOSES SideDrawer rather than owning its own overlay — the panel
 * is `[data-part="sidedrawer"]`, not `[data-part="drawer"]` (Drawer stamps no
 * `data-part` of its own on that element; see Drawer.tsx). Every case below
 * that needs the panel element queries that selector.
 */

function partOf(container: HTMLElement, part: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-part="${part}"]`);
  if (!el) throw new Error(`no [data-part="${part}"] rendered`);
  return el;
}

function queryPart(container: HTMLElement, part: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-part="${part}"]`);
}

function panelOf(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>('[data-part="sidedrawer"]');
  if (!el) throw new Error("no drawer panel rendered");
  return el;
}

function overlayOf(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>('[data-part="sidedrawer-overlay"]');
  if (!el) throw new Error("no drawer overlay rendered");
  return el;
}

const noop = () => {};

/** A depth-1 stack: no back link, no navAction, no header. */
function rootStack(): DrawerScreen[] {
  return [{ id: "settings", title: "Settings", content: <div>settings body</div> }];
}

/** A depth-2 stack: `edit` pushed on top of `settings`, with a navAction and
    a header region, for the cases that need both. */
function nestedStack(onAction = vi.fn()): DrawerScreen[] {
  return [
    { id: "settings", title: "Settings", content: <div>settings body</div> },
    {
      id: "edit",
      title: "Edit profile",
      header: <div>unsaved changes</div>,
      navAction: { label: "Save", onAction },
      content: <div>edit body</div>,
    },
  ];
}

describe("Drawer (browser)", () => {
  it("renders nothing when closed", async () => {
    const screen = await renderWithTheme(
      <Drawer open={false} stack={rootStack()} onBack={noop} onClose={noop} ariaLabel="d" />,
    );

    expect(queryPart(screen.container, "sidedrawer")).toBeNull();
  });

  it("renders the top of the stack as a labelled dialog, background not aria-modal", async () => {
    const screen = await renderWithTheme(
      <Drawer open stack={rootStack()} onBack={noop} onClose={noop} ariaLabel="settings drawer" />,
    );

    const dialog = screen.getByRole("dialog", { name: "settings drawer" });
    await expect.element(dialog).toBeVisible();
    expect(screen.container.textContent).toContain("settings body");
    expect(panelOf(screen.container).getAttribute("aria-modal")).toBeNull();
  });

  it("shows no back link at the root of the stack", async () => {
    const screen = await renderWithTheme(
      <Drawer open stack={rootStack()} onBack={noop} onClose={noop} ariaLabel="d" />,
    );

    expect(queryPart(screen.container, DRAWER_PARTS.back)).toBeNull();
  });

  it("shows a back link labelled with the previous screen's title when nested, and it pops", async () => {
    const onBack = vi.fn();
    const screen = await renderWithTheme(
      <Drawer open stack={nestedStack()} onBack={onBack} onClose={noop} ariaLabel="d" />,
    );

    const back = partOf(screen.container, DRAWER_PARTS.back);
    expect(back.textContent).toContain("Settings");
    expect(back.textContent).toContain("‹");

    back.click();
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("Escape pops the stack when nested, rather than closing", async () => {
    const onBack = vi.fn();
    const onClose = vi.fn();
    await renderWithTheme(
      <Drawer open stack={nestedStack()} onBack={onBack} onClose={onClose} ariaLabel="d" />,
    );

    await userEvent.keyboard("{Escape}");

    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Escape closes at the root of the stack", async () => {
    const onBack = vi.fn();
    const onClose = vi.fn();
    await renderWithTheme(
      <Drawer open stack={rootStack()} onBack={onBack} onClose={onClose} ariaLabel="d" />,
    );

    await userEvent.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onBack).not.toHaveBeenCalled();
  });

  it("the close button always calls onClose, even nested", async () => {
    const onBack = vi.fn();
    const onClose = vi.fn();
    const screen = await renderWithTheme(
      <Drawer open stack={nestedStack()} onBack={onBack} onClose={onClose} ariaLabel="d" />,
    );

    partOf(screen.container, DRAWER_PARTS.close).click();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onBack).not.toHaveBeenCalled();
  });

  it("the close button closes from the root too", async () => {
    const onClose = vi.fn();
    const screen = await renderWithTheme(
      <Drawer open stack={rootStack()} onBack={noop} onClose={onClose} ariaLabel="d" />,
    );

    partOf(screen.container, DRAWER_PARTS.close).click();

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("an overlay click always calls onClose, even nested — unlike Escape, which pops", async () => {
    const onBack = vi.fn();
    const onClose = vi.fn();
    const screen = await renderWithTheme(
      <Drawer open stack={nestedStack()} onBack={onBack} onClose={onClose} ariaLabel="d" />,
    );

    overlayOf(screen.container).click();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onBack).not.toHaveBeenCalled();
  });

  it("renders the current screen's optional header region", async () => {
    const screen = await renderWithTheme(
      <Drawer open stack={nestedStack()} onBack={noop} onClose={noop} ariaLabel="d" />,
    );

    expect(partOf(screen.container, DRAWER_PARTS.header).textContent).toBe("unsaved changes");
  });

  it("omits the header node when the screen carries none", async () => {
    const screen = await renderWithTheme(
      <Drawer open stack={rootStack()} onBack={noop} onClose={noop} ariaLabel="d" />,
    );

    expect(queryPart(screen.container, DRAWER_PARTS.header)).toBeNull();
  });

  it("renders navAction and fires it", async () => {
    const onAction = vi.fn();
    const screen = await renderWithTheme(
      <Drawer open stack={nestedStack(onAction)} onBack={noop} onClose={noop} ariaLabel="d" />,
    );

    const button = partOf(screen.container, DRAWER_PARTS.navAction) as HTMLButtonElement;
    expect(button.textContent).toBe("Save");
    button.click();

    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("respects navAction.disabled", async () => {
    const stack: DrawerScreen[] = [
      { id: "settings", title: "Settings", content: <div>settings body</div> },
      {
        id: "edit",
        title: "Edit profile",
        navAction: { label: "Save", onAction: vi.fn(), disabled: true },
        content: <div>edit body</div>,
      },
    ];
    const screen = await renderWithTheme(
      <Drawer open stack={stack} onBack={noop} onClose={noop} ariaLabel="d" />,
    );

    const button = partOf(screen.container, DRAWER_PARTS.navAction) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("omits navAction when the screen carries none", async () => {
    const screen = await renderWithTheme(
      <Drawer open stack={rootStack()} onBack={noop} onClose={noop} ariaLabel="d" />,
    );

    expect(queryPart(screen.container, DRAWER_PARTS.navAction)).toBeNull();
  });

  it("moves focus into the panel on open", async () => {
    const screen = await renderWithTheme(
      <Drawer open stack={rootStack()} onBack={noop} onClose={noop} ariaLabel="d" />,
    );

    expect(document.activeElement).toBe(panelOf(screen.container));
  });

  it("restores focus to returnFocusRef on close", async () => {
    function Harness() {
      const triggerRef = useRef<HTMLButtonElement>(null);
      const [open, setOpen] = useState(true);
      return (
        <>
          <button ref={triggerRef} type="button" onClick={() => setOpen(true)}>
            open drawer
          </button>
          <Drawer
            open={open}
            stack={rootStack()}
            onBack={noop}
            onClose={() => setOpen(false)}
            ariaLabel="d"
            returnFocusRef={triggerRef}
          />
        </>
      );
    }

    const screen = await renderWithTheme(<Harness />);
    expect(document.activeElement).toBe(panelOf(screen.container));

    // Awaited: focus restoration depends on the `open -> false` re-render
    // having actually committed, which a bare DOM `.click()` does not
    // guarantee before the next line runs.
    await page.elementLocator(partOf(screen.container, DRAWER_PARTS.close)).click();

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "open drawer" }).element(),
    );
  });

  it("stamps data-part on every slot it draws", async () => {
    const screen = await renderWithTheme(
      <Drawer open stack={nestedStack()} onBack={noop} onClose={noop} ariaLabel="d" />,
    );

    for (const part of [
      DRAWER_PARTS.nav,
      DRAWER_PARTS.back,
      DRAWER_PARTS.title,
      DRAWER_PARTS.navAction,
      DRAWER_PARTS.close,
      DRAWER_PARTS.header,
      DRAWER_PARTS.content,
    ]) {
      expect(queryPart(screen.container, part), `missing [data-part="${part}"]`).not.toBeNull();
    }
  });

  it("runs under no-preference reduced motion, so the slide-in assertion below means something", () => {
    // Same canary as Chip/ToastHost: vitest.browser.config.ts pins
    // `reducedMotion: "no-preference"`, which is what makes the animation
    // assertion below meaningful rather than accidentally green.
    expect(window.matchMedia("(prefers-reduced-motion: reduce)").matches).toBe(false);
  });

  it("the content slot slides in on mount, via a @keyframes rule a loaded sheet declares", async () => {
    const screen = await renderWithTheme(
      <Drawer open stack={rootStack()} onBack={noop} onClose={noop} ariaLabel="d" />,
    );

    const content = partOf(screen.container, DRAWER_PARTS.content);
    const { name, found } = animationResolution(content);
    expect(found, `no @keyframes rule named "${name}" in any loaded sheet`).toBe(true);
    expect(name).toBe("drawer-slide-in");
  });

  it("the content region scrolls under tall content; the nav bar stays pinned", async () => {
    // A short viewport, so the panel's own height (100% of it) is shorter
    // than the content below — real overflow, not a synthetic scrollHeight
    // reading with nothing actually clipped.
    await page.viewport(700, 320);
    const tall: DrawerScreen[] = [
      {
        id: "long",
        title: "Long screen",
        content: (
          <div style={{ height: "1400px" }}>
            tall content that must overflow the panel
          </div>
        ),
      },
    ];
    const screen = await renderWithTheme(
      <Drawer open stack={tall} onBack={noop} onClose={noop} ariaLabel="d" />,
    );

    const content = partOf(screen.container, DRAWER_PARTS.content);
    const nav = partOf(screen.container, DRAWER_PARTS.nav);
    const panel = panelOf(screen.container);

    // The content region is the one that overflows and scrolls...
    expect(content.scrollHeight).toBeGreaterThan(content.clientHeight);
    // ...not the panel SideDrawer itself owns.
    expect(panel.scrollHeight).toBe(panel.clientHeight);

    const navRectBefore = nav.getBoundingClientRect();
    content.scrollTop = 300;
    expect(content.scrollTop).toBeGreaterThan(0);
    const navRectAfter = nav.getBoundingClientRect();

    expect(navRectAfter.top).toBe(navRectBefore.top);
    expect(navRectAfter.height).toBe(navRectBefore.height);
  });

  it("is full width under a narrow viewport, and the fixed 21rem panel above it", async () => {
    await page.viewport(1000, 700);
    const wide = await renderWithTheme(
      <Drawer open stack={rootStack()} onBack={noop} onClose={noop} ariaLabel="d" />,
    );
    const widePanel = panelOf(wide.container);
    expect(widePanel.getAttribute("data-full-width")).toBeNull();
    // 21rem at a 16px root.
    expect(Math.round(widePanel.getBoundingClientRect().width)).toBe(336);
    await wide.unmount();

    await page.viewport(600, 700);
    const narrow = await renderWithTheme(
      <Drawer open stack={rootStack()} onBack={noop} onClose={noop} ariaLabel="d" />,
    );
    const narrowPanel = panelOf(narrow.container);
    expect(narrowPanel.getAttribute("data-full-width")).toBe("true");
    expect(Math.round(narrowPanel.getBoundingClientRect().width)).toBe(600);
  });

  it("a stateful caller can push, pop and close across the stack", async () => {
    // The push trigger has to live INSIDE a screen's `content`, mirroring a
    // real consumer: SideDrawer's full-viewport scrim covers anything
    // rendered as a page sibling, so a trigger placed outside the stack
    // would be un-clickable while the drawer is open.
    function Harness() {
      const [stack, setStack] = useState<DrawerScreen[]>([]);
      const [open, setOpen] = useState(true);
      function pushEdit() {
        setStack((s) => [
          ...s,
          {
            id: "edit",
            title: "Edit profile",
            content: <div>edit body</div>,
          },
        ]);
      }
      const root: DrawerScreen = {
        id: "settings",
        title: "Settings",
        content: (
          <button type="button" onClick={pushEdit}>
            push edit
          </button>
        ),
      };
      return (
        <Drawer
          open={open}
          stack={[root, ...stack]}
          onBack={() => setStack((s) => s.slice(0, -1))}
          onClose={() => setOpen(false)}
          ariaLabel="d"
        />
      );
    }

    const screen = await renderWithTheme(<Harness />);
    expect(queryPart(screen.container, DRAWER_PARTS.back)).toBeNull();

    await screen.getByRole("button", { name: "push edit" }).click();
    expect(partOf(screen.container, DRAWER_PARTS.back).textContent).toContain("Settings");

    await userEvent.keyboard("{Escape}");
    expect(queryPart(screen.container, DRAWER_PARTS.back)).toBeNull();
    expect(screen.container.textContent).toContain("push edit");

    await userEvent.keyboard("{Escape}");
    expect(queryPart(screen.container, "sidedrawer")).toBeNull();
  });
});
