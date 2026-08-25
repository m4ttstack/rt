import { describe, expect, it } from 'vitest';

import { matchRoute } from './routes';

describe('matchRoute: /config/:key', () => {
  it('matches a config key route', () => {
    expect(matchRoute('/config/rt.runsPruneDays')).toEqual({
      name: 'config',
      key: 'rt.runsPruneDays',
    });
  });

  it('falls through to not-found with no key segment', () => {
    expect(matchRoute('/config/')).toEqual({ name: 'not-found' });
  });
});
