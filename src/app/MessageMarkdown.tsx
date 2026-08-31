import { useMemo } from 'react';
import type { Element } from 'hast';
import Markdown, { type Components, type Options } from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { CodeBlock } from './components/CodeBlock';
import { remarkMentions } from './remark-mentions';
import classes from './transcript-prose.module.css';

/** 12.16px at CodeHighlight's 1.7 line height, plus its 4.8px paddings. */
const CODE_LINE_PX = 20.7;
const CODE_PAD_PX = 9.6;

/** react-markdown passes its own `node` prop to every component override;
    intrinsic elements don't take one, so drop it before spreading the rest. */
function withoutNode<T extends { node?: unknown }>(props: T): Omit<T, 'node'> {
  const rest: Partial<T> = { ...props };
  delete rest.node;
  return rest as Omit<T, 'node'>;
}

function fenceOf(node: Element | undefined): {
  code: string;
  language: string;
} {
  const codeEl = node?.children.find(
    (child): child is Element =>
      child.type === 'element' && child.tagName === 'code'
  );
  const raw = codeEl?.properties?.className;
  const names = (Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]).map(
    String
  );
  const language =
    names.find(n => n.startsWith('language-'))?.slice('language-'.length) ??
    'text';
  const code = (codeEl?.children ?? [])
    .map(child => (child.type === 'text' ? child.value : ''))
    .join('')
    .replace(/\n$/, '');
  return { code, language };
}

const components: Components = {
  a: props => <a {...withoutNode(props)} target="_blank" rel="noreferrer" />,
  // The viewer never fetches a third-party URL: an image is its alt text,
  // linking to the file for whoever wants it.
  img: ({ src, alt }) => (
    <a
      href={typeof src === 'string' ? src : undefined}
      target="_blank"
      rel="noreferrer"
    >
      {alt || 'image'}
    </a>
  ),
  pre: ({ node }) => {
    const { code, language } = fenceOf(node);
    const lines = code.split('\n').length;
    return (
      <CodeBlock
        code={code}
        language={language}
        minHeight={Math.min(
          400,
          Math.round(lines * CODE_LINE_PX + CODE_PAD_PX)
        )}
      />
    );
  },
  table: props => (
    <div className={classes.tbl}>
      <table {...withoutNode(props)} />
    </div>
  ),
  // The prose module only styles h1-h3; a level-4+ heading in a posted
  // message flattens to h3 rather than growing an unstyled tag.
  h4: props => <h3 {...withoutNode(props)} />,
  h5: props => <h3 {...withoutNode(props)} />,
  h6: props => <h3 {...withoutNode(props)} />,
};

export interface MessageMarkdownProps {
  body: string;
  mentions: string[];
  humanHandle?: string;
}

/** One message body. Raw HTML is skipped, links keep react-markdown's
    default protocol allowlist, and the caller supplies the `prose` wrapper. */
export function MessageMarkdown({
  body,
  mentions,
  humanHandle,
}: MessageMarkdownProps) {
  const remarkPlugins = useMemo<NonNullable<Options['remarkPlugins']>>(
    () => [
      remarkGfm,
      [
        remarkMentions,
        {
          handles: mentions,
          me: humanHandle,
          className: classes.at,
          meClassName: classes.atMe,
        },
      ],
    ],
    [mentions, humanHandle]
  );
  return (
    <Markdown remarkPlugins={remarkPlugins} skipHtml components={components}>
      {body}
    </Markdown>
  );
}
