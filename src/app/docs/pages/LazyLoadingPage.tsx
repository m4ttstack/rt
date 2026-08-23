import { Anchor, Text } from '@ui/core';
import { CodeBlock } from '../../components/CodeBlock';
import { Link } from '../../router/Link';
import { DocPage, DocSection } from '../DocPage';
import { docsPath } from '../docsNav';

const WRAPPERS_SNIPPET = [
  "import { CodeHighlight, CodeMirror } from '@ui/lazy';",
  '',
  '// Both mount behind React.lazy inside a LazyLoader (a Suspense boundary',
  '// with a centered Loader). Their real dependencies are fetched only when',
  '// one first renders -- never as part of the entry chunk.',
  '<CodeHighlight code={snippet} language="tsx" />',
  '<CodeMirror value={code} onChange={setCode} language="json" height="160px" />',
].join('\n');

const LOAD_ONCE_SNIPPET = [
  "import { loadOnce } from '@ui/lazy';",
  '',
  '// Dedupes any dynamic import (or async load) by key: concurrent callers',
  '// share one promise, and a rejected load is evicted so the next call',
  '// retries instead of replaying the failure.',
  "const confetti = await loadOnce('confetti', () => import('./confetti'));",
].join('\n');

export function LazyLoadingPage() {
  return (
    <DocPage
      title="Lazy loading"
      lead="Syntax highlighting (@mantine/code-highlight) and the CodeMirror editor (codemirror + @codemirror/*) are the kit's two heaviest dependencies, so @ui/lazy ships them as React.lazy wrappers that physically cannot end up in the entry bundle."
    >
      <DocSection title="The lazy wrappers">
        <Text size="sm">
          Only a type-only import crosses the module boundary at build time, and
          the import wall bans importing the underlying packages directly
          anywhere else. This page&apos;s own code blocks load this way (the
          CodeMirror chunk is around 500 kB minified in this repo&apos;s build
          -- the point of keeping it out of the first paint). Wrappers reserve a
          min-height via{' '}
          <Anchor
            component={Link}
            href={docsPath('components/lazy-loader')}
            size="sm"
            fw={500}
          >
            LazyLoader
          </Anchor>{' '}
          so nothing shifts when a chunk resolves.
        </Text>
        <CodeBlock code={WRAPPERS_SNIPPET} language="tsx" minHeight={172} />
      </DocSection>

      <DocSection title="loadOnce: dedup for any dynamic import">
        <Text size="sm">
          loadOnce (also from @ui/lazy) is a dependency-free, module-level cache
          keyed by string. A successful load stays cached indefinitely; a
          rejected load is evicted before rethrowing, so a flaky chunk load (a
          network blip) is retryable on the next call instead of replaying the
          same rejection forever.
        </Text>
        <CodeBlock code={LOAD_ONCE_SNIPPET} language="tsx" minHeight={150} />
      </DocSection>
    </DocPage>
  );
}
