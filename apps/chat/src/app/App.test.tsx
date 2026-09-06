import { notifications } from '@mattstack/app-kit/notifications';
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
import { PAGE_SIZE } from './Transcript';

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
  // The mobile-viewport test below leaves `chat-rooms-sidebar` collapsed:
  // `PageShell`'s own mobile effect persists `sidebarOpen: false` to this
  // key regardless of which test set the viewport, and a later desktop
  // test would otherwise inherit a collapsed (pointer-events: none) rail.
  window.localStorage.removeItem('chat-rooms-sidebar');
  setViewportWidth(DESKTOP_WIDTH);
  // The notifications store lives outside React (a module-level singleton),
  // so an error toast from one test survives that test's unmount and can
  // collide with a later test asserting the same message.
  notifications.clean();
  restoreWebSocket();
});

function renderAt(path: string) {
  window.history.replaceState(null, '', path);
  return renderWithProviders(<App />);
}

test('/ is the Inbox: the rail names both views and the landing view is the inbox', () => {
  renderAt('/');

  expect(screen.getByText('chat')).toBeTruthy();

  const rail = within(screen.getByRole('navigation', { name: 'App sections' }));
  const inbox = rail.getByRole('link', { name: 'Inbox' });
  expect(inbox.getAttribute('aria-current')).toBe('page');
  expect(
    rail.getByRole('link', { name: 'Rooms' }).getAttribute('aria-current')
  ).toBeNull();

  expect(
    within(screen.getByRole('banner')).getByRole('button', { name: 'Apps' })
  ).toBeTruthy();

  expect(screen.getByTestId('inbox-bar')).toHaveTextContent('Inbox');
  expect(screen.getByTestId('inbox-elsewhere-note')).toBeInTheDocument();
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

test('on mobile, `/` is the phone inbox shell, not the desktop rail', async () => {
  setViewportWidth(390);
  window.history.replaceState(null, '', '/');
  renderWithProviders(
    <App
      initialState={{
        daemonReachable: true,
        rooms: [{ room: 'build', memberCount: 1, unread: 0, mentions: 0 }],
      }}
    />
  );

  expect(screen.getByTestId('phone-inbox-shell')).toBeInTheDocument();
  expect(screen.queryByRole('navigation', { name: 'App sections' })).toBeNull();

  await userEvent.click(
    screen.getByRole('button', { name: 'Rooms and members' })
  );
  const drawer = within(await screen.findByTestId('phone-drawer'));
  expect(await drawer.findByTestId('room-row-build')).toBeInTheDocument();
  expect(drawer.queryByText(/buddies/i)).toBeNull();

  await userEvent.click(drawer.getByRole('button', { name: 'Close' }));
  await waitFor(() =>
    expect(screen.queryByTestId('room-row-build')).toBeNull()
  );
});

test('the phone transcript wrapper is a flex column, so the bare transcript can size itself', () => {
  // Regression: a plain (block) wrapper Box gives the bare Transcript root no
  // flex context to size against, so its own inner scroll box (also
  // `flex: 1; min-height: 0`) collapses to zero height and the transcript
  // renders empty on a phone. jsdom never computes real layout, so this pins
  // the wrapper's actual style contract instead of a faked measurement.
  setViewportWidth(390);
  window.history.replaceState(null, '', '/r/build');
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

  expect(screen.getByTestId('phone-shell')).toBeInTheDocument();
  const wrapper = screen.getByTestId('transcript').parentElement;
  expect(wrapper).toHaveStyle({ display: 'flex', flexDirection: 'column' });
  expect(wrapper).not.toHaveStyle({ overflowY: 'auto' });
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
  expect(screen.getByTestId('inbox-bar')).toBeInTheDocument();
});

test('the fleet tree lists every buddy, repo or no repo', () => {
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
  // No `repo` on this presence row, so it heads its own `no repo` group
  // rather than dropping out of the only listing the fleet has.
  expect(screen.getByTestId('ws-rt-chat-wt')).toBeInTheDocument();
  expect(screen.getByTestId('repo-row-no repo')).toHaveTextContent('no room');
});

test('seeded messages survive to the opened room, even if the fetch rejects', async () => {
  // `activeRoom` is undefined on the first render, so a seed bound to `room`
  // at mount binds to undefined and is discarded the moment a real room
  // lands. The seed then only ever worked when the fetch happened to return
  // the same thing -- which is the seam not working at all.
  installFetchMock();
  fetchMock.mockRejectedValue(new Error('network down'));
  window.history.replaceState(null, '', '/r/build');

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

test('Back to / after picking a room returns to the inbox, with no room open', () => {
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
  expect(screen.queryByTestId('page-bar')).toBeNull();
  expect(screen.getByTestId('inbox-bar')).toBeInTheDocument();
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

test('the fleet tree lives in the PageShell sidebar, and no roster panel remains', () => {
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
  expect(screen.queryByTestId('roster')).toBeNull();
  expect(screen.queryByTestId('room-order')).toBeNull();
  expect(
    within(screen.getByTestId('page-bar')).getByText('build')
  ).toBeInTheDocument();
});

test('with every room closed, a room link still mounts the rail and says rooms come back', () => {
  window.history.replaceState(null, '', '/r/gone');
  renderWithProviders(
    <App
      initialState={{
        daemonReachable: true,
        buddies: [],
        rooms: [
          {
            room: 'build',
            memberCount: 1,
            unread: 0,
            mentions: 0,
            archivedAt: Date.now(),
          },
        ],
        messages: [],
        members: [],
      }}
    />
  );
  expect(screen.getByTestId('room-rail')).toBeInTheDocument();
  expect(
    screen.getByText(
      'Every room is closed. A post from anyone brings its room back, and the + starts a new one.'
    )
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
  await screen.findByTestId(`dm-row-${dmRoom.room}`);
  expect(window.location.pathname).toBe(`/r/${dmRoom.room}`);
  // `focus()` defers through requestAnimationFrame.
  await waitFor(() =>
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveFocus()
  );
  expect(screen.queryByText(/direct message to/)).toBeNull();
});

test('Focus pane on a buddy in a herdr pane posts to that pane’s focus route', async () => {
  installFetchMock();
  const now = Date.now();
  const build = { room: 'build', memberCount: 2, unread: 0, mentions: 0 };
  fetchMock.mockImplementation((url: string) => {
    if (url === '/api/panes/w1:p1/focus')
      return Promise.resolve(jsonResponse({ paneId: 'w1:p1', focused: true }));
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
            pane: 'w1:p1',
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
  await userEvent.click(await screen.findByTestId('card-focus-fred'));

  expect(fetchMock).toHaveBeenCalledWith(
    '/api/panes/w1:p1/focus',
    expect.objectContaining({ method: 'POST' })
  );
});

test('a buddy with no herdr pane shows no Focus pane button', async () => {
  installFetchMock();
  const now = Date.now();
  const build = { room: 'build', memberCount: 2, unread: 0, mentions: 0 };
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
  await screen.findByTestId('card-dm-fred');
  expect(screen.queryByTestId('card-focus-fred')).toBeNull();
});

function errorResponse(status: number): Response {
  return {
    ok: false,
    status,
    json: async () => ({ error: 'nope' }),
  } as Response;
}

test('the rail’s Rooms entry points at the first OPEN room, and a closed room is never listed', () => {
  window.history.replaceState(null, '', '/');
  renderWithProviders(
    <App
      initialState={{
        daemonReachable: true,
        buddies: [],
        rooms: [
          {
            room: 'closed-first',
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
  const rail = within(screen.getByRole('navigation', { name: 'App sections' }));
  expect(rail.getByRole('link', { name: 'Rooms' })).toHaveAttribute(
    'href',
    '/r/build'
  );
  expect(screen.queryByTestId('archived-bar')).toBeNull();
  expect(screen.queryByTestId('room-row-closed-first')).toBeNull();
});

test('a closed room reached by link opens with a live composer and is listed only while open', async () => {
  installFetchMock();
  window.history.replaceState(null, '', '/r/retro');
  renderWithProviders(
    <App
      initialState={{
        daemonReachable: true,
        buddies: [],
        rooms: [
          { room: 'build', memberCount: 1, unread: 0, mentions: 0 },
          {
            room: 'retro',
            memberCount: 1,
            unread: 0,
            mentions: 0,
            archivedAt: Date.now() - 3 * 86_400_000,
          },
        ],
        members: [],
        messages: [],
      }}
    />
  );
  expect(screen.getByTestId('composer')).toBeInTheDocument();
  expect(screen.queryByTestId('archived-bar')).toBeNull();
  expect(screen.getByTestId('room-row-retro').dataset.active).toBe('true');
  expect(screen.queryByText(/archiv/i)).toBeNull();
  await userEvent.click(screen.getByTestId('room-row-build'));
  await waitFor(() => expect(window.location.pathname).toBe('/r/build'));
  expect(screen.queryByTestId('room-row-retro')).toBeNull();
});

test('closing the open room from the rail lands on the inbox', async () => {
  installFetchMock();
  const build = { room: 'build', memberCount: 1, unread: 0, mentions: 0 };
  fetchMock.mockImplementation((url: string) => {
    if (url === '/api/chat/close')
      return Promise.resolve(jsonResponse({ room: 'ghost', closedAt: 5 }));
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
  await userEvent.hover(screen.getByTestId('room-row-ghost'));
  await userEvent.click(await screen.findByTestId('room-close-ghost'));
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/chat/close',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ room: 'ghost' }),
    })
  );
  await waitFor(() => expect(window.location.pathname).toBe('/'));
  expect(screen.getByTestId('inbox-bar')).toBeInTheDocument();
  expect(screen.queryByTestId('room-row-ghost')).toBeNull();
});

test('closing another room from its rail × drops the row at once and keeps the page', async () => {
  installFetchMock();
  fetchMock.mockImplementation((url: string) => {
    if (url === '/api/chat/close')
      return Promise.resolve(jsonResponse({ room: 'ghost', closedAt: 5 }));
    if (url === '/api/chat/rooms')
      return Promise.resolve(
        jsonResponse({
          rooms: [{ room: 'build', memberCount: 1, unread: 0, mentions: 0 }],
        })
      );
    return Promise.resolve(jsonResponse({}));
  });
  window.history.replaceState(null, '', '/r/build');
  renderWithProviders(
    <App
      initialState={{
        daemonReachable: true,
        buddies: [],
        rooms: [
          { room: 'build', memberCount: 1, unread: 0, mentions: 0 },
          { room: 'ghost', memberCount: 1, unread: 2, mentions: 0 },
        ],
        members: [],
        messages: [],
      }}
    />
  );
  await userEvent.hover(screen.getByTestId('room-row-ghost'));
  await userEvent.click(screen.getByTestId('room-close-ghost'));
  expect(screen.queryByTestId('room-row-ghost')).toBeNull();
  expect(window.location.pathname).toBe('/r/build');
  expect(
    within(screen.getByTestId('page-bar')).getByText('build')
  ).toBeInTheDocument();
});

test('a failed close restores the row and says so', async () => {
  installFetchMock();
  fetchMock.mockImplementation((url: string) => {
    if (url === '/api/chat/close') return Promise.resolve(errorResponse(502));
    return Promise.resolve(jsonResponse({}));
  });
  window.history.replaceState(null, '', '/r/build');
  renderWithProviders(
    <App
      initialState={{
        daemonReachable: true,
        buddies: [],
        rooms: [
          { room: 'build', memberCount: 1, unread: 0, mentions: 0 },
          { room: 'ghost', memberCount: 1, unread: 0, mentions: 0 },
        ],
        members: [],
        messages: [],
      }}
    />
  );
  await userEvent.hover(screen.getByTestId('room-row-ghost'));
  await userEvent.click(screen.getByTestId('room-close-ghost'));
  expect(
    await screen.findByText("Couldn't close the room")
  ).toBeInTheDocument();
  expect(screen.getByTestId('room-row-ghost')).toBeInTheDocument();
});

test('the row leaves the rail before the close resolves, and comes back when it fails', async () => {
  installFetchMock();
  let rejectClose!: (e: Error) => void;
  fetchMock.mockImplementation((url: string) => {
    if (url === '/api/chat/close')
      return new Promise<Response>((_, reject) => {
        rejectClose = reject;
      });
    // Both rooms, always: if the row's absence were explained by a refetch
    // landing rather than the optimistic filter, this response would put
    // `ghost` right back before the assertion below runs.
    if (url === '/api/chat/rooms')
      return Promise.resolve(
        jsonResponse({
          rooms: [
            { room: 'build', memberCount: 1, unread: 0, mentions: 0 },
            { room: 'ghost', memberCount: 1, unread: 0, mentions: 0 },
          ],
        })
      );
    return Promise.resolve(jsonResponse({}));
  });
  window.history.replaceState(null, '', '/r/build');
  renderWithProviders(
    <App
      initialState={{
        daemonReachable: true,
        buddies: [],
        rooms: [
          { room: 'build', memberCount: 1, unread: 0, mentions: 0 },
          { room: 'ghost', memberCount: 1, unread: 0, mentions: 0 },
        ],
        members: [],
        messages: [],
      }}
    />
  );
  await userEvent.hover(screen.getByTestId('room-row-ghost'));
  await userEvent.click(screen.getByTestId('room-close-ghost'));

  // The close request is still pending (rejectClose hasn't been called yet):
  // the row is gone and the page hasn't moved, so only the optimistic
  // removal -- not a response -- explains it.
  expect(screen.queryByTestId('room-row-ghost')).toBeNull();
  expect(window.location.pathname).toBe('/r/build');

  await act(async () => {
    rejectClose(new Error('boom'));
  });

  expect(
    await screen.findByText("Couldn't close the room")
  ).toBeInTheDocument();
  expect(screen.getByTestId('room-row-ghost')).toBeInTheDocument();
});

test('the rail menu’s Mark read posts the mark and refetches rooms', async () => {
  installFetchMock();
  let marked = false;
  fetchMock.mockImplementation((url: string) => {
    if (url === '/api/chat/mark') {
      marked = true;
      return Promise.resolve(jsonResponse({}));
    }
    if (url === '/api/chat/rooms')
      return Promise.resolve(
        jsonResponse({
          rooms: [
            {
              room: 'build',
              memberCount: 1,
              unread: marked ? 0 : 3,
              mentions: 0,
            },
          ],
        })
      );
    return Promise.resolve(jsonResponse({}));
  });
  window.history.replaceState(null, '', '/r/build');
  renderWithProviders(
    <App
      initialState={{
        daemonReachable: true,
        buddies: [],
        rooms: [{ room: 'build', memberCount: 1, unread: 3, mentions: 0 }],
        members: [],
        messages: [],
      }}
    />
  );
  fireEvent.contextMenu(screen.getByTestId('room-row-build'));
  await userEvent.click(await screen.findByTestId('room-context-mark-read'));
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/chat/mark',
    expect.objectContaining({ body: JSON.stringify({ room: 'build' }) })
  );
  await waitFor(() =>
    expect(
      within(screen.getByTestId('room-row-build')).queryByTestId('unread-badge')
    ).toBeNull()
  );
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

test('opening a room asks for one page of messages, never the whole history', async () => {
  installFetchMock();
  window.history.replaceState(null, '', '/r/build');
  await act(async () => {
    renderWithProviders(
      <App
        initialState={{
          daemonReachable: true,
          rooms: [{ room: 'build', memberCount: 1, unread: 0, mentions: 0 }],
        }}
      />
    );
  });
  const urls = fetchMock.mock.calls
    .map(([u]) => String(u))
    .filter(u => u.startsWith('/api/chat/messages/build'));
  expect(urls).toContain(`/api/chat/messages/build?limit=${PAGE_SIZE}`);
});

test('a msg frame for a room the rail does not know refetches rooms at once', async () => {
  installFetchMock();
  fetchMock.mockImplementation((url: string) =>
    Promise.resolve(
      jsonResponse(
        url === '/api/chat/rooms'
          ? {
              rooms: [
                { room: 'build', memberCount: 1, unread: 0, mentions: 0 },
                { room: 'fresh', memberCount: 1, unread: 1, mentions: 0 },
              ],
            }
          : {}
      )
    )
  );
  window.history.replaceState(null, '', '/r/build');
  await act(async () => {
    renderWithProviders(
      <App
        initialState={{
          daemonReachable: true,
          buddies: [],
          rooms: [{ room: 'build', memberCount: 1, unread: 0, mentions: 0 }],
          members: [],
          messages: [],
        }}
      />
    );
  });
  const before = fetchMock.mock.calls.filter(
    ([u]) => u === '/api/chat/rooms'
  ).length;
  await act(async () => {
    for (const socket of FakeWebSocket.instances)
      socket.onmessage?.({
        data: JSON.stringify({ topic: 'chat/fresh/msg', payload: { id: 9 } }),
      });
  });
  expect(
    fetchMock.mock.calls.filter(([u]) => u === '/api/chat/rooms').length
  ).toBe(before + 1);
  expect(await screen.findByTestId('room-row-fresh')).toBeInTheDocument();
  await act(async () => {
    for (const socket of FakeWebSocket.instances)
      socket.onmessage?.({
        data: JSON.stringify({ topic: 'chat/build/msg', payload: { id: 10 } }),
      });
  });
  expect(
    fetchMock.mock.calls.filter(([u]) => u === '/api/chat/rooms').length
  ).toBe(before + 1);
});

test('a reconnect and a tab becoming visible refetch rooms, buddies and members, in that order', async () => {
  installFetchMock();
  fetchMock.mockImplementation((url: string) =>
    Promise.resolve(
      jsonResponse(
        url === '/api/chat/rooms'
          ? {
              rooms: [
                { room: 'build', memberCount: 1, unread: 0, mentions: 0 },
              ],
            }
          : { buddies: [], members: [] }
      )
    )
  );
  window.history.replaceState(null, '', '/r/build');
  await act(async () => {
    renderWithProviders(<App initialState={{ ...twoRooms, members: [] }} />);
  });
  const socket = FakeWebSocket.instances[0]!;
  await act(async () => {
    socket.onopen?.();
  });
  fetchMock.mockClear();
  await act(async () => {
    socket.onclose?.();
  });
  const again = FakeWebSocket.instances.at(-1)!;
  await act(async () => {
    again.onopen?.();
  });
  await waitFor(() => {
    const urls = fetchMock.mock.calls.map(([u]) => String(u));
    expect(urls.indexOf('/api/chat/rooms')).toBeGreaterThanOrEqual(0);
    expect(urls.indexOf('/api/chat/buddies')).toBeGreaterThan(
      urls.indexOf('/api/chat/rooms')
    );
    expect(
      urls.findIndex(u => u.startsWith('/api/chat/who/build'))
    ).toBeGreaterThan(urls.indexOf('/api/chat/buddies'));
  });

  fetchMock.mockClear();
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => 'visible',
  });
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await waitFor(() =>
    expect(fetchMock.mock.calls.some(([u]) => u === '/api/chat/rooms')).toBe(
      true
    )
  );
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

const inboxPayload = {
  needsYou: [
    {
      room: 'build',
      kind: 'room' as const,
      messageId: 412,
      handle: 'meg',
      postedAt: Date.now() - 60_000,
      excerpt: '@matt is the exporter ready to ship?',
      reason: 'mention' as const,
    },
  ],
  openAsks: [],
  elsewhere: [{ room: 'ops', kind: 'room' as const, unread: 9, mentions: 0 }],
};

const EMPTY_INBOX = { needsYou: [], openAsks: [], elsewhere: [] };

/** `/api/chat/inbox` answers with `payload`; the reader's window fetch
    answers with the opened message alone. Every other route is empty. */
function serveInbox(payload = inboxPayload) {
  installFetchMock();
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/chat/inbox') return jsonResponse(payload);
    if (url.startsWith('/api/chat/messages/'))
      return jsonResponse({
        messages: [
          {
            id: 412,
            room: 'build',
            handle: 'meg',
            body: '@matt is the exporter ready to ship?',
            mentions: ['matt'],
            postedAt: payload.needsYou[0]?.postedAt ?? 1,
          },
        ],
      });
    return jsonResponse({});
  });
}

test('the inbox lands from /api/chat/inbox, with the first card already in the reader', async () => {
  serveInbox();
  window.history.replaceState(null, '', '/');
  renderWithProviders(<App />);

  expect(await screen.findByTestId('inbox-card-412')).toBeInTheDocument();
  expect(screen.getByTestId('inbox-card-412').dataset.open).toBe('true');
  expect(await screen.findByTestId('reader-message-412')).toHaveTextContent(
    'is the exporter ready to ship?'
  );
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/chat/messages/build?before=413&limit=2'
  );
});

test('a chat/<room>/msg frame refetches the inbox, the same rule the rail follows', async () => {
  serveInbox();
  window.history.replaceState(null, '', '/');
  renderWithProviders(<App />);
  await screen.findByTestId('inbox-card-412');

  const calls = () =>
    fetchMock.mock.calls.filter(c => String(c[0]) === '/api/chat/inbox').length;
  const before = calls();
  act(() => {
    FakeWebSocket.instances.at(-1)?.onmessage?.({
      data: JSON.stringify({ topic: 'chat/build/msg', payload: { id: 9 } }),
    });
  });
  await waitFor(() => expect(calls()).toBeGreaterThan(before));
});

test('a card’s mark read posts the room-level mark and refetches the inbox', async () => {
  serveInbox();
  window.history.replaceState(null, '', '/');
  renderWithProviders(<App />);
  await screen.findByTestId('inbox-card-412');

  await userEvent.click(
    screen.getByRole('button', { name: /mark #build read/i })
  );
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/chat/mark',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ room: 'build' }),
      })
    )
  );
});

test('mark all read is the per-room mark, once per room that has unread', async () => {
  serveInbox();
  window.history.replaceState(null, '', '/');
  renderWithProviders(
    <App
      initialState={{
        daemonReachable: true,
        buddies: [],
        rooms: [
          { room: 'build', memberCount: 1, unread: 1, mentions: 1 },
          { room: 'ops', memberCount: 1, unread: 9, mentions: 0 },
          { room: 'quiet', memberCount: 1, unread: 0, mentions: 0 },
        ],
        members: [],
      }}
    />
  );
  await screen.findByTestId('inbox-card-412');

  await userEvent.click(screen.getByTestId('inbox-mark-all-read'));
  await waitFor(() => {
    const marked = fetchMock.mock.calls
      .filter(c => String(c[0]) === '/api/chat/mark')
      .map(c => (c[1] as RequestInit).body);
    expect(marked).toEqual([
      JSON.stringify({ room: 'build' }),
      JSON.stringify({ room: 'ops' }),
    ]);
  });
});

test('open on a card leaves the inbox for the room, parked on that message', async () => {
  serveInbox();
  window.history.replaceState(null, '', '/');
  renderWithProviders(<App />);
  await screen.findByTestId('inbox-card-412');

  await userEvent.click(screen.getByTestId('card-open-412'));
  await waitFor(() => expect(window.location.pathname).toBe('/r/build'));
  expect(window.location.hash).toBe('#m-412');
});

test('phone: tapping a card opens the reader in place, and back returns to the same list node', async () => {
  serveInbox();
  setViewportWidth(390);
  window.history.replaceState(null, '', '/');
  renderWithProviders(<App />);
  await screen.findByTestId('inbox-card-412');

  expect(screen.getByTestId('phone-inbox-list')).toHaveStyle({
    visibility: 'visible',
  });
  expect(screen.queryByTestId('phone-inbox-reader')).toBeNull();
  const list = screen.getByTestId('phone-inbox-list');

  await userEvent.click(screen.getByTestId('card-lead-412'));
  expect(await screen.findByTestId('reader-phone-header')).toHaveTextContent(
    'meg needs you'
  );
  // The list stays mounted and laid out (never `display: none`) -- its
  // scroll position survives; see the toggle's own comment for why.
  expect(screen.getByTestId('phone-inbox-list')).toBe(list);
  expect(screen.getByTestId('phone-inbox-list')).toHaveStyle({
    visibility: 'hidden',
  });

  await userEvent.click(screen.getByTestId('reader-back'));
  expect(screen.queryByTestId('phone-inbox-reader')).toBeNull();
  expect(screen.getByTestId('phone-inbox-list')).toBe(list);
  expect(screen.getByTestId('phone-inbox-list')).toHaveStyle({
    visibility: 'visible',
  });
});

test('phone: mark-all-read while the reader is open still leaves the list reachable', async () => {
  // A stateful mock, not `serveInbox()`: the scenario needs `/api/chat/inbox`
  // to answer full, then empty, once the reader's own mark-all sweep has
  // run -- `serveInbox()`'s fixed payload never changes across refetches.
  installFetchMock();
  let inboxCalls = 0;
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/chat/inbox') {
      inboxCalls += 1;
      return jsonResponse(inboxCalls === 1 ? inboxPayload : EMPTY_INBOX);
    }
    if (url.startsWith('/api/chat/messages/'))
      return jsonResponse({
        messages: [
          {
            id: 412,
            room: 'build',
            handle: 'meg',
            body: '@matt is the exporter ready to ship?',
            mentions: ['matt'],
            postedAt: inboxPayload.needsYou[0]?.postedAt ?? 1,
          },
        ],
      });
    return jsonResponse({});
  });

  setViewportWidth(390);
  window.history.replaceState(null, '', '/');
  renderWithProviders(<App />);
  await screen.findByTestId('inbox-card-412');

  await userEvent.click(screen.getByTestId('card-lead-412'));
  await screen.findByTestId('reader-phone-header');
  expect(screen.getByTestId('phone-inbox-list')).toHaveStyle({
    visibility: 'hidden',
  });

  await userEvent.click(screen.getByTestId('phone-inbox-mark-all'));

  // The reader's card is gone (mark-all-read emptied the inbox), so the
  // reader itself unmounts, AND the list must not be left hidden with no
  // way back to it.
  await waitFor(() =>
    expect(screen.queryByTestId('reader-phone-header')).toBeNull()
  );
  expect(screen.queryByTestId('phone-inbox-reader')).toBeNull();
  expect(screen.getByTestId('phone-inbox-list')).toHaveStyle({
    visibility: 'visible',
  });
});
