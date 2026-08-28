import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';

const explainGet = vi.fn();
const setPost = vi.fn();

vi.mock('../api', () => ({
  client: {
    api: {
      settings: {
        defs: { $get: vi.fn() },
        explain: {
          ':key': { $get: (...args: unknown[]) => explainGet(...args) },
        },
        set: { $post: (...args: unknown[]) => setPost(...args) },
      },
    },
  },
}));

const { ExplainKeyPage } = await import('./ExplainKeyPage');

function ok(data: unknown) {
  return { ok: true, status: 200, json: async () => data };
}

function fail(status: number, error: string) {
  return { ok: false, status, json: async () => ({ error }) };
}

const EXPLAIN_FIXTURE = {
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
    { scope: 'user', file: '/stores/user.jsonc', present: true, value: 45 },
    { scope: 'machine', file: '/stores/machine.jsonc', present: false },
  ],
};

// The default every test starts from; individual tests override setPost as needed.
explainGet.mockResolvedValue(ok(EXPLAIN_FIXTURE));

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

async function stageWithin(container: HTMLElement, newValue: string) {
  await userEvent.click(
    within(container).getByRole('button', { name: /edit/i })
  );
  const input = within(container).getByRole('textbox', { name: /new value/i });
  await userEvent.clear(input);
  await userEvent.type(input, newValue);
  await userEvent.click(
    within(container).getByRole('button', { name: /^stage$/i })
  );
}

afterEach(() => {
  vi.clearAllMocks();
  explainGet.mockResolvedValue(ok(EXPLAIN_FIXTURE));
});

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

    const winnerRow = screen.getByTestId('layer-row-user:/stores/user.jsonc');
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

  it("applying one of two staged rows closes only that row's staged block", async () => {
    setPost.mockResolvedValue(ok({ rows: [] }));

    renderExplain();
    await screen.findByText(/is 45 because the user layer sets it/);

    const userRow = screen.getByTestId('layer-row-user:/stores/user.jsonc');
    const machineRow = screen.getByTestId(
      'layer-row-machine:/stores/machine.jsonc'
    );

    await stageWithin(userRow, '14');
    await stageWithin(machineRow, '7');

    expect(
      within(userRow).getByTestId('layer-stage-user:/stores/user.jsonc')
    ).toBeInTheDocument();
    expect(
      within(machineRow).getByTestId(
        'layer-stage-machine:/stores/machine.jsonc'
      )
    ).toBeInTheDocument();

    await userEvent.click(
      within(userRow).getByRole('button', { name: /^apply$/i })
    );

    await waitFor(() => {
      expect(
        within(userRow).queryByTestId('layer-stage-user:/stores/user.jsonc')
      ).not.toBeInTheDocument();
    });
    expect(
      within(machineRow).getByTestId(
        'layer-stage-machine:/stores/machine.jsonc'
      )
    ).toBeInTheDocument();
  });

  it('a failed apply shows the error only in the row that was applied', async () => {
    setPost.mockResolvedValue(
      fail(400, 'rt: two teams have local stores — pass --team')
    );

    renderExplain();
    await screen.findByText(/is 45 because the user layer sets it/);

    const userRow = screen.getByTestId('layer-row-user:/stores/user.jsonc');
    const machineRow = screen.getByTestId(
      'layer-row-machine:/stores/machine.jsonc'
    );

    await stageWithin(userRow, '14');
    await stageWithin(machineRow, '7');

    await userEvent.click(
      within(machineRow).getByRole('button', { name: /^apply$/i })
    );

    await waitFor(() => {
      expect(
        within(machineRow).getByText(
          'rt: two teams have local stores — pass --team'
        )
      ).toBeInTheDocument();
    });
    expect(
      within(userRow).queryByText(
        'rt: two teams have local stores — pass --team'
      )
    ).not.toBeInTheDocument();
    expect(
      within(machineRow).getByTestId(
        'layer-stage-machine:/stores/machine.jsonc'
      )
    ).toBeInTheDocument();
  });

  it("a different row opening its edit does not clear the failed row's error", async () => {
    setPost.mockResolvedValue(
      fail(400, 'rt: two teams have local stores — pass --team')
    );

    renderExplain();
    await screen.findByText(/is 45 because the user layer sets it/);

    const userRow = screen.getByTestId('layer-row-user:/stores/user.jsonc');
    const machineRow = screen.getByTestId(
      'layer-row-machine:/stores/machine.jsonc'
    );

    await stageWithin(userRow, '14');
    await userEvent.click(
      within(userRow).getByRole('button', { name: /^apply$/i })
    );

    await waitFor(() => {
      expect(
        within(userRow).getByText(
          'rt: two teams have local stores — pass --team'
        )
      ).toBeInTheDocument();
    });

    await userEvent.click(
      within(machineRow).getByRole('button', { name: /edit/i })
    );

    expect(
      within(userRow).getByText('rt: two teams have local stores — pass --team')
    ).toBeInTheDocument();
  });

  it("while row A's apply is in flight, row B's Apply is disabled and re-enables once settled", async () => {
    let resolveApply: (res: unknown) => void = () => {};
    setPost.mockReturnValue(
      new Promise(resolve => {
        resolveApply = resolve;
      })
    );

    renderExplain();
    await screen.findByText(/is 45 because the user layer sets it/);

    const userRow = screen.getByTestId('layer-row-user:/stores/user.jsonc');
    const machineRow = screen.getByTestId(
      'layer-row-machine:/stores/machine.jsonc'
    );

    await stageWithin(userRow, '14');
    await stageWithin(machineRow, '7');

    await userEvent.click(
      within(userRow).getByRole('button', { name: /^apply$/i })
    );

    const machineApply = await waitFor(() => {
      const btn = within(machineRow).getByRole('button', { name: /^apply$/i });
      expect(btn).toBeDisabled();
      return btn;
    });

    await userEvent.click(machineApply);
    expect(setPost).toHaveBeenCalledTimes(1);

    resolveApply(ok({ rows: [] }));

    await waitFor(() => {
      expect(
        within(machineRow).getByRole('button', { name: /^apply$/i })
      ).not.toBeDisabled();
    });
  });

  it('discarding a failed staged change clears the error so re-staging starts clean', async () => {
    setPost.mockResolvedValue(
      fail(400, 'rt: two teams have local stores — pass --team')
    );

    renderExplain();
    await screen.findByText(/is 45 because the user layer sets it/);

    const userRow = screen.getByTestId('layer-row-user:/stores/user.jsonc');

    await stageWithin(userRow, '14');
    await userEvent.click(
      within(userRow).getByRole('button', { name: /^apply$/i })
    );

    await waitFor(() => {
      expect(
        within(userRow).getByText(
          'rt: two teams have local stores — pass --team'
        )
      ).toBeInTheDocument();
    });

    await userEvent.click(
      within(userRow).getByRole('button', { name: /discard/i })
    );

    expect(
      within(userRow).queryByTestId('layer-stage-user:/stores/user.jsonc')
    ).not.toBeInTheDocument();

    await stageWithin(userRow, '20');

    expect(
      within(userRow).queryByText(
        'rt: two teams have local stores — pass --team'
      )
    ).not.toBeInTheDocument();
  });
});
