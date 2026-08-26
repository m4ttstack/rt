import { screen } from '@testing-library/react';
import { expect, test } from 'vitest';

import { renderWithProviders } from '@ui/storybook/test-utils';
import { App } from '../app/App';

const now = 1_700_000_000_000;

const buddyA = {
  sessionId: 'a',
  handle: 'a',
  baseHandle: 'a',
  signedInAt: now,
  lastSeenAt: now,
  armedAt: now,
  status: 'live' as const,
  rooms: [],
};

test('the banner supersedes agent statuses', () => {
  renderWithProviders(
    <App
      initialState={{
        daemonReachable: false,
        buddies: [buddyA],
      }}
    />
  );
  expect(screen.getByRole('status').textContent).toMatch(/daemon/i);
  // Roster's own row -- not the section heading, which keeps its fixed
  // "listening" label regardless of reachability (only the row's own claim
  // is withheld).
  expect(screen.getByTestId('status-a')).not.toHaveTextContent('listening');
});

test('the same buddy DOES render as listening when the daemon is reachable', () => {
  renderWithProviders(
    <App
      initialState={{
        daemonReachable: true,
        buddies: [buddyA],
      }}
    />
  );
  expect(screen.getByTestId('status-a')).toHaveAttribute(
    'aria-label',
    expect.stringMatching(/^listening · /)
  );
  expect(screen.queryByRole('status')).toBeNull();
});
