import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@ui/storybook/test-utils';

const artifactGet = vi.fn();

vi.mock('../api', () => ({
  client: {
    api: {
      runs: {
        ':repo': {
          ':runId': {
            artifact: { $get: (...args: unknown[]) => artifactGet(...args) },
          },
        },
      },
    },
  },
}));

const { FailureExcerpt } = await import('./FailureExcerpt');

function render() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <FailureExcerpt
        repo="repo-tools"
        runId="run-1"
        detailPath="/fake/runs/repo-tools/run-1/implement.log"
      />
    </QueryClientProvider>
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('FailureExcerpt', () => {
  it('names the still-outside case honestly instead of surfacing a raw 403', async () => {
    artifactGet.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({
        error: 'artifact path is outside the run directory',
      }),
    });

    render();

    const error = await screen.findByTestId('failure-excerpt-error');
    expect(error).toHaveTextContent(
      'This artifact lives outside the run directory.'
    );
    expect(error).not.toHaveTextContent('403');
    expect(
      screen.getByText('open full artifact in editor')
    ).toBeInTheDocument();
  });

  it('links to the editor with a single slash before an absolute path', async () => {
    artifactGet.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ lines: ['boom'], truncated: false }),
    });

    render();

    const link = await screen.findByText('open full artifact in editor');
    expect(link.closest('a')).toHaveAttribute(
      'href',
      'vscode://file/fake/runs/repo-tools/run-1/implement.log'
    );
  });
});
