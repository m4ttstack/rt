import { Box, Paper } from '@mattstack/app-kit/core';
import { CodeHighlight } from '@mattstack/app-kit/lazy';

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
          styles={{ pre: { overflowX: 'auto' } }}
        />
      </Box>
    </Paper>
  );
}
