import { createTheme } from "@soribashi/core";
import { describe, expect, it } from "vitest";
import { renderWithTheme } from "../../../test/test-utils.tsx";
import { tuiTheme } from "../../theme.ts";
import { Panel, PANEL_PARTS, type PanelProps } from "./Panel.tsx";

/**
 * Browser tier for the Panel recipe.
 *
 * Conventions inherited from Icon.test.tsx / Chip.test.tsx / StatusDot.test.tsx
 * and task 8's checklist: every render goes through `renderWithTheme`;
 * assertions observe rendered behaviour (computed styles, the accessibility
 * tree, real interaction), never emitted CSS text (authoring skill § 18). The
 * one sanctioned structural assertion is `data-part`.
 *
 * localStorage IS STUBBED, following CopyButton.test.tsx's clipboard-stub
 * idiom for the same reason: real headless Chromium's localStorage persists
 * across tests within the run's page/origin, and this suite needs each test's
 * persistence to be deterministic and isolated rather than accumulating state
 * from prior tests or the environment. `Object.defineProperty` (not
 * `vi.stubGlobal`) so only `window.localStorage` is replaced, leaving the rest
 * of the page/DOM the browser test driver needs untouched.
 */

/** A minimal in-memory Storage stand-in; returns a restore function. */
function stubLocalStorage() {
  const original = Object.getOwnPropertyDescriptor(window, "localStorage");
  const store = new Map<string, string>();
  const fake: Storage = {
    getItem: (key) => (store.has(key) ? store.get(key)! : null),
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(window, "localStorage", { value: fake, configurable: true });
  return {
    store,
    restore: () => {
      if (original) Object.defineProperty(window, "localStorage", original);
      else delete (window as { localStorage?: unknown }).localStorage;
    },
  };
}

describe("Panel (browser)", () => {
  it("renders the title, count, and children when expanded", async () => {
    const { restore } = stubLocalStorage();
    try {
      const screen = await renderWithTheme(
        <Panel title="open MRs" count={3}>
          <div data-testid="body-content">rows go here</div>
        </Panel>,
      );

      expect(screen.getByText("open MRs")).toBeTruthy();
      expect(screen.getByText("3")).toBeTruthy();
      expect(screen.getByTestId("body-content")).toBeTruthy();
    } finally {
      restore();
    }
  });

  it("toggle collapses the body and flips aria-expanded", async () => {
    const { restore } = stubLocalStorage();
    try {
      const screen = await renderWithTheme(
        <Panel title="open MRs" count={3}>
          <div data-testid="body-content">rows go here</div>
        </Panel>,
      );

      const button = screen.getByRole("button", { name: /open MRs/ });
      expect(button.element().getAttribute("aria-expanded")).toBe("true");
      expect(screen.container.querySelector('[data-testid="body-content"]')).not.toBeNull();

      await button.click();

      expect(button.element().getAttribute("aria-expanded")).toBe("false");
      expect(screen.container.querySelector('[data-testid="body-content"]')).toBeNull();

      await button.click();

      expect(button.element().getAttribute("aria-expanded")).toBe("true");
      expect(screen.container.querySelector('[data-testid="body-content"]')).not.toBeNull();
    } finally {
      restore();
    }
  });

  it("the caret flips glyph between expanded (▾) and collapsed (▸)", async () => {
    const { restore } = stubLocalStorage();
    try {
      const screen = await renderWithTheme(<Panel title="caret test" count={1} />);
      const button = screen.getByRole("button", { name: /caret test/ });

      expect(screen.container.querySelector(`[data-part="${PANEL_PARTS.caret}"]`)?.textContent).toBe(
        "▾",
      );

      await button.click();

      expect(screen.container.querySelector(`[data-part="${PANEL_PARTS.caret}"]`)?.textContent).toBe(
        "▸",
      );
    } finally {
      restore();
    }
  });

  it("persists collapsed state to localStorage under the default key, keyed on title", async () => {
    const { store, restore } = stubLocalStorage();
    try {
      const screen = await renderWithTheme(<Panel title="persisted" count={2} />);
      await screen.getByRole("button", { name: /persisted/ }).click();

      const raw = store.get("tui-panel-collapsed");
      expect(raw).toBeDefined();
      expect(JSON.parse(raw!)).toEqual(["persisted"]);
    } finally {
      restore();
    }
  });

  it("round-trips: a panel already marked collapsed in storage mounts collapsed", async () => {
    const { store, restore } = stubLocalStorage();
    try {
      store.set("tui-panel-collapsed", JSON.stringify(["already folded"]));

      const screen = await renderWithTheme(
        <Panel title="already folded" count={5}>
          <div data-testid="body-content">hidden at mount</div>
        </Panel>,
      );

      const button = screen.getByRole("button", { name: /already folded/ });
      await expect
        .poll(() => button.element().getAttribute("aria-expanded"))
        .toBe("false");
      expect(screen.container.querySelector('[data-testid="body-content"]')).toBeNull();
    } finally {
      restore();
    }
  });

  it("honours a caller-supplied storageKey (mr-board's legacy key round-trips)", async () => {
    const { store, restore } = stubLocalStorage();
    try {
      // mr-board's own Panel wrote its collapsed set to this exact key
      // (src/client/ui/Panel.tsx's PANEL_STATE_KEY) before this recipe
      // existed. A consumer passing it as `storageKey` must read the app's
      // already-persisted state, not the kit's own default key.
      store.set("mrs-panel-collapsed", JSON.stringify(["legacy folded"]));

      const screen = await renderWithTheme(
        <Panel title="legacy folded" count={1} storageKey="mrs-panel-collapsed" />,
      );

      const button = screen.getByRole("button", { name: /legacy folded/ });
      await expect
        .poll(() => button.element().getAttribute("aria-expanded"))
        .toBe("false");

      // Toggling back open writes through the SAME legacy key, in the SAME
      // JSON-array-of-titles format mr-board's own readCollapsed/writeCollapsed
      // used — a format round-trip, not just a key round-trip.
      await button.click();
      expect(JSON.parse(store.get("mrs-panel-collapsed")!)).toEqual([]);

      // The kit's own default key is untouched by a call that overrides it.
      expect(store.has("tui-panel-collapsed")).toBe(false);
    } finally {
      restore();
    }
  });

  it("survives a corrupt/foreign value at the storage key (defensive parse)", async () => {
    const { restore } = stubLocalStorage();
    try {
      window.localStorage.setItem("tui-panel-collapsed", "not json{{{");

      const screen = await renderWithTheme(<Panel title="resilient" count={0} />);
      const button = screen.getByRole("button", { name: /resilient/ });

      await expect.poll(() => button.element().getAttribute("aria-expanded")).toBe("true");
    } finally {
      restore();
    }
  });

  it("renders the collapsed variant as the full-width bar form", async () => {
    const { restore } = stubLocalStorage();
    try {
      const screen = await renderWithTheme(<Panel title="bar form" count={4} />);
      const root = screen.container.querySelector(`[data-part="${PANEL_PARTS.root}"]`) as HTMLElement;
      const rootStyleBefore = getComputedStyle(root);
      // Expanded: framed panel, absolutely positioned title-on-border label.
      expect(rootStyleBefore.borderWidth).toBe("1px");
      expect(rootStyleBefore.position).toBe("relative");

      await screen.getByRole("button", { name: /bar form/ }).click();

      expect(root.hasAttribute("data-collapsed")).toBe(true);
      const rootStyleAfter = getComputedStyle(root);
      // Collapsed: outer frame dropped entirely.
      expect(rootStyleAfter.borderWidth).toBe("0px");
      expect(rootStyleAfter.backgroundColor).toBe("rgba(0, 0, 0, 0)");

      const title = screen.container.querySelector(
        `[data-part="${PANEL_PARTS.title}"]`,
      ) as HTMLElement;
      const titleStyle = getComputedStyle(title);
      // Collapsed: the title reflows from an absolutely-positioned border
      // label into a static, full-width inline bar.
      expect(titleStyle.position).toBe("static");
      expect(titleStyle.display).toBe("flex");
      expect(titleStyle.width).toBe(`${root.clientWidth}px`);
    } finally {
      restore();
    }
  });

  it("stamps its five data-parts (the kit's cross-boundary hook)", async () => {
    const { restore } = stubLocalStorage();
    try {
      const screen = await renderWithTheme(
        <Panel title="parts" count={1}>
          <div>body</div>
        </Panel>,
      );

      expect(screen.container.querySelectorAll(`[data-part="${PANEL_PARTS.root}"]`)).toHaveLength(1);
      expect(screen.container.querySelectorAll(`[data-part="${PANEL_PARTS.title}"]`)).toHaveLength(1);
      expect(screen.container.querySelectorAll(`[data-part="${PANEL_PARTS.caret}"]`)).toHaveLength(1);
      expect(screen.container.querySelectorAll(`[data-part="${PANEL_PARTS.count}"]`)).toHaveLength(1);
      expect(screen.container.querySelectorAll(`[data-part="${PANEL_PARTS.body}"]`)).toHaveLength(1);
    } finally {
      restore();
    }
  });

  it("a consumer-supplied data-part does not win", async () => {
    const { restore } = stubLocalStorage();
    try {
      const screen = await renderWithTheme(<Panel title="hijack" count={1} data-part="hijacked" />);
      const root = screen.container.querySelector(`[data-part="${PANEL_PARTS.root}"]`) as HTMLElement;

      expect(root.getAttribute("data-part")).toBe(PANEL_PARTS.root);
      expect(screen.container.querySelectorAll('[data-part="hijacked"]')).toHaveLength(0);
    } finally {
      restore();
    }
  });

  it("never hand-emits the vocabulary-axis data attributes (Panel declares none)", async () => {
    const { restore } = stubLocalStorage();
    try {
      const screen = await renderWithTheme(<Panel title="axes" count={1} />);
      const root = screen.container.querySelector(`[data-part="${PANEL_PARTS.root}"]`) as HTMLElement;

      expect(root.hasAttribute("data-variant")).toBe(false);
      expect(root.hasAttribute("data-intent")).toBe(false);
      expect(root.hasAttribute("data-size")).toBe(false);
    } finally {
      restore();
    }
  });

  it("applies its layered stylesheet to the rendered element", async () => {
    const { restore } = stubLocalStorage();
    try {
      const screen = await renderWithTheme(<Panel title="styled" count={1} />);
      const root = screen.container.querySelector(`[data-part="${PANEL_PARTS.root}"]`) as HTMLElement;

      const style = getComputedStyle(root);
      // tuiTheme: --radius-lg is 8px.
      expect(style.borderTopLeftRadius).toBe("8px");
      expect(style.position).toBe("relative");
    } finally {
      restore();
    }
  });

  it("accepts universal style props with zero recipe wiring", async () => {
    const { restore } = stubLocalStorage();
    try {
      const screen = await renderWithTheme(<Panel title="universal" count={1} m="md" />);
      const root = screen.container.querySelector(`[data-part="${PANEL_PARTS.root}"]`) as HTMLElement;

      // tuiTheme's --spacing-md is 0.6rem, i.e. 9.6px at a 16px root.
      expect(getComputedStyle(root).marginTop).toBe("9.6px");
    } finally {
      restore();
    }
  });

  it("extend threads defaultProps (invariant 1 stays load-bearing)", async () => {
    const { restore } = stubLocalStorage();
    try {
      const extended = createTheme({
        extends: tuiTheme,
        components: [Panel.extend({ defaultProps: { count: 7 } })],
      });

      // KNOWN TYPE GAP (see CopyButton.test.tsx/Segmented.test.tsx's identical
      // case): defaultProps supplied through the theme has no static
      // reflection back onto the required own-prop type, so omitting `count`
      // to prove it comes from the theme still needs a cast.
      const props = { title: "themed" } as unknown as PanelProps;
      const screen = await renderWithTheme(<Panel {...props} />, undefined, extended);

      expect(screen.getByText("7")).toBeTruthy();
    } finally {
      restore();
    }
  });
});
