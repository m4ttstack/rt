import { serializeIdentity } from '@mattstack/rt-client/identity';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';

import { useAppRoute, type AppRoute } from './routes';

function Probe() {
  return <span data-testid="route">{JSON.stringify(useAppRoute())}</span>;
}

/** Renders `useAppRoute` at a fixed location and returns the structured
    route. wouter's memory location makes the match deterministic without
    touching window.history, so each call is isolated. */
function routeAt(path: string): AppRoute {
  const { hook } = memoryLocation({ path });
  const { container, unmount } = render(
    <Router hook={hook}>
      <Probe />
    </Router>
  );
  const route = JSON.parse(
    container.querySelector('[data-testid="route"]')!.textContent!
  ) as AppRoute;
  unmount();
  return route;
}

describe('useAppRoute: /config/:key', () => {
  it('matches a config key route', () => {
    expect(routeAt('/config/rt.runsPruneDays')).toEqual({
      name: 'config',
      key: 'rt.runsPruneDays',
    });
  });

  it('falls through to not-found with no key segment', () => {
    expect(routeAt('/config/')).toEqual({ name: 'not-found' });
  });
});

describe('useAppRoute: /runs/:repo/:runId', () => {
  it('a serialized identity survives the route unchanged (wouter hands the param back raw; the route re-canonicalizes)', () => {
    const wire = serializeIdentity({
      kind: 'remote',
      id: 'gitlab.com/group/repo',
    });
    expect(routeAt(`/runs/${wire}/run-1`)).toEqual({
      name: 'run',
      repo: wire,
      runId: 'run-1',
    });
  });

  it('a legacy bare-name repo passes through unchanged', () => {
    expect(routeAt('/runs/repo-tools/run-1')).toEqual({
      name: 'run',
      repo: 'repo-tools',
      runId: 'run-1',
    });
  });

  it('a malformed percent-escape in the repo reads as not-found instead of throwing', () => {
    expect(routeAt('/runs/%E0%A4%A/run-1')).toEqual({ name: 'not-found' });
  });
});
