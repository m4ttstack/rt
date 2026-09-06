import { createTheme } from "@soribashi/core";
import { describe, expect, it } from "vitest";
import { renderWithTheme } from "../../../test/test-utils.tsx";
import { animationResolution } from "../../../test/keyframes.ts";
import type { Toast } from "../../hooks/index.ts";
import { tuiTheme } from "../../theme.ts";
import { TOASTHOST_PARTS, ToastHost } from "./ToastHost.tsx";

/**
 * Browser tier for the ToastHost recipe.
 *
 * Every render goes through `renderWithTheme`; assertions observe rendered
 * behaviour, not emitted CSS text; `data-part` is the one structural
 * assertion.
 */

function rootQuery(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-part="${TOASTHOST_PARTS.root}"]`);
}

function toastsOf(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(`[data-part="${TOASTHOST_PARTS.toast}"]`),
  );
}

const TOASTS: Toast[] = [
  { id: 1, text: "posted to slack" },
  { id: 2, text: "copied" },
];

describe("ToastHost (browser)", () => {
  it("renders one toast entry per item, in order, each carrying its text", async () => {
    const screen = await renderWithTheme(<ToastHost toasts={TOASTS} />);

    const entries = toastsOf(screen.container);
    expect(entries.map((el) => el.textContent)).toEqual(["posted to slack", "copied"]);
  });

  it("renders nothing at all for an empty queue (verbatim from mr-board)", async () => {
    const screen = await renderWithTheme(<ToastHost toasts={[]} />);

    expect(rootQuery(screen.container)).toBeNull();
    expect(screen.container.textContent).toBe("");
  });

  it("role=status / aria-live=polite are preserved", async () => {
    const screen = await renderWithTheme(<ToastHost toasts={TOASTS} />);

    const root = screen.getByRole("status");
    await expect.element(root).toBeVisible();
    expect(rootQuery(screen.container)?.getAttribute("aria-live")).toBe("polite");
  });

  it("stamps stable data-parts on both the host and each toast", async () => {
    const screen = await renderWithTheme(<ToastHost toasts={TOASTS} />);

    expect(rootQuery(screen.container)?.getAttribute("data-part")).toBe("toasthost");
    const entries = toastsOf(screen.container);
    expect(entries).toHaveLength(2);
    for (const el of entries) {
      expect(el.getAttribute("data-part")).toBe("toasthost-toast");
    }
  });

  it("a consumer-supplied data-part does not win", async () => {
    const screen = await renderWithTheme(<ToastHost toasts={TOASTS} data-part="hijacked" />);

    expect(rootQuery(screen.container)?.getAttribute("data-part")).toBe("toasthost");
    expect(screen.container.querySelectorAll('[data-part="hijacked"]')).toHaveLength(0);
  });

  it("never hand-emits the vocabulary-axis data attributes", async () => {
    const screen = await renderWithTheme(<ToastHost toasts={TOASTS} />);
    const root = rootQuery(screen.container) as HTMLElement;

    expect(root.getAttribute("data-variant")).toBeNull();
    expect(root.getAttribute("data-intent")).toBeNull();
    expect(root.getAttribute("data-size")).toBeNull();
  });

  it("applies its layered stylesheet to the rendered elements", async () => {
    const screen = await renderWithTheme(<ToastHost toasts={TOASTS} />);

    // .tui-toasts's `position: fixed` (the CSS-less default for a <div> is
    // `static`), proving ToastHost.module.css actually reached the DOM.
    expect(getComputedStyle(rootQuery(screen.container) as HTMLElement).position).toBe("fixed");
  });

  it("each toast slides in via a @keyframes rule a loaded sheet actually declares, under its global name", async () => {
    const screen = await renderWithTheme(<ToastHost toasts={TOASTS} />);

    const [first] = toastsOf(screen.container);
    const { name, found } = animationResolution(first as HTMLElement);
    expect(found, `no @keyframes rule named "${name}" in any loaded sheet`).toBe(true);
    expect(name).toBe("toasthost-in");
    // Slower than mr-board's 140ms, which read as a jump; see docs/decisions.md.
    const style = getComputedStyle(first as HTMLElement);
    expect(style.animationDuration).toBe("0.22s");
    expect(style.animationTimingFunction).toBe("ease-out");
  });

  it("a consumer can override the default role via {...rest}", async () => {
    // Band ordering pin: role/aria-live are band-1 courtesy defaults, so a
    // consumer's own value (band 2) wins -- the same shape Icon's
    // "promote to labelled image" pins for aria-hidden.
    const screen = await renderWithTheme(<ToastHost toasts={TOASTS} role="log" />);

    expect(rootQuery(screen.container)?.getAttribute("role")).toBe("log");
  });

  it("accepts universal style props with zero recipe wiring", async () => {
    const screen = await renderWithTheme(<ToastHost toasts={TOASTS} p="lg" />);

    // tuiTheme's --spacing-lg is 0.7rem, i.e. 11.2px at a 16px root.
    expect(getComputedStyle(rootQuery(screen.container) as HTMLElement).paddingTop).toBe(
      "11.2px",
    );
  });

  it("extend threads defaultProps (invariant 1 stays load-bearing)", async () => {
    const extended = createTheme({
      extends: tuiTheme,
      components: [ToastHost.extend({ defaultProps: { toasts: TOASTS } })],
    });

    const screen = await renderWithTheme(
      // @ts-expect-error -- `toasts` is required on the own type; the theme
      // default satisfies it at runtime, which is exactly what this pins.
      <ToastHost />,
      undefined,
      extended,
    );

    expect(toastsOf(screen.container).map((el) => el.textContent)).toEqual([
      "posted to slack",
      "copied",
    ]);
  });
});
