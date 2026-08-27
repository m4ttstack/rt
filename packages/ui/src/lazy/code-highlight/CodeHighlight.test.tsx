import { screen } from '@testing-library/react';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { CodeHighlight } from './CodeHighlight';

// `CodeHighlight` wraps `@mantine/code-highlight`'s own `CodeHighlight`
// behind `React.lazy`, so mounting it renders the `LazyLoader` Suspense
// fallback first, then swaps in the real component once the dynamic
// `import('@mantine/code-highlight')` resolves.
//
// Both assertions live in one test: `CodeHighlightLazy` is a module-level
// `React.lazy(...)`, so once its promise has resolved once in this test
// file's run, later renders skip the fallback -- asserting the fallback in
// a *separate*, later test would be order-dependent on whether an earlier
// test already resolved it.

test('shows the LazyLoader fallback, then renders the highlighted code once the lazy import resolves', async () => {
  renderWithProviders(<CodeHighlight code="const x = 1;" language="tsx" />);

  // Synchronous assertion, right after render and before any `await` -- the
  // dynamic import can't have resolved yet.
  expect(screen.getByTestId('lazy-loader-fallback')).toBeTruthy();

  expect(await screen.findByText('const x = 1;')).toBeTruthy();
});
