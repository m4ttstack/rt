import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';

import { renderWithProviders } from '@ui/storybook/test-utils';
import { Composer } from './Composer';
import { fetchMock, installFetchMock } from './test-utils';

beforeEach(() => {
  installFetchMock();
});

test('@ autocompletes from the roster, offers DM instead for a buddy outside the room, and warns on deaf', async () => {
  renderWithProviders(
    <Composer
      room="build"
      roomMembers={['acme-dev-42', 'gitq-main']}
      buddies={[
        { handle: 'acme-dev-42', status: 'live' },
        { handle: 'gitq-main', status: 'deaf' },
        { handle: 'board-fix-auth', status: 'idle' },
      ]}
    />
  );
  await userEvent.type(screen.getByRole('textbox'), '@');
  expect(await screen.findByText('acme-dev-42')).toBeInTheDocument();
  expect(screen.getByText('gitq-main')).toBeInTheDocument();
  expect(
    screen.getByText(/won't see this until its tail restarts/)
  ).toBeInTheDocument();
  expect(screen.getByText(/not in #build — DM instead/)).toBeInTheDocument();
  expect(screen.getByText(/@here/)).toHaveTextContent(/wakes 2 agents/);
});

test("choosing DM instead posts through /api/chat/dm and navigates to the pair's room", async () => {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify({ room: 'dm-1a2b3c4d5e6f', id: 3 }))
  );
  const onNavigate = vi.fn();
  renderWithProviders(
    <Composer
      room="build"
      roomMembers={[]}
      onNavigate={onNavigate}
      buddies={[{ handle: 'board-fix-auth', status: 'idle' }]}
    />
  );
  await userEvent.type(
    screen.getByRole('textbox'),
    'can you take the flaky one? @'
  );
  await userEvent.click(await screen.findByText('board-fix-auth'));
  await userEvent.click(screen.getByRole('button', { name: /send/i }));
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/chat/dm',
    expect.objectContaining({ method: 'POST' })
  );
  expect(onNavigate).toHaveBeenCalledWith('dm-1a2b3c4d5e6f');
});

test('the composer is disabled, draft kept, while the daemon is unreachable', async () => {
  const { rerender } = renderWithProviders(
    <Composer
      room="build"
      roomMembers={[]}
      buddies={[]}
      daemonReachable={true}
    />
  );
  await userEvent.type(screen.getByRole('textbox'), 'merge it');
  rerender(
    <Composer
      room="build"
      roomMembers={[]}
      buddies={[]}
      daemonReachable={false}
    />
  );
  expect(screen.getByRole('button', { name: /send/i })).toBeDisabled();
  expect(screen.getByRole('textbox')).toHaveValue('merge it');
});

test('a second send while the first is in flight does not post twice', async () => {
  // ↵ twice, or ↵ while the button tap is already in flight. The draft is
  // only cleared on success, so without a guard the second press has a body
  // and posts the same message again.
  let release: (v: Response) => void = () => {};
  fetchMock.mockImplementationOnce(
    () => new Promise<Response>(r => (release = r))
  );

  renderWithProviders(
    <Composer room="build" roomMembers={[]} buddies={[]} daemonReachable />
  );
  const box = screen.getByRole('textbox');
  await userEvent.type(box, 'ship it');

  await userEvent.click(screen.getByRole('button', { name: /send/i }));
  await userEvent.click(screen.getByRole('button', { name: /send/i }));

  const posts = fetchMock.mock.calls.filter(c =>
    String(c[0]).includes('/api/chat/post')
  );
  expect(posts).toHaveLength(1);

  release(new Response(JSON.stringify({ id: 1 })));
});
