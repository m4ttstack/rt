import { HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';

/**
 * Token colours for every language the kit's CodeMirror offers, built from
 * `--tk-text-*` role tokens (docs/ui-authoring.md) instead of hex. Installed
 * as a non-fallback highlighter (see `syntaxHighlighting` call site), which
 * CodeMirror gives full precedence over `basicSetup`'s fallback
 * `defaultHighlightStyle` -- so JSON strings read as `--tk-text-cyan`
 * instead of the same red family as error text in every scheme.
 */
export const kitHighlightStyle = /* @__PURE__ */ HighlightStyle.define([
  {
    tag: [tags.propertyName, tags.definition(tags.propertyName)],
    color: 'var(--tk-text-accent)',
  },
  {
    tag: [tags.definition(tags.variableName)],
    color: 'var(--tk-text-accent)',
  },
  {
    tag: [tags.string, tags.special(tags.string)],
    color: 'var(--tk-text-cyan)',
  },
  { tag: [tags.number, tags.literal], color: 'var(--tk-text-gold)' },
  {
    tag: [tags.typeName, tags.className, tags.namespace],
    color: 'var(--tk-text-gold)',
  },
  {
    tag: [tags.bool, tags.null, tags.atom],
    color: 'var(--tk-text-purple)',
  },
  {
    tag: [
      tags.keyword,
      tags.controlKeyword,
      tags.operatorKeyword,
      tags.definitionKeyword,
      tags.moduleKeyword,
    ],
    color: 'var(--tk-text-purple)',
  },
  { tag: tags.comment, color: 'var(--tk-text-3)', fontStyle: 'italic' },
  {
    tag: [
      tags.punctuation,
      tags.bracket,
      tags.squareBracket,
      tags.brace,
      tags.paren,
      tags.separator,
    ],
    color: 'var(--tk-text-3)',
  },
  { tag: tags.invalid, color: 'var(--tk-text-bad-vivid)' },
]);
