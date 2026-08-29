import { renderWithProviders as render } from '@mattstack/app-kit/test-utils';
import type { PresenceRow } from '@mattstack/rt-client';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import { Roster, type RosterBuddy } from './Roster';

const now = 1_700_000_000_000;
const b = (
  handle: string,
  status: RosterBuddy['status'],
  extra: Partial<PresenceRow & { rooms: string[] }> = {}
): RosterBuddy =>
  ({
    sessionId: handle,
    handle,
    baseHandle: handle,
    signedInAt: now - 60_000,
    lastSeenAt: now,
    rooms: [],
    status,
    ...extra,
  }) as RosterBuddy;

test('one stable online list, then the offline section collapsed to one line', async () => {
  render(
    <Roster
      now={now}
      roomMembers={[]}
      buddies={[
        b('rt-chat-wt', 'live', {
          lastSeenAt: now - 12_000,
          rooms: ['build', 'repo-tools', 'dm'],
        }),
        b('workforest-e2e', 'offline', { signedOutAt: now - 2 * 60 * 60_000 }),
        b('board-fix-auth', 'idle', {
          lastSeenAt: now - 9 * 60_000,
          statusText: 'waiting on CI',
          rooms: ['build'],
        }),
      ]}
    />
  );
  // One heading only: online rows carry no section of their own (the dot is
  // the status), so a busy<->idle flip never regroups a row.
  const headings = screen
    .getAllByRole('heading', { level: 3 })
    .map(h => h.textContent);
  expect(headings).toEqual(['offline · last 24h 1']);
  expect(screen.getByTestId('status-rt-chat-wt')).toHaveAttribute(
    'aria-label',
    expect.stringMatching(/^working · /)
  );
  expect(screen.getByTestId('away-board-fix-auth')).toHaveTextContent(
    '“waiting on CI”'
  );
  await userEvent.hover(screen.getByText('board-fix-auth'));
  expect(await screen.findByTestId('sub-board-fix-auth')).toHaveTextContent(
    /seen 9m ago/
  );
  expect(screen.getByTestId('row-workforest-e2e')).toHaveTextContent(
    /signed out 2h ago/
  );
  expect(
    screen
      .getByTestId('row-workforest-e2e')
      .querySelector('[data-testid=sub-workforest-e2e]')
  ).toBeNull();
});

test('a buddy is identified by what it is: branch, pane, path, and its rooms as tags, in its detail card', async () => {
  render(
    <Roster
      now={now}
      roomMembers={[]}
      buddies={[
        b('acme-dev-42', 'live', {
          cwd: '/Users/m/GitHub/acme-wt-invite-onboarding',
          branch: 'fix-auth',
          pane: '4',
          rooms: ['build', 'dm'],
        }),
      ]}
    />
  );
  await userEvent.hover(screen.getByText('acme-dev-42'));
  expect(
    await screen.findByText(/…\/acme-wt-invite-onboarding/)
  ).toBeInTheDocument();
  expect(screen.getByText(/fix-auth · pane 4/)).toBeInTheDocument();
  expect(screen.getByText('#build')).toBeInTheDocument();
  expect(screen.getByText('dm')).toBeInTheDocument();
});

test('picking a buddy says whether it is in this room', async () => {
  const onPick = vi.fn();
  render(
    <Roster
      now={now}
      roomMembers={['a']}
      onPick={onPick}
      buddies={[
        b('a', 'live', { rooms: ['build'] }),
        b('c', 'idle', { rooms: ['release'] }),
      ]}
    />
  );
  await userEvent.click(screen.getByTestId('row-a'));
  await userEvent.click(screen.getByTestId('row-c'));
  expect(onPick).toHaveBeenNthCalledWith(1, 'a', { inRoom: true });
  expect(onPick).toHaveBeenNthCalledWith(2, 'c', { inRoom: false });
});

test('withheld: no status word or colour while the daemon is unreachable', async () => {
  render(
    <Roster
      now={now}
      roomMembers={[]}
      daemonReachable={false}
      buddies={[b('a', 'live', {})]}
    />
  );
  expect(screen.getByTestId('status-a')).toHaveAttribute(
    'aria-label',
    'presence withheld while the daemon is down'
  );
  await userEvent.hover(screen.getByText('a'));
  expect(await screen.findByTestId('sub-a')).toHaveTextContent(
    /presence unknown while the daemon is down/
  );
});
