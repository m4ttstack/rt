import type { Root, Text } from 'mdast';
import { visit } from 'unist-util-visit';

export interface MentionOptions {
  /** The message's own `mentions` list: the only handles that count. */
  handles: string[];
  /** The human's handle: its mention gets `meClassName` and `data-me`. */
  me?: string;
  className: string;
  meClassName: string;
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * `@handle` -> a span, only for handles the message lists. Runs on text
 * nodes after remark has parsed the body, so an `@` inside a code span,
 * a fence or a link label is never reached. The `hName`/`hProperties`
 * data is what mdast-util-to-hast turns into the element.
 */
export function remarkMentions(options: MentionOptions) {
  const { handles, me, className, meClassName } = options;
  if (handles.length === 0) return () => {};
  const pattern = new RegExp(
    `@(${handles.map(escapeForRegExp).join('|')})(?![a-z0-9._-])`,
    'g'
  );
  return (tree: Root) => {
    visit(tree, 'text', (node: Text, index, parent) => {
      if (!parent || index === undefined || parent.type === 'link') return;
      const parts: Text[] = [];
      let last = 0;
      let match: RegExpExecArray | null;
      pattern.lastIndex = 0;
      while ((match = pattern.exec(node.value))) {
        if (match.index > last) {
          parts.push({
            type: 'text',
            value: node.value.slice(last, match.index),
          });
        }
        const handle = match[1]!;
        const isMe = handle === me;
        parts.push({
          type: 'text',
          value: `@${handle}`,
          data: {
            hName: 'span',
            hProperties: {
              className: isMe ? [className, meClassName] : [className],
              'data-mention': handle,
              ...(isMe ? { 'data-me': 'true' } : {}),
            },
          },
        });
        last = pattern.lastIndex;
      }
      if (parts.length === 0) return;
      if (last < node.value.length) {
        parts.push({ type: 'text', value: node.value.slice(last) });
      }
      parent.children.splice(index, 1, ...parts);
      return index + parts.length;
    });
  };
}
