import { expect, test } from 'vitest';

import { matchPath } from './matchPath';

test('matches exact literal paths and returns empty params', () => {
  expect(matchPath('/', '/')).toEqual({});
  expect(matchPath('/docs', '/docs')).toEqual({});
  expect(matchPath('/demo', '/demo')).toEqual({});
});

test('ignores trailing slashes on both pattern and path', () => {
  expect(matchPath('/docs', '/docs/')).toEqual({});
  expect(matchPath('/docs/', '/docs')).toEqual({});
  expect(matchPath('/', '')).toEqual({});
});

test('captures :param segments', () => {
  expect(matchPath('/docs/:slug', '/docs/theming')).toEqual({
    slug: 'theming',
  });
  expect(matchPath('/demo/:tab', '/demo/lists')).toEqual({ tab: 'lists' });
  expect(matchPath('/a/:x/b/:y', '/a/1/b/2')).toEqual({ x: '1', y: '2' });
});

test('URI-decodes captured params', () => {
  expect(matchPath('/docs/:slug', '/docs/import%20walls')).toEqual({
    slug: 'import walls',
  });
});

test('rejects paths with a different segment count', () => {
  expect(matchPath('/docs', '/docs/theming')).toBeNull();
  expect(matchPath('/docs/:slug', '/docs')).toBeNull();
  expect(matchPath('/docs/:slug', '/docs/a/b')).toBeNull();
  expect(matchPath('/', '/docs')).toBeNull();
});

test('rejects non-matching literal segments', () => {
  expect(matchPath('/docs/:slug', '/demo/theming')).toBeNull();
  expect(matchPath('/demo', '/docs')).toBeNull();
});
