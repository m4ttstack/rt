import { serializeIdentity } from '@mattstack/rt-client';
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

describe('matchRoute: /runs/:repo/:runId', () => {
  it('a serialized identity survives the route unchanged (matchPath decodes; the route re-canonicalizes)', () => {
    const wire = serializeIdentity({
      kind: 'remote',
      id: 'gitlab.com/group/repo',
    });
    expect(matchRoute(`/runs/${wire}/run-1`)).toEqual({
      name: 'run',
      repo: wire,
      runId: 'run-1',
    });
  });

  it('a legacy bare-name repo passes through unchanged', () => {
    expect(matchRoute('/runs/repo-tools/run-1')).toEqual({
      name: 'run',
      repo: 'repo-tools',
      runId: 'run-1',
    });
  });
});
