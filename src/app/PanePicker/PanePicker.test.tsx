import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test } from 'vitest';

import { fetchMock, installFetchMock } from '../test-utils';
import {
  PanePickerProvider,
  usePanePicker,
  type PickPanesOptions,
} from './index';
import type { ChatPane } from './types';

const PANES: ChatPane[] = [
  {
    paneId: 'w1:p1',
    workspace: 'repo-tools',
    title: 'fred',
    cwd: '/r/repo-tools',
    repo: 'repo-tools',
    branch: 'main',
    agentStatus: 'working',
    presence: { handle: 'fred', status: 'live', rooms: ['repo-tools'] },
  },
  {
    paneId: 'w1:p2',
    workspace: 'chat',
    title: 'meg',
    cwd: '/r/chat',
    repo: 'chat',
    branch: 'main',
    agentStatus: 'idle',
    presence: { handle: 'meg', status: 'live', rooms: ['build'] },
  },
  {
    paneId: 'w1:p3',
    workspace: 'gitq',
    title: 'june',
    cwd: '/r/gitq',
    repo: 'gitq',
    branch: 'main',
    agentStatus: 'blocked',
    presence: { handle: 'june', status: 'idle', rooms: [] },
  },
  {
    paneId: 'w1:p4',
    workspace: 'acme',
    title: 'Evaluate codegen',
    cwd: '/r/acme',
    repo: 'acme',
    branch: 'main',
    agentStatus: 'idle',
  },
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function route(
  handlers: Record<string, (init?: RequestInit) => Response | Promise<Response>>
) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const path = String(url).split('?')[0]!;
    const key = `${init?.method ?? 'GET'} ${path}`;
    const handler =
      handlers[key] ??
      handlers[
        `${init?.method ?? 'GET'} ${path.replace(/\/w\d:p\d\/peek$/, '/:id/peek')}`
      ];
    if (!handler) return json({}, 404);
    return handler(init);
  });
}

function Harness({
  opts,
  onDone,
}: {
  opts?: PickPanesOptions;
  onDone: (r: ChatPane[] | null) => void;
}) {
  const pick = usePanePicker();
  return (
    <button type="button" onClick={() => void pick(opts).then(onDone)}>
      open
    </button>
  );
}

function mount(opts?: PickPanesOptions) {
  const results: Array<ChatPane[] | null> = [];
  renderWithProviders(
    <PanePickerProvider>
      <Harness opts={opts} onDone={r => results.push(r)} />
    </PanePickerProvider>
  );
  return results;
}

beforeEach(() => {
  installFetchMock();
  route({ 'GET /api/panes': () => json({ available: true, panes: PANES }) });
});

test('lists claude panes sorted listening, idle, deaf, not signed in, with handle or not signed in', async () => {
  mount();
  await userEvent.click(screen.getByText('open'));
  const rows = await screen.findAllByTestId(/^pane-row-/);
  expect(rows.map(r => r.getAttribute('data-testid'))).toEqual([
    'pane-row-w1:p1',
    'pane-row-w1:p2',
    'pane-row-w1:p3',
    'pane-row-w1:p4',
  ]);
  expect(within(rows[0]!).getByText('fred')).toBeInTheDocument();
  expect(within(rows[3]!).getByText('not signed in')).toBeInTheDocument();
  expect(within(rows[3]!).getByText('…/acme')).toBeInTheDocument();
});

test('the filter matches handle, workspace, title, repo and path', async () => {
  mount();
  await userEvent.click(screen.getByText('open'));
  await screen.findAllByTestId(/^pane-row-/);
  await userEvent.type(screen.getByTestId('pane-filter'), 'codegen');
  expect(screen.getAllByTestId(/^pane-row-/)).toHaveLength(1);
  await userEvent.clear(screen.getByTestId('pane-filter'));
  await userEvent.type(screen.getByTestId('pane-filter'), '/r/gitq');
  expect(
    screen.getAllByTestId(/^pane-row-/).map(r => r.getAttribute('data-testid'))
  ).toEqual(['pane-row-w1:p3']);
});

test("the caller's disable reason renders inline and the row cannot be selected", async () => {
  const results = mount({
    disable: p => (p.presence?.rooms.includes('build') ? 'in #build' : null),
  });
  await userEvent.click(screen.getByText('open'));
  const meg = await screen.findByTestId('pane-row-w1:p2');
  expect(within(meg).getByText('in #build')).toBeInTheDocument();
  await userEvent.click(within(meg).getByTestId('pane-check-w1:p2'));
  await userEvent.click(screen.getByTestId('pane-use'));
  expect(results).toEqual([[]]);
});

test('the eye fetches the peek for that row only, once opened', async () => {
  route({
    'GET /api/panes': () => json({ available: true, panes: PANES }),
    'GET /api/panes/:id/peek': () =>
      json({ paneId: 'w1:p4', lines: ['⏺ Read(x)', '❯ '] }),
  });
  mount();
  await userEvent.click(screen.getByText('open'));
  await screen.findByTestId('pane-row-w1:p4');
  expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/peek'))).toBe(
    false
  );
  await userEvent.click(screen.getByTestId('pane-peek-button-w1:p4'));
  expect(await screen.findByTestId('pane-peek-w1:p4')).toHaveTextContent(
    'Read(x)'
  );
  expect(
    fetchMock.mock.calls.filter(([u]) => String(u).includes('/peek'))
  ).toHaveLength(1);
});

test('resolves with the picked rows verbatim; cancel resolves null', async () => {
  const results = mount({ context: 'to invite to #build' });
  await userEvent.click(screen.getByText('open'));
  expect(await screen.findByText('to invite to #build')).toBeInTheDocument();
  await userEvent.click(screen.getByTestId('pane-check-w1:p1'));
  await userEvent.click(screen.getByTestId('pane-check-w1:p4'));
  await userEvent.click(screen.getByTestId('pane-use'));
  expect(results).toEqual([[PANES[0], PANES[3]]]);
  await userEvent.click(screen.getByText('open'));
  await screen.findByTestId('pane-row-w1:p1');
  await userEvent.click(screen.getByTestId('pane-cancel'));
  expect(results[1]).toBeNull();
});

test('multiple:false keeps one selection', async () => {
  const results = mount({ multiple: false });
  await userEvent.click(screen.getByText('open'));
  await userEvent.click(await screen.findByTestId('pane-check-w1:p1'));
  await userEvent.click(screen.getByTestId('pane-check-w1:p4'));
  await userEvent.click(screen.getByTestId('pane-use'));
  expect(results).toEqual([[PANES[3]]]);
});

test('new pane is hidden without allowCreate and present with it; the form posts and lists the pane as starting until ready', async () => {
  let release: (r: Response) => void = () => {};
  route({
    'GET /api/panes': () => json({ available: true, panes: PANES }),
    'GET /api/panes/accounts': () =>
      json({
        accounts: [
          { slot: 1, email: 'a@b.c', alias: 'Acme', headroom: '5h 0%' },
        ],
      }),
    'GET /api/panes/directories': () =>
      json({
        directories: [{ path: '/r/acme-wt', repo: 'acme', branch: 'perf' }],
      }),
    'POST /api/panes': () => new Promise<Response>(r => (release = r)),
  });
  mount();
  await userEvent.click(screen.getByText('open'));
  await screen.findByTestId('pane-row-w1:p1');
  expect(screen.queryByTestId('pane-new')).toBeNull();
  await userEvent.click(screen.getByTestId('pane-cancel'));

  const results = mount({ allowCreate: true });
  await userEvent.click(screen.getAllByText('open')[1]!);
  await userEvent.click(await screen.findByTestId('pane-new'));
  await userEvent.type(screen.getByLabelText('Directory'), '/r/acme-wt');
  await userEvent.click(screen.getByTestId('pane-start'));
  expect(await screen.findByText(/starting/)).toBeInTheDocument();
  const body = JSON.parse(
    String(
      fetchMock.mock.calls.find(
        ([, i]) => (i as RequestInit)?.method === 'POST'
      )![1]!.body
    )
  );
  expect(body).toMatchObject({ cwd: '/r/acme-wt', account: 'Acme' });
  await act(async () => {
    release(
      json({
        pane: {
          paneId: 'w9:p1',
          workspace: 'chat',
          cwd: '/r/acme-wt',
          agentStatus: 'idle',
        },
        ready: true,
      })
    );
  });
  const row = await screen.findByTestId('pane-row-w9:p1');
  expect(within(row).getByTestId('pane-check-w9:p1')).toHaveAttribute(
    'aria-checked',
    'true'
  );
  await userEvent.click(screen.getByTestId('pane-use'));
  expect(results[0]).toEqual([
    {
      paneId: 'w9:p1',
      workspace: 'chat',
      cwd: '/r/acme-wt',
      agentStatus: 'idle',
    },
  ]);
});

test('a ready:false spawn keeps the row, unselectable, with its state', async () => {
  route({
    'GET /api/panes': () => json({ available: true, panes: [] }),
    'GET /api/panes/accounts': () => json({ accounts: [] }),
    'GET /api/panes/directories': () => json({ directories: [] }),
    'POST /api/panes': () =>
      json({
        pane: {
          paneId: 'w9:p2',
          workspace: 'chat',
          cwd: '/r/x',
          agentStatus: 'unknown',
        },
        ready: false,
      }),
  });
  mount({ allowCreate: true });
  await userEvent.click(screen.getByText('open'));
  await userEvent.click(await screen.findByTestId('pane-new'));
  expect(screen.queryByLabelText('Account')).toBeNull();
  await userEvent.type(screen.getByLabelText('Directory'), '/r/x');
  await userEvent.click(screen.getByTestId('pane-start'));
  const row = await screen.findByTestId('pane-row-w9:p2');
  expect(within(row).getByText(/never reached idle/)).toBeInTheDocument();
  expect(within(row).getByTestId('pane-check-w9:p2')).toHaveAttribute(
    'aria-disabled',
    'true'
  );
});

test('herdr unavailable shows a notice and only cancel', async () => {
  route({ 'GET /api/panes': () => json({ available: false, panes: [] }) });
  const results = mount();
  await userEvent.click(screen.getByText('open'));
  expect(await screen.findByText(/herdr is not running/)).toBeInTheDocument();
  expect(screen.queryByTestId('pane-use')).toBeNull();
  await userEvent.click(screen.getByTestId('pane-cancel'));
  expect(results).toEqual([null]);
});
