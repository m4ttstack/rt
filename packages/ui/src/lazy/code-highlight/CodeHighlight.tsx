import { lazy } from 'react';
import type { CodeHighlightProps as MantineCodeHighlightProps } from '@mantine/code-highlight';

import { LazyLoader } from '@mattstack/app-kit/core';

const CodeHighlightLazy = lazy(async () => {
  const [module] = await Promise.all([
    import('@mantine/code-highlight'),
    import('@mantine/code-highlight/styles.css'),
  ]);
  return { default: module.CodeHighlight };
});

export type CodeHighlightProps = MantineCodeHighlightProps;

/**
 * `@mantine/code-highlight`'s `CodeHighlight`, lazily loaded behind
 * `React.lazy` so the highlighting engine stays out of the app's entry
 * bundle -- only a type-only import of `CodeHighlightProps` crosses this
 * module boundary at build time; the real `@mantine/code-highlight` module
 * is only fetched once a `<CodeHighlight>` is first rendered.
 *
 * Passes props straight through (no legacy `withPaper`/`paperProps`/
 * `codeBackgroundColor` wrapping) -- callers wanting a `Paper` surface
 * around it can wrap it themselves with `@mattstack/app-kit/core`'s `Paper`.
 */
export function CodeHighlight(props: CodeHighlightProps) {
  return (
    <LazyLoader minHeight={60}>
      <CodeHighlightLazy {...props} />
    </LazyLoader>
  );
}
