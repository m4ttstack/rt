import { createTheme } from "@soribashi/core";
import { describe, expect, it } from "vitest";
import { renderWithTheme } from "../../../test/test-utils.tsx";
import { tuiTheme } from "../../theme.ts";
import { Markdown } from "./Markdown.tsx";

/**
 * Browser tier for the Markdown recipe.
 *
 * Every case renders through `renderWithTheme` (test/test-utils.tsx), never
 * `vitest-browser-react`'s `render` directly, per the authoring skill and
 * every prior recipe's own comment. Assertions observe rendered behaviour —
 * real DOM produced by ReactMarkdown+remarkGfm, computed styles, the
 * accessibility tree — rather than emitted CSS text (skill § 18). The one
 * structural exception is `data-part`, which IS the observable
 * cross-boundary contract.
 */

describe("Markdown (browser)", () => {
  it("renders markdown content as real DOM via ReactMarkdown", async () => {
    const screen = await renderWithTheme(<Markdown>{"# Hello\n\nSome **bold** text."}</Markdown>);

    await expect
      .element(screen.getByRole("heading", { level: 1, name: "Hello" }))
      .toBeVisible();
    const strong = screen.container.querySelector("strong");
    expect(strong?.textContent).toBe("bold");
  });

  it("remark-gfm is wired: a piped table renders as a real <table>", async () => {
    const md = ["| a | b |", "| --- | --- |", "| 1 | 2 |"].join("\n");
    const screen = await renderWithTheme(<Markdown>{md}</Markdown>);

    const table = screen.container.querySelector("table");
    expect(table).not.toBeNull();
    expect(table?.querySelectorAll("th")).toHaveLength(2);
    expect(table?.querySelectorAll("td")).toHaveLength(2);
  });

  it("without linkTargetBlank, a markdown link carries no target/rel", async () => {
    const screen = await renderWithTheme(<Markdown>{"[go](https://example.com)"}</Markdown>);

    const a = screen.container.querySelector("a");
    expect(a?.getAttribute("href")).toBe("https://example.com");
    expect(a?.getAttribute("target")).toBeNull();
    expect(a?.getAttribute("rel")).toBeNull();
  });

  it("linkTargetBlank renders markdown links to open in a new tab", async () => {
    const screen = await renderWithTheme(
      <Markdown linkTargetBlank>{"[go](https://example.com)"}</Markdown>,
    );

    const a = screen.container.querySelector("a");
    expect(a?.getAttribute("target")).toBe("_blank");
    expect(a?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("stamps a stable data-part on its root (the kit's cross-boundary hook)", async () => {
    // R7: the root slot's data-part is the SELF-IDENTIFYING recipe name,
    // "markdown" — NOT "root" (this recipe's own brief predates the ruling;
    // see task-8-report.md § 5).
    const screen = await renderWithTheme(<Markdown>text</Markdown>);

    const root = screen.container.firstElementChild as HTMLElement;
    expect(root.getAttribute("data-part")).toBe("markdown");
    expect(screen.container.querySelectorAll('[data-part="markdown"]')).toHaveLength(1);
  });

  it("a consumer-supplied data-part does not win", async () => {
    // data-part is stamped in the non-overridable tail, after {...rest}; a
    // consumer-passed value must not sever the cross-boundary contract.
    const screen = await renderWithTheme(<Markdown data-part="hijacked">text</Markdown>);
    const root = screen.container.firstElementChild as HTMLElement;

    expect(root.getAttribute("data-part")).toBe("markdown");
    expect(screen.container.querySelectorAll('[data-part="markdown"]')).toHaveLength(1);
    expect(screen.container.querySelectorAll('[data-part="hijacked"]')).toHaveLength(0);
  });

  it("never hand-emits the vocabulary-axis data attributes", async () => {
    // Markdown declares no vocabularyAxes/variants — getStyles('root') emits
    // none of these, and nothing here may hand-stamp them.
    const screen = await renderWithTheme(<Markdown>text</Markdown>);
    const root = screen.container.firstElementChild as HTMLElement;

    expect(root.getAttribute("data-variant")).toBeNull();
    expect(root.getAttribute("data-intent")).toBeNull();
    expect(root.getAttribute("data-size")).toBeNull();
  });

  it("applies its layered stylesheet to the rendered element", async () => {
    // `.tui-md`'s root declaration sets `overflow-wrap: anywhere`, which is
    // NOT the browser default ("normal") — a clean, single-property proxy
    // that the CSS module actually reached the DOM, the same shape Icon's
    // flex-shrink check and Panel's data-collapsed check use.
    const screen = await renderWithTheme(<Markdown>text</Markdown>);
    const root = screen.container.firstElementChild as HTMLElement;

    expect(getComputedStyle(root).overflowWrap).toBe("anywhere");
  });

  it("unstyled suppresses the recipe's own stylesheet, for adoption at a call site with pre-existing prose styling (CommentsDrawer)", async () => {
    // CommentsDrawer.tsx's `.tui-cd-note-body` wrapper is a SEPARATE,
    // board-owned prose block that never applied `.tui-md` — adopting this
    // recipe there needs `unstyled` to avoid injecting `.tui-md` typography
    // where the board never had it (see Markdown.tsx's own doc comment). This
    // pins the actual mechanism: `unstyled` suppresses the CSS-module class
    // (the SAME computed-style proxy the row above uses, now asserted to be
    // the browser DEFAULT instead), while `data-part` — the cross-boundary
    // hook, hand-stamped independently of getStyles's class resolution —
    // still lands.
    const styled = await renderWithTheme(<Markdown>text</Markdown>);
    expect(getComputedStyle(styled.container.firstElementChild as HTMLElement).overflowWrap).toBe(
      "anywhere",
    );

    const unstyled = await renderWithTheme(<Markdown unstyled>text</Markdown>);
    const root = unstyled.container.firstElementChild as HTMLElement;
    expect(getComputedStyle(root).overflowWrap).toBe("normal");
    expect(root.getAttribute("data-part")).toBe("markdown");
  });

  it("headings render through the real accessibility tree at the right level", async () => {
    const screen = await renderWithTheme(
      <Markdown>{"# One\n\n## Two\n\n### Three"}</Markdown>,
    );

    await expect.element(screen.getByRole("heading", { level: 1, name: "One" })).toBeVisible();
    await expect.element(screen.getByRole("heading", { level: 2, name: "Two" })).toBeVisible();
    await expect.element(screen.getByRole("heading", { level: 3, name: "Three" })).toBeVisible();
  });

  it("accepts universal style props with zero recipe wiring", async () => {
    // Style props arrive from the builder (useStyleProps), not from anything
    // Markdown.tsx does — the same free surface every recipe gets.
    const screen = await renderWithTheme(<Markdown m="md">text</Markdown>);
    const root = screen.container.firstElementChild as HTMLElement;

    // tuiTheme's --spacing-md is 0.6rem, i.e. 9.6px at a 16px root.
    expect(getComputedStyle(root).marginTop).toBe("9.6px");
  });

  it("extend threads defaultProps (invariant 1 stays load-bearing)", async () => {
    const extended = createTheme({
      extends: tuiTheme,
      components: [Markdown.extend({ defaultProps: { linkTargetBlank: true } })],
    });

    const screen = await renderWithTheme(
      <Markdown>{"[go](https://example.com)"}</Markdown>,
      undefined,
      extended,
    );

    const a = screen.container.querySelector("a");
    expect(a?.getAttribute("target")).toBe("_blank");
  });
});
