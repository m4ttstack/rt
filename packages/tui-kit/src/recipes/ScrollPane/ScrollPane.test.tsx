import { describe, expect, it } from "vitest";
import { renderWithTheme } from "../../../test/test-utils.tsx";
import { ScrollPane } from "./ScrollPane.tsx";

/**
 * Browser tier for the ScrollPane recipe.
 *
 * Same conventions as Alert.test.tsx/Panel.test.tsx: every render goes
 * through `renderWithTheme`, assertions observe rendered behaviour, and the
 * one sanctioned structural assertion is `data-part`.
 */

describe("ScrollPane (browser)", () => {
  it("renders title in the head band and children in the scrolling body", async () => {
    const screen = await renderWithTheme(
      <ScrollPane title="Decision context">body text</ScrollPane>,
    );
    const { container } = screen;

    const head = container.querySelector('[data-part="scrollpane-head"]');
    const body = container.querySelector('[data-part="scrollpane-body"]');
    expect(head?.textContent).toBe("Decision context");
    expect(body?.textContent).toBe("body text");
  });

  it("maxHeight flows to the root as the pane cap var", async () => {
    const screen = await renderWithTheme(<ScrollPane title="t" maxHeight="46vh" />);
    const { container } = screen;

    const root = container.querySelector('[data-part="scrollpane"]');
    expect(root?.getAttribute("style")).toContain("--sb-scrollpane-max: 46vh");
  });

  it("omitted maxHeight leaves the pane uncapped", async () => {
    const screen = await renderWithTheme(<ScrollPane title="t" />);
    const { container } = screen;

    const root = container.querySelector('[data-part="scrollpane"]');
    expect(root?.getAttribute("style")).toContain("--sb-scrollpane-max: none");
  });
});
