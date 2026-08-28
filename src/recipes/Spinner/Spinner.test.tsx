import { describe, expect, it } from "vitest";
import { renderWithTheme } from "../../../test/test-utils.tsx";
import { animationResolution } from "../../../test/keyframes.ts";
import { SPINNER_PARTS, Spinner } from "./Spinner.tsx";

/**
 * Browser tier for the Spinner recipe.
 *
 * Same conventions as StatusDot.test.tsx: every render goes through
 * `renderWithTheme`, assertions observe rendered behaviour, and the one
 * sanctioned structural assertion is `data-part`.
 *
 * `size` is a recipe-own two-value scalar, not a theme
 * vocabulary axis -- Spinner declares no `vocabularyAxes`, so it hand-stamps
 * `data-size` itself in render rather than through `getStyles`.
 */

function rootOf(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-part="${SPINNER_PARTS.root}"]`);
  if (!el) throw new Error("no Spinner root rendered");
  return el;
}

describe("Spinner (browser)", () => {
  it("renders a span with data-part and aria-hidden", async () => {
    const screen = await renderWithTheme(<Spinner />);

    const root = rootOf(screen.container);
    expect(root.tagName).toBe("SPAN");
    expect(root.getAttribute("aria-hidden")).toBe("true");
  });

  it("defaults to data-size=sm", async () => {
    const screen = await renderWithTheme(<Spinner />);

    expect(rootOf(screen.container).getAttribute("data-size")).toBe("sm");
  });

  it("size=xs stamps data-size=xs", async () => {
    const screen = await renderWithTheme(<Spinner size="xs" />);

    expect(rootOf(screen.container).getAttribute("data-size")).toBe("xs");
  });

  it("a consumer className passes through and merges with the recipe's own class", async () => {
    const screen = await renderWithTheme(<Spinner className="app-spinner" />);

    const root = rootOf(screen.container);
    expect(root.classList.contains("app-spinner")).toBe(true);
    // `display: inline-block` only exists in Spinner.module.css's `.root`,
    // proving the module class survived alongside the consumer's own.
    expect(getComputedStyle(root).display).toBe("inline-block");
  });

  it("declares no vocabulary axes: an intent prop is a type error", async () => {
    await renderWithTheme(
      // @ts-expect-error -- Spinner has no `intent` prop of any kind: no
      // vocabularyAxes are declared, and `intent` is not part of
      // SpinnerOwnProps.
      <Spinner intent="ok" />,
    );
  });

  it("spins via a @keyframes rule a loaded sheet actually declares, under its global name", async () => {
    const screen = await renderWithTheme(<Spinner />);

    const { name, found } = animationResolution(rootOf(screen.container));
    expect(found, `no @keyframes rule named "${name}" in any loaded sheet`).toBe(true);
    expect(name).toBe("sb-spinner-spin");
  });
});
