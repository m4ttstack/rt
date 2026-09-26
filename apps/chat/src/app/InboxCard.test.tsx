import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';

import './icons';

import type { InboxCard as InboxCardData } from '../server/inbox';
import { BuddiesProvider } from './buddies-context';
import { InboxCard } from './InboxCard';
import type { RosterBuddy } from './roster-types';
import { installFetchMock } from './test-utils';

const NOW = Date.UTC(2026, 8, 2, 15, 20);

const jay: RosterBuddy = {
  sessionId: 'jay-1',
  handle: 'jay',
  baseHandle: 'jay',
  signedInAt: NOW - 3_600_000,
  lastSeenAt: NOW - 40_000,
  status: 'live',
  rooms: ['boxscore'],
  repo: 'boxscore',
  paneTitle: 'Boxscore mattstack integration',
};

const mention: InboxCardData = {
  room: 'boxscore',
  kind: 'room',
  messageId: 412,
  handle: 'jay',
  postedAt: NOW - 29 * 60_000,
  excerpt: '@matt metrics-hardening is ready for review: PR #12.',
  reason: 'mention',
};

const ask: InboxCardData = {
  room: 'rt',
  kind: 'room',
  messageId: 602,
  handle: 'max',
  postedAt: NOW - 77 * 60_000,
  excerpt: 'heads-up: main tsc is red since 85f18ee8.',
  reason: 'open-ask',
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

beforeEach(() => {
  installFetchMock();
});

function renderCard(
  card: InboxCardData,
  overrides: Partial<Parameters<typeof InboxCard>[0]> = {}
) {
  const props = {
    card,
    now: NOW,
    onOpen: vi.fn(),
    onMarkRead: vi.fn(),
    onOpenRoom: vi.fn(),
    ...overrides,
  };
  renderWithProviders(
    <BuddiesProvider
      buddies={[jay]}
      roomMembers={['jay']}
      now={NOW}
      reachable={props.reachable ?? true}
    >
      <InboxCard {...props} />
    </BuddiesProvider>
  );
  return props;
}

test('a card carries who, the lead, where it lives and its age', () => {
  renderCard(mention);
  const card = screen.getByTestId('inbox-card-412');
  expect(card).toHaveTextContent('jay');
  expect(card).toHaveTextContent('Boxscore mattstack integration');
  expect(screen.getByTestId('card-lead-412')).toHaveTextContent(
    'metrics-hardening is ready for review'
  );
  expect(screen.getByTestId('card-ctx-412')).toHaveTextContent('#boxscore');
  expect(screen.getByTestId('card-age-412')).toHaveTextContent('29m ago');
});

test('a DM card names the pair, never the hashed room', () => {
  renderCard(dmTurn);
  expect(screen.getByTestId('card-ctx-720')).toHaveTextContent('edie ↔ matt');
  expect(screen.getByTestId('inbox-card-720')).not.toHaveTextContent(
    'dm-1a2b3c'
  );
});

test('an open ask reads as unclaimed for as long as it has been waiting', () => {
  renderCard(ask);
  expect(screen.getByTestId('card-age-602')).toHaveTextContent('unclaimed 1h');
});

test("mark read names the room it clears, because it clears that room's other unread", async () => {
  const props = renderCard(mention);
  const control = screen.getByRole('button', { name: /mark #boxscore read/i });
  expect(control).toHaveTextContent('mark #boxscore read');
  await userEvent.click(control);
  expect(props.onMarkRead).toHaveBeenCalledTimes(1);
  // The card must not open as a side effect of clearing it.
  expect(props.onOpen).not.toHaveBeenCalled();
});

test('a DM card names the pair on its mark-read control too', () => {
  renderCard(dmTurn);
  expect(
    screen.getByRole('button', { name: /mark edie ↔ matt read/i })
  ).toBeInTheDocument();
});

test('open jumps to the room, clicking the body opens the reader', async () => {
  const props = renderCard(mention);
  await userEvent.click(
    screen.getByRole('button', { name: /^open #boxscore/i })
  );
  expect(props.onOpenRoom).toHaveBeenCalledTimes(1);
  expect(props.onOpen).not.toHaveBeenCalled();

  await userEvent.click(screen.getByTestId('card-lead-412'));
  expect(props.onOpen).toHaveBeenCalledTimes(1);
});

test('daemon down: the task line and the age both read last known', () => {
  renderCard(mention, { reachable: false });
  expect(screen.getByTestId('card-age-412')).toHaveTextContent('last known');
  // `doing-<handle>` is `AgentName`'s own task line: the card renders the
  // same unit the message header does, at its own scale.
  expect(screen.getByTestId('doing-jay')).toHaveTextContent('last known');
  expect(screen.getByTestId('inbox-card-412')).not.toHaveTextContent(
    'Boxscore mattstack integration'
  );
});

test('the handle is the shared chip: hue, sprite, repo token and task line', () => {
  renderCard(mention);
  const chip = screen.getByTestId('speaker-chip');
  expect(chip).toHaveTextContent('jay');
  // The card's own scale, not the message header's 22px sprite.
  expect(chip.querySelector('svg')).toHaveAttribute('width', '10');
  expect(screen.getByTestId('inbox-card-412')).toHaveTextContent('boxscore');
  expect(screen.getByTestId('doing-jay')).toHaveTextContent(
    'Boxscore mattstack integration'
  );
});

test('the open card is marked, so the list says which one the reader holds', () => {
  renderCard(mention, { open: true });
  expect(screen.getByTestId('inbox-card-412').dataset.open).toBe('true');
});
