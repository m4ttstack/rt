import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';

import './icons';

import { NewRoomModal } from './NewRoomModal';
import { PanePickerProvider } from './PanePicker';
import { fetchMock, installFetchMock } from './test-utils';

const PANES = [
  {
    paneId: 'w1:p1',
    workspace: 'acme',
    title: 'Evaluate codegen',
    cwd: '/r/acme',
    repo: 'acme',
    branch: 'main',
    agentStatus: 'idle',
  },
  {
    paneId: 'w1:p2',
    workspace: 'chat',
    title: 'meg',
    cwd: '/r/chat',
    repo: 'chat',
    branch: 'main',
    agentStatus: 'idle',
    presence: { handle: 'meg', status: 'live', rooms: ['codegen-split'] },
  },
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function mount(onCreated = vi.fn(), onClose = vi.fn()) {
  renderWithProviders(
    <PanePickerProvider>
      <NewRoomModal opened onClose={onClose} onCreated={onCreated} />
    </PanePickerProvider>
  );
  return { onCreated, onClose };
}

beforeEach(() => {
  installFetchMock();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const path = String(url).split('?')[0];
    if (path === '/api/panes') return json({ available: true, panes: PANES });
    if (path === '/api/chat/rooms')
      return json({ room: JSON.parse(String(init?.body)).room, seedId: 9 });
    if (path === '/api/chat/invite')
      return json({ results: [{ paneId: 'w1:p1', delivered: 'accepted' }] });
    return json({});
  });
});

test('the name field enforces the room charset before anything is sent', async () => {
  mount();
  await userEvent.type(screen.getByLabelText('Room'), 'Bad Room');
  expect(screen.getByTestId('new-room-create')).toBeDisabled();
  expect(
    await screen.findByText('lowercase, digits, dashes')
  ).toBeInTheDocument();
  expect(
    fetchMock.mock.calls.some(([u]) => String(u) === '/api/chat/rooms')
  ).toBe(false);
});

test('pick panes opens the picker with the room as context and disables panes already in it; picked rows get a note', async () => {
  mount();
  await userEvent.type(screen.getByLabelText('Room'), 'codegen-split');
  await userEvent.click(screen.getByTestId('new-room-pick'));
  expect(
    await screen.findByText('to invite to #codegen-split')
  ).toBeInTheDocument();
  expect(
    within(screen.getByTestId('pane-row-w1:p2')).getByText('in #codegen-split')
  ).toBeInTheDocument();
  await userEvent.click(screen.getByTestId('pane-check-w1:p1'));
  await userEvent.click(screen.getByTestId('pane-use'));
  const picked = await screen.findByTestId('picked-w1:p1');
  await userEvent.type(
    within(picked).getByLabelText('note for this pane'),
    'you own vite'
  );
  expect(screen.getByTestId('new-room-create')).toHaveTextContent('invite 1');
});

test('submit creates, seeds, then invites in order, and reports the room and results', async () => {
  const { onCreated } = mount();
  await userEvent.type(screen.getByLabelText('Room'), 'codegen-split');
  await userEvent.type(screen.getByLabelText('Seed'), 'Goal: halve the bundle');
  await userEvent.click(screen.getByTestId('new-room-pick'));
  await userEvent.click(await screen.findByTestId('pane-check-w1:p1'));
  await userEvent.click(screen.getByTestId('pane-use'));
  await userEvent.type(
    within(await screen.findByTestId('picked-w1:p1')).getByLabelText(
      'note for this pane'
    ),
    'you own vite'
  );
  await userEvent.click(screen.getByTestId('new-room-create'));
  await vi.waitFor(() =>
    expect(onCreated).toHaveBeenCalledWith(
      'codegen-split',
      [{ paneId: 'w1:p1', delivered: 'accepted' }],
      [PANES[0]]
    )
  );
  const calls = fetchMock.mock.calls.map(
    ([u, i]) => [String(u), i as RequestInit | undefined] as const
  );
  const rooms = calls.findIndex(([u]) => u === '/api/chat/rooms');
  const invite = calls.findIndex(([u]) => u === '/api/chat/invite');
  expect(rooms).toBeGreaterThan(-1);
  expect(invite).toBeGreaterThan(rooms);
  expect(JSON.parse(String(calls[rooms]![1]!.body))).toEqual({
    room: 'codegen-split',
    seed: 'Goal: halve the bundle',
    wakeOn: 'mention',
  });
  expect(JSON.parse(String(calls[invite]![1]!.body))).toEqual({
    room: 'codegen-split',
    panes: [{ paneId: 'w1:p1', note: 'you own vite' }],
  });
});

test('create without inviting skips the invite route', async () => {
  const { onCreated } = mount();
  await userEvent.type(screen.getByLabelText('Room'), 'quiet');
  await userEvent.click(screen.getByTestId('new-room-create-only'));
  await vi.waitFor(() =>
    expect(onCreated).toHaveBeenCalledWith('quiet', [], [])
  );
  expect(
    fetchMock.mock.calls.some(([u]) => String(u) === '/api/chat/invite')
  ).toBe(false);
});

test('a failed create keeps the draft and reports the error', async () => {
  fetchMock.mockImplementation(async (url: string) =>
    String(url) === '/api/chat/rooms'
      ? json({ error: 'rt daemon unreachable' }, 502)
      : json({ available: true, panes: [] })
  );
  const { onCreated } = mount();
  await userEvent.type(screen.getByLabelText('Room'), 'x');
  await userEvent.type(screen.getByLabelText('Seed'), 'keep me');
  await userEvent.click(screen.getByTestId('new-room-create-only'));
  expect(await screen.findByText(/rt daemon unreachable/)).toBeInTheDocument();
  expect(screen.getByLabelText('Seed')).toHaveValue('keep me');
  expect(onCreated).not.toHaveBeenCalled();
});
