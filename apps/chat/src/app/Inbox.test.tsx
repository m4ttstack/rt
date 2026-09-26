import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';

import './icons';

import type { InboxCard as InboxCardData, InboxPayload } from '../server/inbox';
import { Inbox, InboxBar, orderedCards } from './Inbox';
import { installFetchMock } from './test-utils';

const NOW = Date.UTC(2026, 8, 2, 15, 20);

const mention: InboxCardData = {
  room: 'boxscore',
  kind: 'room',
  messageId: 412,
  handle: 'jay',
  postedAt: NOW - 29 * 60_000,
  excerpt: '@matt metrics-hardening is ready for review.',
  reason: 'mention',
};

const dmTurn: InboxCardData = {
  room: 'dm-1a2b3c',
  kind: 'dm',
  participants: { a: 'edie', b: 'matt' },
  messageId: 720,
  handle: 'edie',
  postedAt: NOW - 18 * 60_000,
  excerpt: '@matt the loop needs a call.',
  reason: 'dm-turn',
};

const ask: InboxCardData = {
  room: 'rt',
  kind: 'room',
  messageId: 602,
  handle: 'max',
  postedAt: NOW - 77 * 60_000,
  excerpt: 'heads-up: main tsc is red.',
  reason: 'open-ask',
};

const payload: InboxPayload = {
  needsYou: [dmTurn, mention],
  openAsks: [ask],
  elsewhere: [
    { room: 'rt', kind: 'room', unread: 152, mentions: 0 },
    { room: 'dm-1a2b3c', kind: 'dm', unread: 16, mentions: 0 },
  ],
};

const EMPTY: InboxPayload = { needsYou: [], openAsks: [], elsewhere: [] };

function renderInbox(overrides: Partial<Parameters<typeof Inbox>[0]> = {}) {
  const props = {
    inbox: payload,
    now: NOW,
    buddies: [],
    readerMembers: [],
    onOpenCard: vi.fn(),
    onMarkRoomRead: vi.fn(),
    onMarkAllRead: vi.fn(),
    onOpenRoom: vi.fn(),
    onReplied: vi.fn(),
    ...overrides,
  };
  renderWithProviders(<Inbox {...props} />);
  return props;
}

beforeEach(() => {
  installFetchMock();
});

test('the three sections render in order, each carrying its count', () => {
  renderInbox({ openCard: undefined });
  const labels = screen
    .getAllByTestId(/^inbox-section-/)
    .map(el => el.textContent);
  expect(labels[0]).toContain('NEEDS YOU');
  expect(labels[0]).toContain('2');
  expect(labels[1]).toContain('OPEN ASKS');
  expect(labels[1]).toContain('@here, nobody claimed');
  expect(labels[2]).toContain('EVERYTHING ELSE');
});

test('everything else is chips and an explanation, never cards', () => {
  renderInbox({ openCard: undefined });
  const chips = screen.getByTestId('inbox-elsewhere-chips');
  expect(chips).toHaveTextContent('#rt 152');
  expect(chips).toHaveTextContent('1 DM · 16');
  expect(screen.getByTestId('inbox-elsewhere-note')).toHaveTextContent(
    'Nothing here mentions you'
  );
});

test('clicking a card hands it back so the reader can open it', async () => {
  const props = renderInbox({ openCard: undefined });
  await userEvent.click(screen.getByTestId('card-lead-412'));
  expect(props.onOpenCard).toHaveBeenCalledWith(mention);
});

test('a card’s mark read clears that card’s room, by name', async () => {
  const props = renderInbox({ openCard: undefined });
  await userEvent.click(
    screen.getByRole('button', { name: /mark #boxscore read/i })
  );
  expect(props.onMarkRoomRead).toHaveBeenCalledWith('boxscore');
});

test('mark all read in the everything-else row asks for the whole sweep', async () => {
  const props = renderInbox({ openCard: undefined });
  await userEvent.click(
    within(screen.getByTestId('inbox-elsewhere-row')).getByRole('button', {
      name: /mark everything read/i,
    })
  );
  expect(props.onMarkAllRead).toHaveBeenCalledTimes(1);
});

test('an empty inbox collapses the two card sections and keeps the explanation', () => {
  renderInbox({ inbox: EMPTY, openCard: undefined });
  expect(screen.queryByTestId('inbox-section-needs-you')).toBeNull();
  expect(screen.queryByTestId('inbox-section-open-asks')).toBeNull();
  expect(screen.getByTestId('inbox-elsewhere-note')).toBeInTheDocument();
  expect(screen.getByTestId('inbox-reader-empty')).toBeInTheDocument();
});

test('the page bar chips count what needs him, what is unclaimed, and the rest', () => {
  renderWithProviders(<InboxBar inbox={payload} onMarkAllRead={vi.fn()} />);
  expect(screen.getByTestId('inbox-chip-needs-you')).toHaveTextContent(
    '@ 2 need you'
  );
  expect(screen.getByTestId('inbox-chip-open-asks')).toHaveTextContent(
    '1 open ask'
  );
  expect(screen.getByTestId('inbox-chip-elsewhere')).toHaveTextContent(
    '168 unread elsewhere'
  );
  expect(
    screen.getByRole('button', { name: /mark everything read/i })
  ).toHaveTextContent('171');
});

test('daemon down: one withheld chip, and the sweep is still offered', () => {
  renderWithProviders(
    <InboxBar inbox={payload} reachable={false} onMarkAllRead={vi.fn()} />
  );
  expect(screen.getByTestId('inbox-chip-withheld')).toHaveTextContent(
    'last known · presence withheld'
  );
  expect(screen.queryByTestId('inbox-chip-needs-you')).toBeNull();
});

test('orderedCards is needs-you first, then open asks', () => {
  expect(orderedCards(payload).map(c => c.messageId)).toEqual([720, 412, 602]);
});

test('phone drops the reader beside the list, but a card tap still hands it to onOpenCard', async () => {
  const props = renderInbox({ phone: true, openCard: mention });
  expect(screen.queryByTestId('reader')).toBeNull();
  expect(screen.queryByTestId('inbox-reader-empty')).toBeNull();
  await userEvent.click(screen.getByTestId('card-lead-412'));
  expect(props.onOpenCard).toHaveBeenCalledWith(mention);
  expect(props.onOpenRoom).not.toHaveBeenCalled();
});
