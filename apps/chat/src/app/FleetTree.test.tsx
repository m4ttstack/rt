import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import './icons';

import { FleetTree, type FleetRoom } from './FleetTree';
import type { RosterBuddy } from './roster-types';

const NOW = 1_700_000_000_000;
const M = 60_000;
const H = 60 * M;

/** design/build.py's FLEET table, one row at a time. `signedInAt` counts up
    with the argument order, so a test's own listing IS sign-in order. */
let signIn = 0;
function buddy(
  handle: string,
  repo: string,
  over: Partial<RosterBuddy> = {}
): RosterBuddy {
  signIn += 1;
  return {
    sessionId: `s-${handle}`,
    handle,
    baseHandle: handle,
    repo,
    branch: 'main',
    cwd: `/Users/matt/Documents/GitHub/${repo}`,
    signedInAt: signIn,
    lastSeenAt: NOW - 12_000,
    status: 'live',
    rooms: [repo],
    ...over,
  };
}

function offline(handle: string, repo: string, agoMs: number): RosterBuddy {
  return buddy(handle, repo, { status: 'offline', signedOutAt: NOW - agoMs });
}

function room(name: string, over: Partial<FleetRoom> = {}): FleetRoom {
  return { room: name, memberCount: 2, unread: 0, mentions: 0, ...over };
}

function dm(a: string, b: string, over: Partial<FleetRoom> = {}): FleetRoom {
  return {
    room: `dm-${a}-${b}`,
    memberCount: 3,
    unread: 0,
    mentions: 0,
    kind: 'dm',
    participants: { a, b },
    ...over,
  };
}

function renderTree(props: Partial<Parameters<typeof FleetTree>[0]> = {}) {
  return renderWithProviders(
    <FleetTree rooms={[]} dms={[]} buddies={[]} now={NOW} {...props} />
  );
}

test('every agent sits under the repo room it works in, in sign-in order', () => {
  renderTree({
    rooms: [room('rt'), room('boxscore')],
    buddies: [
      buddy('max', 'rt', { paneTitle: 'max', pane: 'wAR:p3' }),
      buddy('jay', 'boxscore', {
        paneTitle: 'Boxscore mattstack integration',
        pane: 'wBT:p1',
        branch: 'feat/metrics-hardening',
      }),
      buddy('remy', 'rt', { status: 'idle', pane: 'wAM:pF' }),
    ],
  });

  // The tree is one flat DOM list, so "under" is a claim about ORDER: the rt
  // room row, then its two members, then the next room.
  const rows = screen
    .getAllByTestId(/^(room-row-|ws-(?!doing|handle))/)
    .map(el => el.dataset.testid);
  expect(rows).toEqual([
    'room-row-rt',
    'ws-max',
    'ws-remy',
    'room-row-boxscore',
    'ws-jay',
  ]);
  expect(screen.getByTestId('ws-jay')).toHaveTextContent(
    'Boxscore mattstack integration'
  );
});

test('a repo with agents but no room still gets a group, and it is not a target', () => {
  renderTree({
    rooms: [room('rt')],
    buddies: [buddy('max', 'rt'), buddy('gail', 'board')],
  });

  const group = screen.getByTestId('repo-row-board');
  expect(group).toHaveTextContent('board');
  expect(group).toHaveTextContent('no room');
  expect(group.getAttribute('role')).toBeNull();
  expect(group.style.cursor).toBe('default');
  // Repos with a room come first; the roomless one is appended after them.
  expect(screen.getByTestId('room-row-rt').compareDocumentPosition(group)).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING
  );
});

test("a repo's signed-out members collapse into one line naming them", () => {
  renderTree({
    rooms: [room('rt')],
    buddies: [
      buddy('max', 'rt'),
      offline('kai', 'rt', 16 * H),
      offline('ida', 'rt', 15 * H),
      offline('jax', 'rt', 23 * H),
      offline('sid', 'rt', 23 * H),
      offline('elsa', 'rt', 20 * H),
      offline('wren', 'rt', 20 * H),
    ],
  });

  expect(screen.getByTestId('offline-rt')).toHaveTextContent(
    '6 signed out · kai ida jax sid elsa wren'
  );
  // Collapsed means collapsed: no row of their own.
  expect(screen.queryByTestId('ws-kai')).toBeNull();
});

test('a lone signed-out member keeps its name and its age', () => {
  renderTree({
    rooms: [],
    buddies: [offline('gail', 'board', 3 * M)],
  });
  expect(screen.getByTestId('offline-board')).toHaveTextContent(
    'gail · signed out 3m ago'
  );
});

test('a DM row is one line: the pair, no subtitle', () => {
  renderTree({
    dms: [dm('jay', 'max')],
    buddies: [
      buddy('jay', 'boxscore', {
        paneTitle: 'Boxscore mattstack integration',
      }),
      buddy('max', 'repo-tools', { paneTitle: 'max' }),
    ],
  });
  expect(screen.getByTestId('dm-row-dm-jay-max')).toHaveTextContent(
    'jay ↔ max'
  );
  // The old preview line (a repo/task/last-message summary) is gone: it added
  // height that shifted on hover and carried nothing the pair did not.
  expect(screen.queryByTestId('dm-doing-dm-jay-max')).toBeNull();
});

test('the hashed DM room name is never rendered, only the pair', () => {
  renderTree({ dms: [dm('edie', 'stan')], buddies: [] });
  expect(screen.getByTestId('dm-row-dm-edie-stan')).toHaveTextContent(
    'edie ↔ stan'
  );
  expect(screen.queryByText(/dm-edie/)).toBeNull();
});

test('DMs cap at four and the rest collapse into an expandable line', async () => {
  renderTree({
    dms: [
      dm('max', 'stan'),
      dm('jay', 'max'),
      dm('edie', 'stan'),
      dm('kai', 'remy'),
      dm('kai', 'max', { unread: 1 }),
      dm('max', 'wren', { unread: 8 }),
      dm('gail', 'max', { unread: 6 }),
    ],
    buddies: [],
  });

  expect(screen.getAllByTestId(/^dm-row-/)).toHaveLength(4);
  const more = screen.getByTestId('dm-more');
  expect(more).toHaveTextContent(
    '3 more · kai ↔ max 1, max ↔ wren 8, gail ↔ max 6'
  );
  expect(more).toHaveAttribute('aria-expanded', 'false');
  // Not the inert offline roll-up: this one is the only way to those three.
  expect(more.tagName).toBe('BUTTON');
  expect(more.style.cursor).toBe('pointer');

  await userEvent.click(more);
  expect(screen.getAllByTestId(/^dm-row-/)).toHaveLength(7);
  expect(screen.getByTestId('dm-more')).toHaveTextContent('show fewer');

  await userEvent.click(screen.getByTestId('dm-more'));
  expect(screen.getAllByTestId(/^dm-row-/)).toHaveLength(4);
});

test('the collapse never hides the open conversation', () => {
  renderTree({
    dms: [
      dm('max', 'stan'),
      dm('jay', 'max'),
      dm('edie', 'stan'),
      dm('kai', 'remy'),
      dm('gail', 'max'),
    ],
    activeRoom: 'dm-gail-max',
    buddies: [],
  });

  // Still four rows: the active one displaces the last, rather than adding a
  // fifth past the drawn cap.
  const shown = screen.getAllByTestId(/^dm-row-/).map(el => el.dataset.testid);
  expect(shown).toEqual([
    'dm-row-dm-max-stan',
    'dm-row-dm-jay-max',
    'dm-row-dm-edie-stan',
    'dm-row-dm-gail-max',
  ]);
  expect(screen.getByTestId('dm-more')).toHaveTextContent(
    '1 more · kai ↔ remy'
  );
});

test('four or fewer DMs render no overflow control at all', () => {
  renderTree({ dms: [dm('max', 'stan'), dm('jay', 'max')], buddies: [] });
  expect(screen.queryByTestId('dm-more')).toBeNull();
});

test('the workstream handle and the roomless group label share the tree row size', () => {
  renderTree({
    rooms: [room('rt')],
    buddies: [buddy('max', 'rt'), buddy('gail', 'board')],
  });
  // 11.2px, one step above the `3xs` task line beside it, as drawn.
  expect(screen.getByTestId('ws-handle-max').style.fontSize).toBe(
    'var(--tk-fs-small)'
  );
  expect(screen.getByTestId('repo-name-board').style.fontSize).toBe(
    'var(--tk-fs-small)'
  );
  expect(screen.getByTestId('ws-doing-max').style.fontSize).toBe(
    'var(--tk-fs-3xs)'
  );
});

test('clicking a workstream focuses its pane', async () => {
  const onFocusPane = vi.fn();
  renderTree({
    rooms: [room('boxscore')],
    buddies: [buddy('jay', 'boxscore', { pane: 'wBT:p1' })],
    onFocusPane,
  });
  await userEvent.click(screen.getByTestId('ws-jay'));
  expect(onFocusPane).toHaveBeenCalledWith('wBT:p1');
});

test('onSelectBuddy wins over onFocusPane: the phone drawer opens a DM, not a pane', async () => {
  const onFocusPane = vi.fn();
  const onSelectBuddy = vi.fn();
  renderTree({
    rooms: [room('boxscore')],
    buddies: [buddy('jay', 'boxscore', { pane: 'wBT:p1' })],
    onFocusPane,
    onSelectBuddy,
  });
  await userEvent.click(screen.getByTestId('ws-jay'));
  expect(onSelectBuddy).toHaveBeenCalledWith('jay');
  expect(onFocusPane).not.toHaveBeenCalled();
});

test('a workstream with no pane is not a target', () => {
  renderTree({
    rooms: [room('rt')],
    buddies: [buddy('max', 'rt')],
    onFocusPane: vi.fn(),
  });
  const row = screen.getByTestId('ws-max');
  expect(row.tagName).toBe('DIV');
  expect(row.style.cursor).toBe('default');
});

test('the focus-pane hint rides only the desktop pane rows', () => {
  const { rerender } = renderTree({
    rooms: [room('boxscore')],
    buddies: [buddy('jay', 'boxscore', { pane: 'wBT:p1' })],
    onFocusPane: vi.fn(),
  });
  // Desktop: the row focuses a pane, so it carries the hint.
  expect(screen.getByTestId('ws-focus-hint-jay')).toBeInTheDocument();

  // Phone: the same row opens a DM (`onSelectBuddy`) with no hover to hint on.
  rerender(
    <FleetTree
      rooms={[room('boxscore')]}
      dms={[]}
      buddies={[buddy('jay', 'boxscore', { pane: 'wBT:p1' })]}
      now={NOW}
      onFocusPane={vi.fn()}
      onSelectBuddy={vi.fn()}
    />
  );
  expect(screen.queryByTestId('ws-focus-hint-jay')).toBeNull();

  // No pane, no target, no hint.
  rerender(
    <FleetTree
      rooms={[room('rt')]}
      dms={[]}
      buddies={[buddy('max', 'rt')]}
      now={NOW}
      onFocusPane={vi.fn()}
    />
  );
  expect(screen.queryByTestId('ws-focus-hint-max')).toBeNull();
});

test('rooms and DMs both close, by hover × and by right-click menu', async () => {
  const onClose = vi.fn();
  const onMarkRead = vi.fn();
  const onOpenRoom = vi.fn();
  renderTree({
    rooms: [room('rt', { unread: 3 })],
    dms: [dm('jay', 'max', { unread: 2 })],
    buddies: [],
    onClose,
    onMarkRead,
    onOpenRoom,
  });

  const dmClose = screen.getByTestId('dm-close-dm-jay-max');
  expect(dmClose).toHaveAttribute('aria-label', 'Close jay ↔ max');
  expect(dmClose.style.display).toBe('none');
  await userEvent.hover(screen.getByTestId('dm-row-dm-jay-max'));
  expect(dmClose.style.display).toBe('');
  await userEvent.click(dmClose);
  expect(onClose).toHaveBeenCalledWith('dm-jay-max');
  expect(onOpenRoom).not.toHaveBeenCalled();

  expect(screen.getByTestId('room-close-rt')).toHaveAttribute(
    'aria-label',
    'Close #rt'
  );

  fireEvent.contextMenu(screen.getByTestId('dm-row-dm-jay-max'));
  const menu = await screen.findByTestId('dm-context-dm-jay-max');
  expect(menu).toHaveTextContent('jay ↔ max');
  expect(within(menu).getByTestId('room-context-mark-read')).toHaveTextContent(
    '2'
  );
  await userEvent.click(within(menu).getByTestId('room-context-mark-read'));
  expect(onMarkRead).toHaveBeenCalledWith('dm-jay-max');
});

test('the daemon down withholds every presence claim in the tree', () => {
  renderTree({
    rooms: [room('rt')],
    dms: [dm('jay', 'max')],
    buddies: [
      buddy('max', 'rt', { pane: 'wAR:p3' }),
      buddy('jay', 'boxscore', { paneTitle: 'Boxscore mattstack integration' }),
    ],
    daemonReachable: false,
  });

  expect(screen.getByTestId('ws-doing-max')).toHaveTextContent(
    'presence withheld'
  );
  // The dot goes hollow: no background, a hairline instead.
  expect(screen.getByTestId('dot-max').style.background).toBe('transparent');
  // No pane title leaks anywhere while the daemon is down.
  expect(screen.queryByText(/Boxscore mattstack integration/)).toBeNull();
});
