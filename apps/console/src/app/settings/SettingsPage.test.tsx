import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type { SettingDefWire } from '@mattstack/settings-kit/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config/useSettings', () => ({
  useAgentModels: () => ({
    data: { models: [{ value: 'opus', label: 'Opus' }] },
  }),
}));

const { SettingsPage } = await import('./SettingsPage');

function def(key: string, over: Partial<SettingDefWire> = {}): SettingDefWire {
  return {
    key,
    type: 'string',
    scopes: ['user'],
    merge: 'replace',
    secret: false,
    teamLocked: false,
    repoScoped: false,
    writable: true,
    description: `${key} setting.`,
    hasDefault: false,
    defaultValue: null,
    effective: { scope: null, file: null },
    ...over,
  };
}

const BOARD = [
  ...Array.from({ length: 7 }, (_, i) =>
    def(`board.t${i}`, {
      scopes: ['team'],
      effective: { scope: 'team', file: '/t', value: 'x' },
    })
  ),
  ...Array.from({ length: 5 }, (_, i) =>
    def(`board.u${i}`, { scopes: ['user', 'machine'] })
  ),
  def('board.agent.model', {
    scopes: ['user', 'machine'],
    effective: { scope: 'machine', file: '/m', value: 'opus' },
  }),
];
const DEFS = [
  def('agent.provider', {
    effective: { scope: 'default', file: null, value: 'claude' },
  }),
  def('agent.claude.account'),
  def('agent.codex.effort'),
  def('rt.runsPruneDays', {
    type: 'number',
    scopes: ['machine'],
    effective: { scope: 'default', file: null, value: 30 },
  }),
  def('rt.logRetentionDays', {
    type: 'number',
    scopes: ['machine', 'user'],
    effective: { scope: 'machine', file: '/m', value: 7 },
  }),
  ...BOARD,
];

const serve = (defs: SettingDefWire[]) => () => ({
  ok: true,
  status: 200,
  json: async () => ({ defs }),
});

let defsResponse: () => unknown = serve(DEFS);

beforeEach(() => {
  defsResponse = serve(DEFS);
  window.history.replaceState(null, '', '/settings');
  vi.stubGlobal('fetch', async () => defsResponse());
});
afterEach(() => vi.unstubAllGlobals());

function renderPage() {
  return renderWithProviders(
    <QueryClientProvider client={new QueryClient()}>
      <SettingsPage />
    </QueryClientProvider>
  );
}

/** Lays the sections out at fixed offsets inside the content frame's
    viewport, which jsdom never measures, and scrolls that viewport. */
function frame(offsets: Record<string, number>, height = 400) {
  const viewport = document.querySelector<HTMLElement>(
    '#page-shell-content .mantine-ScrollArea-viewport'
  )!;
  const scrollHeight = Math.max(...Object.values(offsets)) + 300;
  Object.defineProperty(viewport, 'clientHeight', { value: height });
  Object.defineProperty(viewport, 'scrollHeight', { value: scrollHeight });
  viewport.getBoundingClientRect = () => ({ top: 100 }) as DOMRect;
  for (const [id, offset] of Object.entries(offsets))
    document.getElementById(`settings-${id}`)!.getBoundingClientRect = () =>
      ({ top: 100 + offset - viewport.scrollTop }) as DOMRect;
  return {
    viewport,
    scrollTo(top: number) {
      viewport.scrollTop = top;
      fireEvent.scroll(viewport);
    },
  };
}

function marked() {
  const index = screen.getByRole('navigation', { name: 'settings groups' });
  return within(index)
    .getAllByRole('link')
    .filter(l => l.hasAttribute('data-active'))
    .map(l => l.getAttribute('href'));
}

describe('SettingsPage', () => {
  it('lists groups in the index with their counts and renders sections', async () => {
    renderPage();
    const index = await screen.findByRole('navigation', {
      name: 'settings groups',
    });
    expect(within(index).getByText('Agents')).toBeInTheDocument();
    expect(within(index).getByText('Board')).toBeInTheDocument();
    expect(within(index).getByText('13')).toBeInTheDocument();
    expect(within(index).getByText('Apps')).not.toHaveStyle({
      textTransform: 'uppercase',
    });
    expect(screen.getByRole('heading', { name: 'Daemon' })).toBeInTheDocument();
  });

  it('composes the kit shell: the index in its sidebar, sections in its content frame', async () => {
    renderPage();
    const index = await screen.findByRole('navigation', {
      name: 'settings groups',
    });
    expect(document.getElementById('page-shell-sidebar')).toContainElement(
      index
    );
    expect(document.getElementById('page-shell-header')).toHaveTextContent(
      'Settings'
    );
    expect(document.getElementById('page-shell-header')).toHaveTextContent(
      /rt settings list\s*18 keys · as of \d/
    );
    expect(document.getElementById('page-shell-content')).toContainElement(
      screen.getByRole('heading', { name: 'Board' })
    );
    expect(document.getElementById('page-shell-content')).toHaveAttribute(
      'data-own-surface'
    );
    const filter = screen.getByLabelText('filter settings');
    expect(document.getElementById('page-shell-header')).toContainElement(
      filter
    );
    expect(document.getElementById('page-shell-content')).not.toContainElement(
      filter
    );
  });

  it('the as-of time marks the last load, not each write', async () => {
    vi.stubGlobal('fetch', async (url: string) =>
      url.endsWith('/api/settings/set')
        ? {
            ok: true,
            status: 200,
            json: async () => ({
              effective: { scope: 'machine', file: '/m', value: 9 },
            }),
          }
        : defsResponse()
    );
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 23, 10, 0));
    renderPage();
    const header = () => document.getElementById('page-shell-header')!;
    const days = await screen.findByLabelText('rt.logRetentionDays');
    expect(header()).toHaveTextContent(/as of 10:00/);
    vi.setSystemTime(new Date(2026, 8, 23, 10, 5));
    await userEvent.clear(days);
    await userEvent.type(days, '9');
    days.blur();
    await waitFor(() =>
      expect(screen.getByLabelText('rt.logRetentionDays')).toHaveValue('9')
    );
    await new Promise(r => setTimeout(r, 0));
    expect(header()).toHaveTextContent(/as of 10:00/);
    vi.useRealTimers();
  });

  it('on a narrow screen, picking a group closes the index drawer', async () => {
    const desktopWidth = window.innerWidth;
    window.innerWidth = 500;
    try {
      renderPage();
      await screen.findByLabelText('filter settings');
      await userEvent.click(
        await screen.findByRole('button', { name: 'Open sidebar' })
      );
      const index = await screen.findByRole('navigation', {
        name: 'settings groups',
      });
      await userEvent.click(
        within(index).getByRole('link', { name: /^Board/ })
      );
      await waitFor(() =>
        expect(
          screen.queryByRole('navigation', { name: 'settings groups' })
        ).toBeNull()
      );
    } finally {
      window.innerWidth = desktopWidth;
    }
  });

  it('filters by key and description, keeps the query in the URL, and Esc clears it', async () => {
    renderPage();
    const filter = await screen.findByLabelText('filter settings');
    await userEvent.type(filter, 'days');
    expect(screen.getByText('2 of 18')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Board' })).toBeNull();
    expect(window.location.search).toBe('?q=days');
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('heading', { name: 'Board' })).toBeInTheDocument();
  });

  it('greys out index groups with no match and says how many are hidden', async () => {
    renderPage();
    const index = await screen.findByRole('navigation', {
      name: 'settings groups',
    });
    await userEvent.click(screen.getByRole('checkbox', { name: /Changed/ }));
    await userEvent.type(screen.getByLabelText('filter settings'), 'days');
    const board = within(index).getByRole('link', { name: /^Board/ });
    expect(board).toHaveAttribute('data-disabled');
    expect(board).toHaveAttribute('aria-disabled', 'true');
    expect(
      within(index).getByRole('link', { name: /^Daemon/ })
    ).not.toHaveAttribute('data-disabled');
    const daemon = screen
      .getByRole('heading', { name: 'Daemon' })
      .closest('section')!;
    expect(within(daemon).getByText('1 of 2')).toBeInTheDocument();
    expect(screen.getByText('2 groups have no match.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear filter' }));
    expect(screen.getByRole('heading', { name: 'Board' })).toBeInTheDocument();
    expect(screen.getByLabelText('filter settings')).toHaveValue('');
    expect(screen.getByRole('checkbox', { name: /Changed/ })).not.toBeChecked();
    expect(within(daemon).getByText('2')).toBeInTheDocument();
  });

  it('shows an empty state when nothing matches', async () => {
    renderPage();
    await userEvent.type(
      await screen.findByLabelText('filter settings'),
      'kubernetes'
    );
    expect(
      screen.getByText('No settings match “kubernetes”')
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear filter' }));
    expect(screen.getByRole('heading', { name: 'Board' })).toBeInTheDocument();
  });

  it('Changed keeps only keys a store sets', async () => {
    renderPage();
    await userEvent.click(
      await screen.findByRole('checkbox', { name: /Changed/ })
    );
    expect(screen.queryByText('provider')).toBeNull();
    expect(screen.getByText('logRetentionDays')).toBeInTheDocument();
  });

  it('splits a large section into subheads and hides badges that repeat them', async () => {
    renderPage();
    const board = (
      await screen.findByRole('heading', { name: 'Board' })
    ).closest('section')!;
    expect(within(board).getByText('Team')).toBeInTheDocument();
    expect(within(board).getByText('You')).toBeInTheDocument();
    const team = within(board).getByText('Team').parentElement!;
    expect([...team.children].map(c => c.textContent)).toEqual([
      'Team',
      '7',
      '· shared with everyone through the team repo',
    ]);
    expect(
      within(board).queryAllByText('team', { selector: '.mantine-Badge-label' })
    ).toHaveLength(0);
    expect(
      within(board).getByRole('button', {
        name: 'board.agent.model actions',
      })
    ).toBeInTheDocument();
  });

  it('the Agents Codex tab swaps the provider keys and drops account', async () => {
    renderPage();
    expect(await screen.findByText('account')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Codex' }));
    expect(screen.queryByText('account')).toBeNull();
    expect(screen.getByText('agent.codex.')).toBeInTheDocument();
  });

  it('a failed load shows an alert and keeps the toolbar', async () => {
    defsResponse = () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: 'rt: store unreadable' }),
    });
    renderPage();
    expect(await screen.findByText('rt: store unreadable')).toBeInTheDocument();
    expect(screen.getByLabelText('filter settings')).toBeInTheDocument();
    defsResponse = () => ({
      ok: true,
      status: 200,
      json: async () => ({ defs: DEFS }),
    });
  });

  it('Agents follows the filter to the provider that has matches, then returns to the chosen tab', async () => {
    defsResponse = serve([
      ...DEFS.filter(d => d.key !== 'agent.codex.effort'),
      def('agent.codex.effort', {
        effective: { scope: 'user', file: '/u', value: 'high' },
      }),
    ]);
    renderPage();
    expect(await screen.findByText('account')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Claude' })).toBeChecked();
    const changed = screen.getByRole('checkbox', { name: /Changed/ });
    await userEvent.click(changed);
    expect(screen.getByText('effort')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Codex' })).toBeChecked();
    await userEvent.click(changed);
    expect(screen.getByRole('radio', { name: 'Claude' })).toBeChecked();
    expect(screen.getByText('account')).toBeInTheDocument();
    expect(screen.queryByText('effort')).toBeNull();
  });

  it('opens Agents on the effective provider even when the filter hides agent.provider', async () => {
    window.history.replaceState(null, '', '/settings?q=effort');
    defsResponse = serve([
      def('agent.provider', {
        effective: { scope: 'user', file: '/u', value: 'codex' },
      }),
      def('agent.claude.effort'),
      def('agent.codex.effort'),
    ]);
    renderPage();
    expect(await screen.findAllByText('agent.codex.')).not.toHaveLength(0);
    expect(screen.getByRole('radio', { name: 'Codex' })).toBeChecked();
    expect(screen.queryAllByText('agent.claude.')).toHaveLength(0);
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
  });
  it('marks the group in view in the index as the reader scrolls', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Board' });
    const f = frame({ agents: 0, daemon: 300, board: 600 }, 200);
    f.scrollTo(0);
    expect(marked()).toEqual(['#agents']);
    f.scrollTo(320);
    expect(marked()).toEqual(['#daemon']);
    f.scrollTo(650);
    expect(marked()).toEqual(['#board']);
    f.scrollTo(100);
    expect(marked()).toEqual(['#agents']);
  });

  it('marks the last group once the frame reaches its end', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Board' });
    const f = frame({ agents: 0, daemon: 300, board: 600 }, 800);
    f.scrollTo(100);
    expect(marked()).toEqual(['#board']);
  });

  it('a picked group stays marked when the frame cannot scroll it to the top', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Board' });
    const f = frame({ agents: 0, daemon: 300, board: 600 }, 800);
    document.getElementById('settings-daemon')!.scrollIntoView = () =>
      f.scrollTo(100);
    const index = screen.getByRole('navigation', { name: 'settings groups' });
    await userEvent.click(within(index).getByRole('link', { name: /^Daemon/ }));
    expect(marked()).toEqual(['#daemon']);
    f.scrollTo(60);
    expect(marked()).toEqual(['#agents']);
  });

  it('a picked group the filter then hides gives the mark back to the spy', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Board' });
    frame({ agents: 0, daemon: 300, board: 600 }, 200);
    const index = screen.getByRole('navigation', { name: 'settings groups' });
    await userEvent.click(within(index).getByRole('link', { name: /^Board/ }));
    expect(marked()).toEqual(['#board']);
    await userEvent.type(screen.getByLabelText('filter settings'), 'Prune');
    await waitFor(() => expect(marked()).toEqual(['#daemon']));
  });

  it('a deep link marks its group', async () => {
    window.history.replaceState(null, '', '/settings#board');
    renderPage();
    await screen.findByRole('heading', { name: 'Board' });
    await waitFor(() => expect(marked()).toEqual(['#board']));
  });

  it('a deep link to a group the filter hides marks nothing hidden', async () => {
    window.history.replaceState(null, '', '/settings?q=Prune#board');
    renderPage();
    await screen.findByRole('heading', { name: 'Daemon' });
    expect(screen.queryByRole('heading', { name: 'Board' })).toBeNull();
    await waitFor(() => expect(marked()).toEqual(['#daemon']));
  });

  it('a picked group stays marked through the scroll its jump causes', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Board' });
    const f = frame({ agents: 0, daemon: 300, board: 600 }, 800);
    document.getElementById('settings-daemon')!.scrollIntoView = () => {
      f.viewport.scrollTop = 100;
    };
    const index = screen.getByRole('navigation', { name: 'settings groups' });
    await userEvent.click(within(index).getByRole('link', { name: /^Daemon/ }));
    fireEvent.scroll(f.viewport);
    expect(marked()).toEqual(['#daemon']);
    f.scrollTo(60);
    expect(marked()).toEqual(['#agents']);
  });
});
