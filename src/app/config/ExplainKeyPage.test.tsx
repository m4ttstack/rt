import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@ui/storybook/test-utils';

vi.mock('../api', () => ({
  client: {
    api: {
      settings: {
        defs: { $get: vi.fn() },
        explain: {
          ':key': {
            $get: vi.fn(async () => ({
              ok: true,
              status: 200,
              json: async () => ({
                def: {
                  key: 'rt.runsPruneDays',
                  type: 'number',
                  scopes: ['user', 'machine'],
                  merge: 'replace',
                  secret: false,
                  teamLocked: false,
                  repoScoped: false,
                  writable: true,
                  description: 'Days before pruning.',
                  hasDefault: true,
                  defaultValue: 30,
                },
                rows: [
                  { scope: 'default', file: null, present: true, value: 30 },
                  {
                    scope: 'user',
                    file: '/stores/user.jsonc',
                    present: true,
                    value: 45,
                  },
                  {
                    scope: 'machine',
                    file: '/stores/machine.jsonc',
                    present: false,
                  },
                ],
              }),
            })),
          },
        },
        set: { $post: vi.fn() },
      },
    },
  },
}));

const { ExplainKeyPage } = await import('./ExplainKeyPage');

function renderExplain(settingKey = 'rt.runsPruneDays') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <ExplainKeyPage settingKey={settingKey} />
    </QueryClientProvider>
  );
}

describe('ExplainKeyPage', () => {
  it('renders the plain sentence first', async () => {
    renderExplain();

    await screen.findByText(/is 45 because the user layer sets it/);
  });

  it('renders every rung weakest first, with an absent rung labeled', async () => {
    renderExplain();

    await screen.findByText(/is 45 because the user layer sets it/);

    const rows = screen.getAllByTestId(/^layer-row-/);
    expect(rows.map(row => row.dataset.testid)).toEqual([
      'layer-row-default',
      'layer-row-user:/stores/user.jsonc',
      'layer-row-machine:/stores/machine.jsonc',
    ]);

    const machineRow = screen.getByTestId(
      'layer-row-machine:/stores/machine.jsonc'
    );
    expect(machineRow).toHaveTextContent('not set at this layer');
  });

  it('highlights the winner and strikes the overridden value', async () => {
    renderExplain();

    await screen.findByText(/is 45 because the user layer sets it/);

    const winnerRow = screen.getByTestId(
      'layer-row-user:/stores/user.jsonc'
    );
    expect(winnerRow.dataset.winner).toBe('true');

    const overriddenRow = screen.getByTestId('layer-row-default');
    expect(overriddenRow.dataset.overridden).toBe('true');
  });

  it('names the real command in the provenance line', async () => {
    renderExplain();

    await screen.findByText(/is 45 because the user layer sets it/);

    expect(
      screen.getByText('rt settings explain rt.runsPruneDays')
    ).toBeInTheDocument();
  });
});
