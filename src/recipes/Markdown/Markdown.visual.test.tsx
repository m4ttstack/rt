import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { renderWithTheme } from "../../../test/test-utils.tsx";
import { Markdown } from "./Markdown.tsx";

/**
 * Visual tier for the Markdown recipe.
 *
 *  * NO TRANSITION/ANIMATION FREEZE IS INSTALLED HERE. Markdown.module.css
 * declares neither a `transition` nor an `animation`, so there is nothing to
 * interpolate through mid-capture — the same reasoning Icon's own visual test
 * states for the same absence.
 *
 * One fixture exercises every lifted `.tui-md` element in a single document:
 * headings (with the first-child margin-reset case), a link, an ordered and
 * unordered list, inline code, a fenced code block, a blockquote, a
 * remark-gfm table, and a horizontal rule.
 */

/** Mounts into a fresh container that already carries `dark` when asked. */
async function renderFixture(ui: ReactNode, { dark = false } = {}) {
  await page.viewport(760, 900);

  const container = document.createElement("div");
  if (dark) container.classList.add("dark");
  document.body.appendChild(container);

  const screen = await renderWithTheme(ui, { container });
  await document.fonts.ready;
  return screen;
}

const SAMPLE = [
  "# Review notes",
  "",
  "Some **bold**, some _italic_, and some `inline code`. See the [board](https://example.com) for context.",
  "",
  "## Findings",
  "",
  "1. First finding, numbered.",
  "2. Second finding, numbered.",
  "",
  "- unordered point one",
  "- unordered point two",
  "",
  "### A code block",
  "",
  "```ts",
  "const x: number = 1;",
  "```",
  "",
  "> A blockquote calling out a risk.",
  "",
  "| column a | column b |",
  "| --- | --- |",
  "| 1 | 2 |",
  "| 3 | 4 |",
  "",
  "---",
  "",
  "#### A fourth-level heading",
].join("\n");

const surface = {
  display: "block",
  padding: "1.5rem",
  background: "var(--bg)",
  maxWidth: "700px",
} as const;

function SampleDoc() {
  return (
    <div data-testid="doc" style={surface}>
      <Markdown>{SAMPLE}</Markdown>
    </div>
  );
}

describe("Markdown (visual)", () => {
  it("the full sample document matches its baseline in light mode", async () => {
    await renderFixture(<SampleDoc />);

    await expect(page.getByTestId("doc")).toMatchScreenshot("markdown-doc-light");
  });

  it("the full sample document matches its baseline in dark mode", async () => {
    await renderFixture(<SampleDoc />, { dark: true });

    await expect(page.getByTestId("doc")).toMatchScreenshot("markdown-doc-dark");
  });
});
