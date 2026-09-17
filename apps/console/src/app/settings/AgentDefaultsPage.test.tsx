import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const defsGet = vi.fn();
const explainGet = vi.fn();
const setPost = vi.fn();
const modelsGet = vi.fn();

vi.mock('../api', () => ({
  client: {
    api: {
      settings: {
        defs: { $get: (...args: unknown[]) => defsGet(...args) },
        explain: {
          ':key': { $get: (...args: unknown[]) => explainGet(...args) },
        },
        set: { $post: (...args: unknown[]) => setPost(...args) },
      },
      agent: {
        models: { $get: (...args: unknown[]) => modelsGet(...args) },
      },
    },
  },
}));

const { AgentDefaultsPage } = await import('./AgentDefaultsPage');

function ok(data: unknown) {
  return { ok: true, status: 200, json: async () => data };
}

function notFound(key: string) {
  return {
    ok: false,
    status: 404,
    json: async () => ({ error: `unknown setting "${key}"` }),
  };
}

const AGENT_DEFS = [
  {
    key: 'agent.provider',
    type: 'string',
    scopes: ['user', 'machine'],
    merge: 'replace',
    secret: false,
    teamLocked: false,
    repoScoped: false,
    writable: true,
    description: 'Default agent provider.',
    hasDefault: true,
    defaultValue: 'claude',
  },
  {
    key: 'agent.claude.model',
    type: 'string',
    scopes: ['user', 'machine'],
    merge: 'replace',
    secret: false,
    teamLocked: false,
    repoScoped: false,
    writable: true,
    description: 'Default claude model.',
    hasDefault: false,
    defaultValue: null,
  },
];

const CLAUDE_MODELS = [
  { value: 'sonnet', label: 'Sonnet (latest)' },
  { value: 'opus', label: 'Opus (latest)' },
];

/** A def wire object shaped enough for `analyzeChain` to read `merge`/`type`/`hasDefault`. */
function scalarDef(key: string, overrides: Record<string, unknown> = {}) {
  return {
    key,
    type: 'string',
    scopes: ['user', 'machine'],
    merge: 'replace',
    secret: false,
    teamLocked: false,
    repoScoped: false,
    writable: true,
    description: '',
    hasDefault: false,
    defaultValue: null,
    ...overrides,
  };
}

function explainRow(key: string, value: unknown) {
  return {
    def: scalarDef(key),
    rows: [{ scope: 'user', file: '/stores/user.jsonc', present: true, value }],
  };
}

/** Every `explain/:key` call this page can make, defaulting to "unset"
    (404) unless a test overrides a specific key. */
function stubExplain(overrides: Record<string, unknown> = {}) {
  explainGet.mockImplementation(({ param }: { param: { key: string } }) => {
    if (param.key in overrides)
      return Promise.resolve(ok(overrides[param.key]));
    return Promise.resolve(notFound(param.key));
  });
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <AgentDefaultsPage />
    </QueryClientProvider>
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('AgentDefaultsPage', () => {
  it('shows the current provider selected and the model options for it', async () => {
    defsGet.mockResolvedValue(ok({ defs: AGENT_DEFS }));
    modelsGet.mockResolvedValue(ok({ models: CLAUDE_MODELS }));
    stubExplain({ 'agent.provider': explainRow('agent.provider', 'claude') });

    renderPage();

    await screen.findByTestId('agent-defaults');

    const providerSelect = screen.getByRole('combobox', {
      name: 'Default agent',
    }) as HTMLInputElement;
    expect(providerSelect.value).toBe('Claude');

    const modelSelect = screen.getByRole('combobox', {
      name: 'Model',
    }) as HTMLInputElement;
    await userEvent.click(modelSelect);
    expect(await screen.findByText('Sonnet (latest)')).toBeInTheDocument();
    expect(screen.getByText('Opus (latest)')).toBeInTheDocument();
  });

  it('shows a warning banner when the registry has not been republished with the new keys', async () => {
    defsGet.mockResolvedValue(ok({ defs: [] }));
    modelsGet.mockResolvedValue(ok({ models: [] }));
    stubExplain();

    renderPage();

    await screen.findByTestId('schema-pending-alert');
  });

  it('shows the Account field for claude and hides it for codex, and swaps the settings key on write', async () => {
    defsGet.mockResolvedValue(ok({ defs: AGENT_DEFS }));
    modelsGet.mockResolvedValue(ok({ models: CLAUDE_MODELS }));
    stubExplain({ 'agent.provider': explainRow('agent.provider', 'claude') });
    setPost.mockResolvedValue(ok({ rows: [] }));

    renderPage();
    await screen.findByTestId('agent-defaults');

    expect(screen.getByLabelText('Account')).toBeInTheDocument();

    stubExplain({ 'agent.provider': explainRow('agent.provider', 'codex') });
    const providerSelect = screen.getByRole('combobox', {
      name: 'Default agent',
    });
    await userEvent.click(providerSelect);
    await userEvent.click(await screen.findByText('Codex'));

    expect(setPost).toHaveBeenCalledWith(
      expect.objectContaining({
        json: expect.objectContaining({
          key: 'agent.provider',
          value: 'codex',
        }),
      })
    );

    await waitFor(() => {
      expect(screen.queryByLabelText('Account')).not.toBeInTheDocument();
    });
  });

  it('toggling the yolo switch does not crash and posts to the provider-scoped key', async () => {
    defsGet.mockResolvedValue(ok({ defs: AGENT_DEFS }));
    modelsGet.mockResolvedValue(ok({ models: CLAUDE_MODELS }));
    stubExplain({ 'agent.provider': explainRow('agent.provider', 'claude') });
    setPost.mockResolvedValue(ok({ rows: [] }));

    renderPage();
    await screen.findByTestId('agent-defaults');

    const yoloSwitch = screen.getByRole('switch', {
      name: /bypass permission prompts/i,
    });
    await userEvent.click(yoloSwitch);

    await waitFor(() => {
      expect(setPost).toHaveBeenCalledWith(
        expect.objectContaining({
          json: expect.objectContaining({
            key: 'agent.claude.yolo',
            value: true,
          }),
        })
      );
    });
  });

  it("writes to whatever scope that field's own control is set to", async () => {
    defsGet.mockResolvedValue(ok({ defs: AGENT_DEFS }));
    modelsGet.mockResolvedValue(ok({ models: CLAUDE_MODELS }));
    stubExplain({ 'agent.provider': explainRow('agent.provider', 'claude') });
    setPost.mockResolvedValue(ok({ rows: [] }));

    renderPage();
    await screen.findByTestId('agent-defaults');

    // Switching Effort's own scope control must not affect any other
    // field's write target -- there is no shared/global scope anymore.
    const effortScope = screen.getByRole('radiogroup', {
      name: 'Effort scope',
    });
    await userEvent.click(
      within(effortScope).getByRole('radio', { name: 'machine' })
    );

    const effort = screen.getByLabelText('Effort');
    await userEvent.type(effort, 'high');
    await userEvent.tab();

    await waitFor(() => {
      expect(setPost).toHaveBeenCalledWith(
        expect.objectContaining({
          json: expect.objectContaining({
            key: 'agent.claude.effort',
            value: 'high',
            scope: 'machine',
          }),
        })
      );
    });

    const extraArgsScope = screen.getByRole('radiogroup', {
      name: 'Extra args scope',
    });
    expect(
      within(extraArgsScope).getByRole('radio', { name: 'user' })
    ).toBeChecked();
  });

  it("resets a field's scope control when the provider switch changes which key it edits", async () => {
    defsGet.mockResolvedValue(ok({ defs: AGENT_DEFS }));
    modelsGet.mockResolvedValue(ok({ models: CLAUDE_MODELS }));
    stubExplain({
      'agent.provider': explainRow('agent.provider', 'claude'),
      'agent.claude.effort': explainRow('agent.claude.effort', 'high'),
    });
    setPost.mockResolvedValue(ok({ rows: [] }));

    renderPage();
    await screen.findByTestId('agent-defaults');

    const claudeEffortScope = screen.getByRole('radiogroup', {
      name: 'Effort scope',
    });
    await userEvent.click(
      within(claudeEffortScope).getByRole('radio', { name: 'machine' })
    );
    expect(
      within(claudeEffortScope).getByRole('radio', { name: 'machine' })
    ).toBeChecked();

    // agent.codex.effort is unset in this stub, so its own scope control
    // should start at 'user' -- not inherit claude's 'machine' selection.
    stubExplain({ 'agent.provider': explainRow('agent.provider', 'codex') });
    const providerSelect = screen.getByRole('combobox', {
      name: 'Default agent',
    });
    await userEvent.click(providerSelect);
    await userEvent.click(await screen.findByText('Codex'));

    await waitFor(() => {
      const codexEffortScope = screen.getByRole('radiogroup', {
        name: 'Effort scope',
      });
      expect(
        within(codexEffortScope).getByRole('radio', { name: 'user' })
      ).toBeChecked();
    });
  });

  it('does not write on blur when a text field was not actually edited', async () => {
    defsGet.mockResolvedValue(ok({ defs: AGENT_DEFS }));
    modelsGet.mockResolvedValue(ok({ models: CLAUDE_MODELS }));
    stubExplain({
      'agent.provider': explainRow('agent.provider', 'claude'),
      'agent.claude.effort': explainRow('agent.claude.effort', 'high'),
    });
    setPost.mockResolvedValue(ok({ rows: [] }));

    renderPage();
    await screen.findByTestId('agent-defaults');

    const effort = screen.getByLabelText('Effort');
    await userEvent.click(effort);
    await userEvent.tab();

    expect(setPost).not.toHaveBeenCalled();
  });
});
