import type { ComponentProps, HTMLAttributes, Ref } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { defineComponent } from "../../builders.ts";
import classes from "./Markdown.module.css";

/**
 * Authoring category from soribashi's recipe conversion playbook's four
 * categories (soribashi
 * docs/superpowers/specs/2026-04-26-recipe-conversion-playbook.md § 2, reached
 * through .claude/skills/authoring-a-recipe/SKILL.md § 2):
 * 1 = pure styled primitive (§ 2.1) — one wrapper element, one style slot, no
 * lifecycle of its own. `defineComponent`, not `definePolymorphicComponent`:
 * mr-board's Markdown always renders its prose into a `<div>`; there is no
 * other element this would ever render as (Icon's/Panel's own criterion).
 *
 * Read by scripts/derive.ts to build the kit's manifest; not itself derived,
 * since it records an authoring decision, not a fact recoverable from
 * RecipeMeta or the CSS.
 */
export const recipeCategory = 1 as const;

/**
 * The recipe's style slots. Markdown has exactly one addressable element of
 * its own — the wrapper `<div>` that carries `.tui-md`'s lifted typography
 * (Markdown.module.css). Everything ReactMarkdown renders INSIDE it (`h1`,
 * `p`, `code`, `table`, ...) is markdown-content-dependent DOM this recipe
 * does not control, so it is styled through plain descendant selectors under
 * `.root` in the module, never through additional `getStyles()` slots.
 */
const MARKDOWN_SELECTORS = ["root"] as const;

/**
 * tui-kit's `data-part` convention (design spec § "Parity mechanics" 1;
 * controller ruling R7 — task-8-report.md § 5, which SUPERSEDES this task's
 * own brief: the brief's `root` is the LOSING convention).
 *
 *   root slot -> "markdown"   (the drop-in replacement for `.tui-md`)
 *
 * Module-private (like Icon's single value, unlike Chip's/Panel's exported
 * records): Markdown is single-slot, so there is only ever one value and no
 * adoption pass needs a second name to cross-reference.
 *
 * THE SPREAD POSITION IS PART OF THE CONVENTION: stamped in the
 * NON-OVERRIDABLE TAIL, after `{...rest}`, alongside `getStyles`. Pinned by
 * Markdown.test.tsx's "a consumer-supplied data-part does not win".
 */
const MARKDOWN_PART = "markdown";

/**
 * Every `em`-relative length `.tui-md`'s rules use, plus the one outlier
 * (`blockquote`'s 3px border), routed through recipe-local `--sb-markdown-*`
 * custom properties — see Markdown.module.css's own comment for why these
 * cannot be theme tokens (an em is deliberately relative to the rendering
 * element's own font size; src/theme.ts's spacing ladder is rem/px-only by
 * design) and why they still need a `var()` outlet to pass the CSS gate
 * (`test/no-hardcoded-values.test.ts`'s length scanner has no `em`
 * exemption). Unconditional (not keyed by props), the same shape Panel's
 * `PANEL_TITLE_SCALARS` and Chip's `CHIP_SCALARS` use for their own fixed
 * scalars.
 *
 * Every value below is mr-board's own `.tui-md` literal, unchanged — see
 * Markdown.module.css's header comment for the full source-to-token map.
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

/**
 * The recipe's OWN props, byte-identical in shape to mr-board's
 * `src/client/ui/Markdown.tsx` call signature: `children` (the raw markdown
 * source, a string — not `ReactNode`, since ReactMarkdown parses it itself)
 * and `linkTargetBlank`. `className` is NOT redeclared here, the same "own
 * props hold only what the recipe itself defines" split Chip/Panel/Icon use
 * — the builder's own `{...rest}`/universal-style-props surface already
 * accepts it.
 */
export interface MarkdownOwnProps {
  /** Raw markdown source, parsed by ReactMarkdown + remarkGfm. */
  children: string;
  /**
   * Renders every markdown link to open in a new tab
   * (`target="_blank" rel="noopener noreferrer"`). Mirrors mr-board's own
   * flag exactly: used for comment bodies (CommentsDrawer), left off for
   * inline review write-ups (ReviewModal).
   */
  linkTargetBlank?: boolean;
}

type MarkdownProps_ = MarkdownOwnProps & Omit<HTMLAttributes<HTMLDivElement>, "children">;

export const Markdown = defineComponent<
  MarkdownProps_,
  typeof MARKDOWN_SELECTORS,
  readonly [],
  readonly []
>({
  name: "Markdown",
  selectors: MARKDOWN_SELECTORS,
  classes,
  // A RECIPE-SUPPLIED `vars` RESOLVER REPLACES THE BUILDER'S AUTOMATIC
  // autoVars CALL (skill § 4 + § 10) — but Markdown declares no `variants`,
  // so there is no auto-derived output to preserve/merge here
  // (task-8-report.md § 4's second corollary): this `vars` key is only the
  // em-relative scalars above.
  vars: () => ({
    root: { ...MARKDOWN_SCALARS },
  }),
  render: ({ props, getStyles, ref }) => {
    // The Styles API's own config keys are consumed internally by useStyles
    // and are not valid DOM attributes, so they are stripped here the same
    // way every prior recipe strips them. No vocabulary-axis destructure is
    // needed: Markdown opts into no axes.
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
        // KNOWN SORIBASHI LIMITATION (SORI-14, filed against Icon's svg
        // root): every builder hardcodes `Ref<HTMLElement>` on the render
        // ctx; a `<div>` narrows to `Ref<HTMLDivElement>` in JSX, so the cast
        // is required here the same way Icon's/Segmented's roots need one.
        ref={ref as Ref<HTMLDivElement>}
        // Band 2: everything the consumer passed. No band-1 presentation
        // defaults — unlike Icon's svg attributes, this wrapper has nothing
        // that reads as a courtesy default; its whole presentation is the
        // stylesheet.
        {...rest}
        // Band 3, the NON-OVERRIDABLE TAIL — nothing below may be replaced
        // from a call site. THE SPREAD POSITION IS PART OF THE CONVENTION;
        // see MARKDOWN_PART's comment.
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

/**
 * The recipe's theme-entry convenience export — the no-op `.extend({})` a
 * consumer's `createTheme({ components: [...] })` can start from.
 */
export const markdownTheme = Markdown.extend({});
