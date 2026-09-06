import { readFileSync } from 'node:fs';
import { expectLoadingBarInSync } from '@mattstack/app-kit/test-utils';
import { expect, test } from 'vitest';

test('index.html inlines the package loading-bar block', () => {
  expect(() =>
    expectLoadingBarInSync(readFileSync('index.html', 'utf-8'))
  ).not.toThrow();
});
