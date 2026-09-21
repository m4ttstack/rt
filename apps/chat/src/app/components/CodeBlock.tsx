import { Box, Paper } from '@mattstack/app-kit/core';
import { CodeHighlight } from '@mattstack/app-kit/lazy';

/** A fence's line box, as a ratio of its own font size. `MessageMarkdown`
    reserves height for a folded fence from this and the `md` step. */
export const CODE_LINE_HEIGHT = 1.7;

export interface CodeBlockProps {
  code: string;
  language: string;
  /** Reserved height for the lazily-loaded highlighter, so the page doesn't shift when its chunk resolves. */
  minHeight: number;
  /** Show the built-in copy button. @default true */
  withCopyButton?: boolean;
}

/**
 * A `CodeHighlight` inside a bordered, fixed-min-height frame. The
 * highlighter is lazily loaded (`@mattstack/app-kit/lazy`), so the wrapper reserves the
 * block's approximate final height up front -- no layout shift when the
 * chunk resolves.
 */
export function CodeBlock({
  code,
  language,
  minHeight,
  withCopyButton = true,
}: CodeBlockProps) {
  return (
    <Paper
      withBorder
      data-testid="code-block"
      style={{ overflow: 'hidden', position: 'relative' }}
    >
      <Box style={{ minHeight }}>
        <CodeHighlight
          code={code}
          language={language}
          withCopyButton={withCopyButton}
          styles={{
            pre: {
              overflowX: 'auto',
              fontSize: 'var(--mantine-font-size-md)',
              lineHeight: CODE_LINE_HEIGHT,
            },
          }}
        />
      </Box>
    </Paper>
  );
}
