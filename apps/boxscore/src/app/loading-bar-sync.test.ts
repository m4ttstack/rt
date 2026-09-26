import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

import { expectLoadingBarInSync } from '@mattstack/app-kit/test-utils';

test('index.html inlines the package loading-bar block', () => {
  expect(() =>
    expectLoadingBarInSync(readFileSync('index.html', 'utf-8'))
  ).not.toThrow();
});
