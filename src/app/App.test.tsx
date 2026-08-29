import {
  renderWithProviders,
  setViewportWidth,
} from '@mattstack/app-kit/test-utils';
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test } from 'vitest';

import {
  FakeWebSocket,
  fetchMock,
  installFakeWebSocket,
  installFetchMock,
  restoreWebSocket,
} from './test-utils';

import './icons';

import { App } from './App';

const DESKTOP_WIDTH = window.innerWidth;

// `useBuddies` opens a real `/ws` connection on every mount now (for the
// chat/*/msg refetch) -- stub it the same way Transcript's own suite does,
// rather than letting every test in this file hit jsdom's real WebSocket.
beforeEach(() => {
  installFakeWebSocket();
});

// Reset the URL and the persisted scheme preference so nothing leaks
// across tests.
afterEach(() => {
  window.history.replaceState(null, '', '/');
  window.localStorage.removeItem('ui-color-scheme');
  setViewportWidth(DESKTOP_WIDTH);
  restoreWebSocket();
});

function renderAt(path: string) {
  window.history.replaceState(null, '', path);
  return renderWithProviders(<App />);
}

test('/ renders the chat shell: wordmark, Rooms rail entry, placeholder home', () => {
  renderAt('/');

  expect(screen.getByText('chat')).toBeTruthy();

  const rail = within(screen.getByRole('navigation', { name: 'App sections' }));
  const rooms = rail.getByRole('link', { name: 'Rooms' });
  expect(rooms).toBeTruthy();
  expect(rooms.getAttribute('aria-current')).toBe('page');

  expect(
    within(screen.getByRole('banner')).getByRole('button', { name: 'Apps' })
  ).toBeTruthy();

  expect(screen.getByText('No rooms')).toBeTruthy();
});

test('the rail hosts the color-scheme control', () => {
  renderAt('/');
  const rail = within(screen.getByRole('navigation', { name: 'App sections' }));
  const scheme = () =>
    document.documentElement.getAttribute('data-mantine-color-scheme');

  // vitest.setup.ts's matchMedia polyfill defaults the OS preference to
  // light, so the initial computed scheme under `auto` is deterministic.
  expect(scheme()).toBe('light');

  // `ColorSchemeControl` is a System/Light/Dark `HybridMenu`, not chat's own
  // sun/moon toggle: open it from its rail entry and pick each option.
  fireEvent.click(rail.getByRole('button', { name: 'Color scheme' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Dark' }));
  expect(scheme()).toBe('dark');

  fireEvent.click(rail.getByRole('button', { name: 'Color scheme' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Light' }));
  expect(scheme()).toBe('light');
});

test('the rail expands into labels from its trigger', () => {
  renderAt('/');
  const rail = within(screen.getByRole('navigation', { name: 'App sections' }));

  const roomsLabel = () => rail.getByText('Rooms');
  expect(roomsLabel().getAttribute('aria-hidden')).toBe('true');

  fireEvent.click(rail.getByRole('button', { name: 'Expand navigation' }));
  expect(roomsLabel().getAttribute('aria-hidden')).toBe('false');

  fireEvent.click(rail.getByRole('button', { name: 'Collapse navigation' }));
  expect(roomsLabel().getAttribute('aria-hidden')).toBe('true');
});

test('on mobile the rail opens from the header toggle and navigating closes it', () => {
  setViewportWidth(390);
  renderAt('/');

  fireEvent.click(screen.getByRole('button', { name: 'Toggle navigation' }));
  expect(screen.getByTestId('rail-overlay')).toBeTruthy();

  const rail = within(screen.getByRole('navigation', { name: 'App sections' }));
  fireEvent.click(rail.getByRole('link', { name: 'Rooms' }));

  expect(screen.queryByTestId('rail-overlay')).toBeNull();
});

test('/demo renders the kit full-screen PageShell showcase, bypassing the chat chrome', () => {
  renderAt('/demo');

  expect(
    screen.getByRole('navigation', { name: 'Gear app navigation' })
  ).toBeTruthy();
  expect(screen.queryByRole('navigation', { name: 'App sections' })).toBeNull();
});

test('unknown paths render the not-found page inside the chat chrome', () => {
  renderAt('/no/such/page');

  expect(
    screen.getByRole('heading', { level: 1, name: 'Page not found' })
  ).toBeTruthy();
  expect(screen.getByRole('navigation', { name: 'App sections' })).toBeTruthy();

  fireEvent.click(screen.getByRole('link', { name: /Back home/ }));

  expect(window.location.pathname).toBe('/');
  expect(screen.getByText('No rooms')).toBeTruthy();
});

test('the roster is actually mounted, not merely written', () => {
  renderWithProviders(
    <App
      initialState={{
        daemonReachable: true,
        buddies: [
          {
            sessionId: 's',
            handle: 'rt-chat-wt',
            baseHandle: 'rt-chat-wt',
            signedInAt: 1,
            lastSeenAt: 1,
            status: 'live',
            rooms: [],
          },
        ],
      }}
    />
  );
  expect(screen.getByTestId('row-rt-chat-wt')).toBeInTheDocument();
});

test('seeded messages survive to the first room, even if the fetch rejects', async () => {
  // `activeRoom` is undefined on the first render, so a seed bound to `room`
  // at mount binds to undefined and is discarded the moment a real room
  // lands. The seed then only ever worked when the fetch happened to return
  // the same thing -- which is the seam not working at all.
  installFetchMock();
  fetchMock.mockRejectedValue(new Error('network down'));

  renderWithProviders(
    <App
      initialState={{
        daemonReachable: true,
        rooms: [{ room: 'build', memberCount: 1, unread: 0, mentions: 0 }],
        messages: [
          {
            id: 7,
            room: 'build',
            handle: 'deck-main',
            body: 'seeded body',
            mentions: [],
            postedAt: 1,
          },
        ],
      }}
    />
  );

  // textContent, not getByText: message bodies are split into spans so
  // mentions can carry their own colour.
  const transcript = await screen.findByTestId('transcript');
  expect(transcript).toHaveTextContent('seeded body');
});

const twoRooms = {
  daemonReachable: true,
  buddies: [],
  rooms: [
    { room: 'build', memberCount: 1, unread: 0, mentions: 0 },
    { room: 'ops', memberCount: 1, unread: 0, mentions: 0 },
  ],
  messages: [],
  members: [],
};

test('a malformed room escape renders not-found instead of throwing', () => {
  renderAt('/r/%E0%A4%A');
  expect(screen.getByText('Nothing lives at this address.')).toBeTruthy();
});

test('/r/<room> opens that room instead of the first one', () => {
  window.history.replaceState(null, '', '/r/ops');
  renderWithProviders(<App initialState={twoRooms} />);
  expect(
    within(screen.getByTestId('page-bar')).getByText('ops')
  ).toBeInTheDocument();
});

test('picking a room in the rail moves the URL to /r/<room>', () => {
  window.history.replaceState(null, '', '/');
  renderWithProviders(<App initialState={twoRooms} />);
  fireEvent.click(screen.getByText('ops'));
  expect(window.location.pathname).toBe('/r/ops');
  expect(
    within(screen.getByTestId('page-bar')).getByText('ops')
  ).toBeInTheDocument();
});

test('a #m-<id> anchor scrolls that message into view', () => {
  const scrolled: string[] = [];
  const original = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function () {
    scrolled.push((this as Element).id);
  };
  try {
    window.history.replaceState(null, '', '/r/build#m-7');
    renderWithProviders(
      <App
        initialState={{
          ...twoRooms,
          messages: [
            {
              id: 7,
              room: 'build',
              handle: 'deck-main',
              body: 'anchored',
              mentions: [],
              postedAt: 1,
            },
          ],
        }}
      />
    );
    expect(scrolled).toContain('m-7');
  } finally {
    Element.prototype.scrollIntoView = original;
  }
});

test('Back to / after picking a room shows the first room again', () => {
  window.history.replaceState(null, '', '/');
  renderWithProviders(<App initialState={twoRooms} />);
  fireEvent.click(screen.getByText('ops'));
  expect(
    within(screen.getByTestId('page-bar')).getByText('ops')
  ).toBeInTheDocument();
  act(() => {
    window.history.replaceState(null, '', '/');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  expect(
    within(screen.getByTestId('page-bar')).getByText('build')
  ).toBeInTheDocument();
});

test('a same-room hash change scrolls to the new anchor', () => {
  const scrolled: string[] = [];
  const original = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function () {
    scrolled.push((this as Element).id);
  };
  try {
    window.history.replaceState(null, '', '/r/build#m-7');
    renderWithProviders(
      <App
        initialState={{
          ...twoRooms,
          messages: [
            {
              id: 7,
              room: 'build',
              handle: 'deck-main',
              body: 'one',
              mentions: [],
              postedAt: 1,
            },
            {
              id: 8,
              room: 'build',
              handle: 'deck-main',
              body: 'two',
              mentions: [],
              postedAt: 2,
            },
          ],
        }}
      />
    );
    expect(scrolled).toEqual(['m-7']);
    act(() => {
      window.history.replaceState(null, '', '/r/build#m-8');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(scrolled).toEqual(['m-7', 'm-8']);
  } finally {
    Element.prototype.scrollIntoView = original;
  }
});

test('the rooms rail lives in the PageShell sidebar and the roster is the right panel', () => {
  window.history.replaceState(null, '', '/r/build');
  renderWithProviders(<App initialState={twoRooms} />);
  const sidebar = document.getElementById('page-shell-sidebar');
  expect(sidebar).not.toBeNull();
  expect(
    within(sidebar as HTMLElement).getByTestId('room-rail')
  ).toBeInTheDocument();
  const content = document.getElementById('page-shell-content');
  expect(content).not.toBeNull();
  expect(
    within(content as HTMLElement).getByTestId('transcript')
  ).toBeInTheDocument();
  expect(
    within(content as HTMLElement).getByTestId('roster')
  ).toBeInTheDocument();
  expect(
    within(screen.getByTestId('page-bar')).getByText('build')
  ).toBeInTheDocument();
});

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

test('DM on a sender’s card opens the pair’s room and focuses the composer there', async () => {
  installFetchMock();
  const now = Date.now();
  const dmRoom = {
    room: 'dm-1a2b3c4d5e6f',
    memberCount: 2,
    unread: 0,
    mentions: 0,
    kind: 'dm' as const,
    participants: { a: 'fred', b: 'matt' },
  };
  const build = { room: 'build', memberCount: 2, unread: 0, mentions: 0 };
  fetchMock.mockImplementation((url: string) => {
    if (url === '/api/chat/dm/open')
      return Promise.resolve(
        jsonResponse({ room: dmRoom.room, created: true })
      );
    if (url === '/api/chat/rooms')
      return Promise.resolve(jsonResponse({ rooms: [build, dmRoom] }));
    return Promise.resolve(jsonResponse({}));
  });
  window.history.replaceState(null, '', '/r/build');
  renderWithProviders(
    <App
      initialState={{
        daemonReachable: true,
        buddies: [
          {
            sessionId: 's',
            handle: 'fred',
            baseHandle: 'fred',
            signedInAt: now,
            lastSeenAt: now,
            status: 'live',
            rooms: ['build'],
          },
        ],
        rooms: [build],
        members: [
          {
            room: 'build',
            handle: 'fred',
            joinedAt: now,
            lastReadId: 0,
            wakeOn: 'mention',
            status: 'live',
          },
        ],
        messages: [
          {
            id: 7,
            room: 'build',
            handle: 'fred',
            body: 'hello',
            mentions: [],
            postedAt: now,
          },
        ],
      }}
    />
  );
  const transcript = await screen.findByTestId('transcript');
  await userEvent.hover(within(transcript).getByText('fred'));
  await userEvent.click(await screen.findByTestId('card-dm-fred'));

  expect(fetchMock).toHaveBeenCalledWith(
    '/api/chat/dm/open',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ to: 'fred' }),
    })
  );
  await screen.findByTestId(`room-row-${dmRoom.room}`);
  expect(window.location.pathname).toBe(`/r/${dmRoom.room}`);
  // `focus()` defers through requestAnimationFrame.
  await waitFor(() =>
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveFocus()
  );
  expect(screen.queryByText(/direct message to/)).toBeNull();
});

test('an archived room renders the archived bar instead of the composer, and Reopen posts archived:false', async () => {
  installFetchMock();
  window.history.replaceState(null, '', '/r/retro');
  renderWithProviders(
    <App
      initialState={{
        daemonReachable: true,
        buddies: [],
        rooms: [
          {
            room: 'retro',
            memberCount: 1,
            unread: 0,
            mentions: 0,
            archivedAt: Date.now() - 3 * 86_400_000,
          },
        ],
        members: [],
        messages: [
          {
            id: 1,
            room: 'retro',
            handle: 'fred',
            body: 'closing out',
            mentions: [],
            postedAt: Date.now(),
          },
        ],
      }}
    />
  );
  expect(await screen.findByTestId('archived-bar')).toBeInTheDocument();
  expect(screen.queryByTestId('composer')).toBeNull();
  expect(screen.queryByTestId('mark-read-button')).toBeNull();
  await userEvent.click(screen.getByTestId('archived-reopen'));
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/chat/archive',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ room: 'retro', archived: false }),
    })
  );
});

test('the home route lands on the first OPEN room when an archived room sorts first', () => {
  window.history.replaceState(null, '', '/');
  renderWithProviders(
    <App
      initialState={{
        daemonReachable: true,
        buddies: [],
        rooms: [
          {
            room: 'archived-first',
            memberCount: 1,
            unread: 0,
            mentions: 0,
            archivedAt: Date.now() - 3 * 86_400_000,
          },
          { room: 'build', memberCount: 1, unread: 0, mentions: 0 },
        ],
        members: [],
        messages: [],
      }}
    />
  );
  expect(
    within(screen.getByTestId('page-bar')).getByText('build')
  ).toBeInTheDocument();
  expect(screen.queryByTestId('archived-bar')).toBeNull();
  expect(screen.getByTestId('composer')).toBeInTheDocument();
});

test('archiving the active room navigates away when it vanishes from the refetched list', async () => {
  installFetchMock();
  const build = { room: 'build', memberCount: 1, unread: 0, mentions: 0 };
  fetchMock.mockImplementation((url: string) => {
    if (url === '/api/chat/archive')
      return Promise.resolve(jsonResponse({ ok: true }));
    // The archived room is gone from the human's listing (the fleet-DM case:
    // no membership row survives the archive); only `build` comes back.
    if (url === '/api/chat/rooms')
      return Promise.resolve(jsonResponse({ rooms: [build] }));
    return Promise.resolve(jsonResponse({}));
  });
  window.history.replaceState(null, '', '/r/ghost');
  renderWithProviders(
    <App
      initialState={{
        daemonReachable: true,
        buddies: [],
        rooms: [
          { room: 'ghost', memberCount: 1, unread: 0, mentions: 0 },
          build,
        ],
        members: [],
        messages: [],
      }}
    />
  );
  await userEvent.click(screen.getByTestId('room-menu'));
  await userEvent.click(await screen.findByTestId('room-menu-archive'));
  await userEvent.click(screen.getByRole('button', { name: 'Archive' }));

  await waitFor(() => expect(window.location.pathname).toBe('/r/build'));
  expect(
    within(screen.getByTestId('page-bar')).getByText('build')
  ).toBeInTheDocument();
  expect(screen.getByTestId('composer')).toBeInTheDocument();
});

test("a chat/<room>/msg frame refetches the open room's members", async () => {
  installFetchMock();
  fetchMock.mockImplementation(
    async (url: string) =>
      new Response(
        JSON.stringify(
          String(url).startsWith('/api/chat/who/')
            ? {
                members: [
                  {
                    room: 'build',
                    handle: 'fred',
                    joinedAt: 1,
                    lastReadId: 0,
                    wakeOn: 'mention',
                    status: 'live',
                  },
                ],
              }
            : {}
        )
      )
  );
  window.history.replaceState(null, '', '/r/build');
  await act(async () => {
    renderWithProviders(<App initialState={{ ...twoRooms, members: [] }} />);
  });
  const before = fetchMock.mock.calls.filter(([u]) =>
    String(u).startsWith('/api/chat/who/build')
  ).length;
  await act(async () => {
    for (const socket of FakeWebSocket.instances)
      socket.onmessage?.({
        data: JSON.stringify({ topic: 'chat/build/msg', payload: { id: 7 } }),
      });
  });
  const after = fetchMock.mock.calls.filter(([u]) =>
    String(u).startsWith('/api/chat/who/build')
  ).length;
  expect(after).toBeGreaterThan(before);
});

test('the entry points hide while herdr is unavailable and show once /api/panes says available', async () => {
  installFetchMock();
  fetchMock.mockImplementation(
    async (url: string) =>
      new Response(
        JSON.stringify(
          String(url).startsWith('/api/panes')
            ? { available: false, panes: [] }
            : {}
        )
      )
  );
  window.history.replaceState(null, '', '/r/build');
  const { unmount } = renderWithProviders(<App initialState={twoRooms} />);
  await act(async () => {});
  expect(screen.queryByTestId('new-room-button')).toBeNull();
  expect(screen.queryByTestId('add-agents-button')).toBeNull();
  unmount();
  fetchMock.mockImplementation(
    async (url: string) =>
      new Response(
        JSON.stringify(
          String(url).startsWith('/api/panes')
            ? { available: true, panes: [] }
            : {}
        )
      )
  );
  renderWithProviders(<App initialState={twoRooms} />);
  expect(await screen.findByTestId('new-room-button')).toBeInTheDocument();
  expect(screen.getByTestId('add-agents-button')).toBeInTheDocument();
});

test('a daemon-down 502 from /api/panes keeps the entry points mounted (disabled, not hidden)', async () => {
  installFetchMock();
  fetchMock.mockImplementation(async (url: string) =>
    String(url).startsWith('/api/panes')
      ? new Response(JSON.stringify({ error: 'rt daemon unreachable' }), {
          status: 502,
        })
      : new Response(JSON.stringify({}))
  );
  window.history.replaceState(null, '', '/r/build');
  renderWithProviders(<App initialState={twoRooms} />);
  expect(await screen.findByTestId('new-room-button')).toBeInTheDocument();
  expect(screen.getByTestId('add-agents-button')).toBeInTheDocument();
});

test('add agents invites the picked panes and shows the result line on the transcript edge', async () => {
  installFetchMock();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const path = String(url).split('?')[0];
    if (path === '/api/panes')
      return new Response(
        JSON.stringify({
          available: true,
          panes: [
            {
              paneId: 'w1:p4',
              workspace: 'acme',
              title: 'Evaluate codegen',
              cwd: '/r/acme',
              agentStatus: 'idle',
            },
          ],
        })
      );
    if (path === '/api/chat/invite' && init?.method === 'POST')
      return new Response(
        JSON.stringify({
          results: [{ paneId: 'w1:p4', delivered: 'accepted' }],
        })
      );
    return new Response(JSON.stringify({}));
  });
  window.history.replaceState(null, '', '/r/build');
  renderWithProviders(
    <App
      initialState={{
        ...twoRooms,
        messages: [
          {
            id: 1,
            room: 'build',
            handle: 'meg',
            body: 'hi',
            mentions: [],
            postedAt: 1,
          },
        ],
      }}
    />
  );
  await userEvent.click(await screen.findByTestId('add-agents-button'));
  await userEvent.click(await screen.findByTestId('pane-check-w1:p4'));
  await userEvent.click(screen.getByTestId('pane-use'));
  expect(await screen.findByTestId('transcript-notice')).toHaveTextContent(
    'invited 1 · acme pane accepted'
  );
});
