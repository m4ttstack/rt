import { useState } from 'react';

import { Button, LazyLoader, Paper, Stack, Text } from '@ui/core';
import { ComponentDoc } from '../../ComponentDoc';
import { DocSection } from '../../DocPage';

const USAGE = [
  "import { lazy } from 'react';",
  '',
  "import { LazyLoader } from '@ui/core';",
  '',
  "const ReportsPanel = lazy(() => import('./ReportsPanel'));",
  '',
  '<LazyLoader minHeight={240}>',
  '  <ReportsPanel />',
  '</LazyLoader>;',
].join('\n');

// Rows transcribed from src/ui/core/lazy-loader/LazyLoader.tsx
// (LazyLoaderProps).
const PROPS_ROWS = [
  {
    name: 'children',
    type: 'ReactNode',
    note: 'Required. The lazily-loaded content (typically a React.lazy component, or anything else that suspends).',
  },
  {
    name: 'loaderType?',
    type: "'centered' | 'overlay' | 'contained' | 'skeleton' | 'custom'",
    note: "Fallback shape. Default 'centered' (a Loader in a min-height box). 'overlay'/'contained' render a LoadingOverlay, 'skeleton' a Skeleton, 'custom' an arbitrary node.",
  },
  {
    name: 'loaderProps?',
    type: 'LoaderProps | LoadingOverlayProps["loaderProps"]',
    note: "Passed to the fallback Loader (centered) or the overlay's loader (overlay/contained). Overlay/contained default to a gray bars loader at 0.5 opacity.",
  },
  {
    name: 'minHeight?',
    type: 'number | string',
    note: "Centered variant only: the fallback container's minimum height, so the loader doesn't collapse to nothing (and the page doesn't shift when content lands). Default 120.",
  },
  {
    name: 'containerProps / skeletonProps / loader',
    type: 'MantineStyleProps / SkeletonProps / ReactNode',
    note: "Per-variant: containerProps sizes the 'contained' Box, skeletonProps shapes the 'skeleton', loader is the 'custom' node.",
  },
];

// A promise-throwing resource, so the demo can genuinely suspend for a
// moment on every run (a real React.lazy chunk only suspends on its first
// load; keying a fresh resource per attempt keeps the demo honest and
// repeatable).
const delayCache = new Map<number, { done: boolean; promise: Promise<void> }>();

function useDelayed(attempt: number, ms: number) {
  let entry = delayCache.get(attempt);
  if (!entry) {
    const created: { done: boolean; promise: Promise<void> } = {
      done: false,
      promise: new Promise<void>(resolve =>
        setTimeout(() => {
          created.done = true;
          resolve();
        }, ms)
      ),
    };
    delayCache.set(attempt, created);
    entry = created;
  }
  if (!entry.done) throw entry.promise;
}

function SlowPanel({ attempt }: { attempt: number }) {
  useDelayed(attempt, 1200);
  return (
    <Text size="sm" py="md" ta="center">
      Panel content arrived (attempt {attempt}). The spinner you just saw was
      LazyLoader&apos;s fallback.
    </Text>
  );
}

function LazyLoaderDemo() {
  const [attempt, setAttempt] = useState(0);

  return (
    <Stack gap="sm">
      <Button
        w="fit-content"
        variant="light"
        onClick={() => setAttempt(current => current + 1)}
      >
        {attempt === 0 ? 'Load the panel' : 'Reload the panel'}
      </Button>
      <Paper withBorder>
        {attempt === 0 ? (
          <Text size="sm" c="dimmed" py="md" ta="center">
            Nothing mounted yet.
          </Text>
        ) : (
          <LazyLoader minHeight={80} key={attempt}>
            <SlowPanel attempt={attempt} />
          </LazyLoader>
        )}
      </Paper>
    </Stack>
  );
}

export function LazyLoaderPage() {
  return (
    <ComponentDoc
      title="LazyLoader"
      lead="A Suspense boundary whose fallback is a centered Mantine Loader with a reserved minimum height -- the standard 'this panel is code-split, show a spinner until its chunk (and any data it suspends on) resolves' wrapper."
      demoIntro="Load the panel: the child suspends for about a second, LazyLoader shows its centered fallback in the reserved space, then the content lands. Each reload suspends fresh."
      demo={<LazyLoaderDemo />}
      usage={USAGE}
      usageMinHeight={210}
      propsTables={[{ title: 'Props', rows: PROPS_ROWS }]}
    >
      <DocSection title="Notes">
        <Text size="sm">
          minHeight is the point: without it, the fallback collapses to the
          spinner&apos;s own height and the page jumps when the real content
          mounts -- reserve roughly the content&apos;s final height instead. The
          fallback carries data-testid=&quot;lazy-loader-fallback&quot; for
          tests. The kit&apos;s own heavy components (CodeHighlight, CodeMirror,
          via @ui/lazy) pair their lazy chunks with this same reserve-the-height
          idea; the Lazy loading guide covers that story.
        </Text>
      </DocSection>
    </ComponentDoc>
  );
}
