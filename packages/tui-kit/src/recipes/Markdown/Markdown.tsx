import type { ComponentProps, HTMLAttributes } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { defineComponent } from "../../builders.ts";
import classes from "./Markdown.module.css";

/** Authoring category (1 = pure styled primitive). Read off this module by
    scripts/derive.ts to build the kit's manifest; not dead code. */
export const recipeCategory = 1 as const;

/** One slot. Everything ReactMarkdown renders inside the wrapper is
    content-dependent DOM this recipe does not control, so it is styled through
    plain descendant selectors under `.root`, never through extra slots. */
const MARKDOWN_SELECTORS = ["root"] as const;

/** Stable selector surface for app-side CSS, stamped in the non-overridable
    tail so a call site cannot sever an app's `[data-part]` rules. */
const MARKDOWN_PART = "markdown";

/**
 * mr-board's `.tui-md` em-relative lengths, verbatim. They cannot be theme
 * tokens (an em is relative to the rendering element's own font size, and the
 * theme's ladders are rem/px by design) but still need a `var()` outlet to pass
 * the CSS gate, so each gets a recipe-local custom property.
 */
const MARKDOWN_SCALARS: Record<string, string> = {
  "--sb-markdown-heading-margin-top": "1.4em",
  "--sb-markdown-heading-margin-bottom": "0.6em",
  "--sb-markdown-heading-underline-pad": "0.3em",
  "--sb-markdown-h1-size": "1.6em",
  "--sb-markdown-h2-size": "1.3em",
  "--sb-markdown-h3-size": "1.1em",
  "--sb-markdown-h4-size": "1em",
  "--sb-markdown-block-margin": "0.5em",
  "--sb-markdown-list-indent": "1.4em",
  "--sb-markdown-list-item-margin": "0.2em",
  "--sb-markdown-code-size": "0.9em",
  "--sb-markdown-code-pad-block": "0.1em",
  "--sb-markdown-code-pad-inline": "0.35em",
  "--sb-markdown-pre-margin": "0.7em",
  "--sb-markdown-blockquote-margin": "0.7em",
  "--sb-markdown-blockquote-pad-block": "0.1em",
  "--sb-markdown-blockquote-pad-inline": "0.9em",
  "--sb-markdown-blockquote-border-w": "3px",
  "--sb-markdown-table-margin": "0.7em",
  "--sb-markdown-cell-pad-block": "0.3em",
  "--sb-markdown-cell-pad-inline": "0.6em",
  "--sb-markdown-hr-margin": "1em",
};

/** Markdown's own props; `MarkdownProps` below is the full public surface. */
export interface MarkdownOwnProps {
  /** Raw markdown source, parsed by ReactMarkdown + remarkGfm. */
  children: string;
  /** Renders every link with `target="_blank" rel="noopener noreferrer"`. */
  linkTargetBlank?: boolean;
}

/**
 * ADOPTION HAZARD: at a call site whose prose block was never `.tui-md`,
 * dropping this recipe in is NOT a no-op — `.root`'s own font/size/line-height
 * sit directly on the wrapper and beat an ancestor's inherited font regardless
 * of layer order. Pass the Styles API's `unstyled` prop there to preserve
 * parity; `data-part` is still stamped. See docs/decisions.md.
 */
type MarkdownProps_ = MarkdownOwnProps & Omit<HTMLAttributes<HTMLDivElement>, "children">;

export const Markdown = defineComponent<
  MarkdownProps_,
  typeof MARKDOWN_SELECTORS,
  readonly [],
  readonly [],
  HTMLDivElement
>({
  name: "Markdown",
  selectors: MARKDOWN_SELECTORS,
  classes,
  // Nothing to merge with the builder's automatic autoVars output, which a
  // recipe-supplied resolver replaces: Markdown declares no `variants`.
  vars: () => ({
    root: { ...MARKDOWN_SCALARS },
  }),
  render: ({ props, getStyles, ref }) => {
    const {
      children,
      linkTargetBlank,
      classNames: _classNames,
      styles: _styles,
      vars: _vars,
      attributes: _attributes,
      unstyled: _unstyled,
      ...rest
    } = props;

    return (
      <div
        ref={ref}
        {...rest}
        {...getStyles("root")}
        data-part={MARKDOWN_PART}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={
            linkTargetBlank
              ? {
                  a: ({ node: _node, ...aProps }) => (
                    <a {...aProps} target="_blank" rel="noopener noreferrer" />
                  ),
                }
              : undefined
          }
        >
          {children}
        </ReactMarkdown>
      </div>
    );
  },
});

/** Everything a call site may pass, own props included. */
export type MarkdownProps = ComponentProps<typeof Markdown>;

/** No-op `.extend({})` a consumer's `createTheme({ components })` starts from. */
export const markdownTheme = Markdown.extend({});
