import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const locateGet = vi.fn();

vi.mock('../api', () => ({
  client: {
    api: {
      gates: {
        ':id': {
          locate: { $get: (...args: unknown[]) => locateGet(...args) },
        },
      },
    },
  },
}));

const { GateRedirect } = await import('./GateRedirect');

function ok(json: unknown) {
  return { ok: true, status: 200, json: async () => json };
}

function notFound(error: string) {
  return { ok: false, status: 404, json: async () => ({ error }) };
}

afterEach(() => {
  vi.clearAllMocks();
  window.history.pushState(null, '', '/');
});

describe('GateRedirect', () => {
  it('replaces the URL with the located run and carries the gate id along', async () => {
    window.history.pushState(null, '', '/gates/g1');
    locateGet.mockResolvedValue(ok({ repo: 'repo-tools', runId: 'run-1' }));

    renderWithProviders(<GateRedirect id="g1" />);

    await vi.waitFor(() =>
      expect(window.location.pathname + window.location.search).toBe(
        '/runs/repo-tools/run-1?gate=g1'
      )
    );
    expect(locateGet).toHaveBeenCalledWith({ param: { id: 'g1' } });
  });

  it('encodes runId and id but leaves the already-encoded repo alone', async () => {
    window.history.pushState(null, '', '/gates/g%2F1');
    locateGet.mockResolvedValue(
      ok({ repo: 'group%2Fproject', runId: 'run/1' })
    );

    renderWithProviders(<GateRedirect id="g/1" />);

    await vi.waitFor(() =>
      expect(window.location.pathname + window.location.search).toBe(
        '/runs/group%2Fproject/run%2F1?gate=g%2F1'
      )
    );
  });

  it('renders a one-line error when locate 404s, without navigating', async () => {
    window.history.pushState(null, '', '/gates/missing');
    locateGet.mockResolvedValue(notFound('not-found'));

    renderWithProviders(<GateRedirect id="missing" />);

    expect(await screen.findByTestId('gate-redirect-error')).toHaveTextContent(
      'not-found'
    );
    expect(window.location.pathname).toBe('/gates/missing');
  });

  it('renders a one-line error when the fetch itself throws', async () => {
    window.history.pushState(null, '', '/gates/g1');
    locateGet.mockRejectedValue(new Error('network down'));

    renderWithProviders(<GateRedirect id="g1" />);

    expect(await screen.findByTestId('gate-redirect-error')).toHaveTextContent(
      'locate failed'
    );
  });
});
