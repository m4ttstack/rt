import { describe, expect, it } from "vitest";
import { renderWithTheme } from "../../../test/test-utils.tsx";
import { BADGE_PARTS, Badge } from "./Badge.tsx";

/**
 * Browser tier for the Badge recipe.
 *
 * Same conventions as StatusDot.test.tsx/Spinner.test.tsx: every render goes
 * through `renderWithTheme`, assertions observe rendered behaviour, and the
 * one sanctioned structural assertion is `data-part`.
 *
 * `intent` is a recipe-own four-value scalar, not the theme's `intent`
 * vocabulary axis -- Badge declares no `vocabularyAxes`, so it hand-stamps
 * `data-intent` itself in render rather than through `getStyles`.
 */

function rootOf(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-part="${BADGE_PARTS.root}"]`);
  if (!el) throw new Error("no Badge root rendered");
  return el;
}

describe("Badge (browser)", () => {
  it("renders a span with data-part and its children", async () => {
    const screen = await renderWithTheme(<Badge>200 34ms</Badge>);

    const root = rootOf(screen.container);
    expect(root.tagName).toBe("SPAN");
    expect(root.textContent).toBe("200 34ms");
  });

  it("defaults to data-intent=muted", async () => {
    const screen = await renderWithTheme(<Badge>idle</Badge>);

    expect(rootOf(screen.container).getAttribute("data-intent")).toBe("muted");
  });

  it.each(["ok", "warn", "bad", "muted"] as const)(
    "intent=%s stamps its own data-intent",
    async (intent) => {
      const screen = await renderWithTheme(<Badge intent={intent}>x</Badge>);

      expect(rootOf(screen.container).getAttribute("data-intent")).toBe(intent);
    },
  );

  it("title passes through to the root", async () => {
    const screen = await renderWithTheme(<Badge title="HTTP 200">200 34ms</Badge>);

    expect(rootOf(screen.container).getAttribute("title")).toBe("HTTP 200");
  });

  it("a consumer className passes through and merges with the recipe's own class", async () => {
    const screen = await renderWithTheme(<Badge className="app-badge">x</Badge>);

    const root = rootOf(screen.container);
    expect(root.classList.contains("app-badge")).toBe(true);
    // `display: inline-flex` only exists in Badge.module.css's `.root`,
    // proving the module class survived alongside the consumer's own.
    expect(getComputedStyle(root).display).toBe("inline-flex");
  });
});
