import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type {
  ExplainRowWire,
  SettingDefWire,
} from '@mattstack/settings-kit/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ExplainModal, type ExplainStore } from './ExplainModal';

const KEY = 'board.agent.model';

const DEF: SettingDefWire = {
  key: KEY,
  type: 'string',
  scopes: ['user', 'machine'],
  merge: 'replace',
  secret: false,
  teamLocked: false,
  repoScoped: false,
  writable: true,
  description:
    "Default --model for the board's panes. Unset omits the flag entirely.",
  hasDefault: false,
  defaultValue: null,
  effective: { scope: 'machine', file: '/stores/local.jsonc', value: 'm-old' },
  storeVersion: 1,
};

const ROWS: ExplainRowWire[] = [
  { scope: 'default', file: null, present: false },
  { scope: 'team', file: '/stores/team.jsonc', present: false },
  { scope: 'user', file: '/stores/user.jsonc', present: true, value: 'm-new' },
  {
    scope: 'machine',
    file: '/stores/local.jsonc',
    present: true,
    value: 'm-old',
  },
];

const explainGet = vi.fn();

vi.stubGlobal('fetch', (url: string) => {
  if (url.startsWith('/api/settings/explain/')) return explainGet(url);
  return Promise.resolve({
    ok: false,
    status: 404,
    json: async () => ({ error: 'not found' }),
  });
});

function ok(data: unknown) {
  return { ok: true, status: 200, json: async () => data };
}

function store(over: Partial<ExplainStore> = {}): ExplainStore {
  return {
    defs: [DEF],
    loading: false,
    error: null,
    set: vi.fn(async () => null as string | null),
    unset: vi.fn(async () => null as string | null),
    move: vi.fn(async () => null as string | null),
    ...over,
  };
}

function renderModal(s: ExplainStore, settingKey: string | null = KEY) {
  const onClose = vi.fn();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <ExplainModal settingKey={settingKey} store={s} onClose={onClose} />
    </QueryClientProvider>
  );
  return { onClose };
}

afterEach(() => explainGet.mockReset());

describe('ExplainModal', () => {
  it('renders the settings row, the verdict and every layer', async () => {
    explainGet.mockResolvedValue(ok({ def: DEF, rows: ROWS }));
    renderModal(store());

    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(`>_ rt settings explain ${KEY}`)
    ).toBeInTheDocument();
    expect(within(dialog).getByText('model')).toBeInTheDocument();
    expect(within(dialog).getByText(DEF.description)).toBeInTheDocument();
    expect(
      await within(dialog).findByTestId('explain-sentence')
    ).toHaveTextContent(
      `${KEY} is "m-old" because the machine layer sets it, overriding user.`
    );
    expect(within(dialog).getByTestId('layer-value-user')).toHaveStyle({
      textDecoration: 'line-through',
    });
    expect(
      within(within(dialog).getByTestId('layer-machine')).getByText('wins')
    ).toBeInTheDocument();
    expect(
      within(within(dialog).getByTestId('layer-team')).getByText(
        'not allowed at this layer (allowed: user, machine)'
      )
    ).toBeInTheDocument();
  });

  it('removes one layer and re-reads the stack', async () => {
    explainGet.mockResolvedValue(ok({ def: DEF, rows: ROWS }));
    const s = store();
    renderModal(s);

    const remove = await screen.findByRole('button', {
      name: `remove ${KEY} from machine`,
    });
    expect(explainGet).toHaveBeenCalledTimes(1);
    await userEvent.click(remove);

    expect(s.unset).toHaveBeenCalledWith(KEY, 'machine');
    await waitFor(() => expect(explainGet).toHaveBeenCalledTimes(2));
  });

  it('offers no remove on unset or disallowed layers', async () => {
    explainGet.mockResolvedValue(ok({ def: DEF, rows: ROWS }));
    renderModal(store());

    await screen.findByTestId('layer-machine');
    expect(
      screen.queryByRole('button', { name: `remove ${KEY} from team` })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: `remove ${KEY} from user` })
    ).toBeInTheDocument();
  });

  it('shows a refused remove', async () => {
    explainGet.mockResolvedValue(ok({ def: DEF, rows: ROWS }));
    const s = store({ unset: vi.fn(async () => 'store is read-only') });
    renderModal(s);

    await userEvent.click(
      await screen.findByRole('button', { name: `remove ${KEY} from user` })
    );
    expect(await screen.findByText('store is read-only')).toBeInTheDocument();
    await waitFor(() => expect(explainGet).toHaveBeenCalledTimes(2));
  });

  it('sets a value at a layer other than the winning one', async () => {
    explainGet.mockImplementation(async () =>
      ok(structuredClone({ def: DEF, rows: ROWS }))
    );
    const s = store();
    renderModal(s);

    await userEvent.click(
      await screen.findByRole('button', { name: `set ${KEY} at user` })
    );
    const input = within(screen.getByTestId('layer-user')).getByRole(
      'textbox',
      { name: KEY }
    );
    await userEvent.clear(input);
    await userEvent.type(input, 'm-other{Enter}');

    expect(s.set).toHaveBeenCalledWith(KEY, 'user', 'm-other');
    await waitFor(() => expect(explainGet).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: `set ${KEY} at user` })
      ).toBeInTheDocument()
    );
  });

  it('Escape inside an edit reverts it without closing the modal', async () => {
    explainGet.mockResolvedValue(ok({ def: DEF, rows: ROWS }));
    const { onClose } = renderModal(store());

    await userEvent.click(
      await screen.findByRole('button', { name: `set ${KEY} at user` })
    );
    const input = within(screen.getByTestId('layer-user')).getByRole(
      'textbox',
      { name: KEY }
    );
    await userEvent.type(input, 'x{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Escape in a number edit abandons it: no save, modal stays', async () => {
    const days: SettingDefWire = {
      ...DEF,
      key: 'rt.runsPruneDays',
      type: 'number',
      effective: { scope: 'user', file: '/stores/user.jsonc', value: 30 },
    };
    explainGet.mockResolvedValue(
      ok({
        def: days,
        rows: [
          { scope: 'default', file: null, present: false },
          {
            scope: 'user',
            file: '/stores/user.jsonc',
            present: true,
            value: 30,
          },
          { scope: 'machine', file: '/stores/local.jsonc', present: false },
        ],
      })
    );
    const s = store({ defs: [days] });
    const { onClose } = renderModal(s, 'rt.runsPruneDays');

    await userEvent.click(
      await screen.findByRole('button', {
        name: 'set rt.runsPruneDays at machine',
      })
    );
    const input = within(screen.getByTestId('layer-machine')).getByRole(
      'textbox',
      { name: 'rt.runsPruneDays' }
    );
    await userEvent.type(input, '45{Escape}');

    expect(s.set).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(input).not.toHaveFocus();
  });

  it('Escape outside a field closes', async () => {
    explainGet.mockResolvedValue(ok({ def: DEF, rows: ROWS }));
    const { onClose } = renderModal(store());
    await screen.findByTestId('explain-sentence');
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('closes from its close button', async () => {
    explainGet.mockResolvedValue(ok({ def: DEF, rows: ROWS }));
    const { onClose } = renderModal(store());
    await userEvent.click(
      await screen.findByRole('button', { name: 'Close modal' })
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('loads the key itself when no store is passed', async () => {
    explainGet.mockResolvedValue(ok({ def: DEF, rows: ROWS }));
    vi.stubGlobal('fetch', (url: string) => {
      if (url.startsWith('/api/settings/explain/')) return explainGet(url);
      if (url.startsWith('/api/settings/defs'))
        return Promise.resolve(ok({ defs: [DEF] }));
      return Promise.resolve(ok({}));
    });
    const onClose = vi.fn();
    const queryClient = new QueryClient();
    renderWithProviders(
      <QueryClientProvider client={queryClient}>
        <ExplainModal settingKey={KEY} onClose={onClose} />
      </QueryClientProvider>
    );
    expect(await screen.findByTestId('explain-sentence')).toHaveTextContent(
      'because the machine layer sets it'
    );
  });

  it('says so for an unknown key', async () => {
    renderModal(store(), 'no.such.key');
    expect(
      await screen.findByText('No setting named no.such.key is registered.')
    ).toBeInTheDocument();
  });

  it('is closed without a key', () => {
    renderModal(store(), null);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
