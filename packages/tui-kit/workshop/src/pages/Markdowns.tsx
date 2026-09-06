import { Markdown } from "@mattstack/tui-kit";

/**
 * The Markdown recipe's workshop page.
 *
 * Imports from the BARREL (`@mattstack/tui-kit`, aliased to `../src` by
 * workshop/vite.config.ts), never a deep `../../src/recipes/…` path — same
 * rule Chips.tsx/Icons.tsx/Panels.tsx follow.
 *
 * No scheme toggle of its own — the sidebar's Dark button flips `.dark` on
 * <html>, which is what proves the lifted `.tui-md` typography (code/pre
 * backgrounds, blockquote/table borders, link colour) holds up in both
 * schemes.
 */

const SAMPLE = [
  "# Review notes",
  "",
  "Some **bold**, some _italic_, and some `inline code`. See the [board](https://example.com) for context — this link opens in the same tab.",
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

const NOTE = "A comment body with a [link](https://example.com) that opens in a new tab.";

const surface = {
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  background: "var(--panel)",
  padding: "1rem 1.25rem",
  marginTop: "0.75rem",
} as const;

export function Markdowns() {
  return (
    <div>
      <h1>Markdown</h1>
      <p>
        A thin wrapper over <code>ReactMarkdown</code> + <code>remark-gfm</code>,
        carrying mr-board's <code>.tui-md</code> prose typography as its own
        stylesheet. <code>linkTargetBlank</code> renders every markdown link to
        open in a new tab — off by default (review write-ups), on for comment
        bodies.
      </p>

      <h2 style={{ marginTop: "2rem" }}>default (links open inline)</h2>
      <div style={surface}>
        <Markdown>{SAMPLE}</Markdown>
      </div>

      <h2 style={{ marginTop: "2rem" }}>linkTargetBlank</h2>
      <div style={surface}>
        <Markdown linkTargetBlank>{NOTE}</Markdown>
      </div>

      <h2 style={{ marginTop: "2rem" }}>data-part</h2>
      <p>
        The wrapper carries <code>data-part="markdown"</code> — the tui-kit
        convention that replaces the hashed CSS-module class name as
        mr-board's cross-boundary selector hook: <code>.tui-md</code> becomes{" "}
        <code>[data-part="markdown"]</code>. Everything ReactMarkdown itself
        renders inside it (headings, code, tables, ...) is plain, unaddressed
        DOM — the recipe styles it through descendant selectors under its one
        slot, not through additional <code>data-part</code> values.
      </p>
    </div>
  );
}
