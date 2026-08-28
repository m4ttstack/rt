import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { AppLauncher } from './AppLauncher';

const APPS = [
  { name: 'chat', displayName: 'Chat', url: 'https://chat.mattstack', icon: 'https://deck.mattstack/api/apps/chat/icon' },
  { name: 'board', displayName: 'Board', url: 'https://board.mattstack', icon: null },
];

beforeEach(() => {
  vi.stubGlobal('location', { origin: 'https://chat.mattstack' } as Location);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ apps: APPS }) }) as Response)
  );
});
afterEach(() => vi.unstubAllGlobals());

test('opens a grid of app tiles linking to each url', async () => {
  const user = userEvent.setup();
  renderWithProviders(<AppLauncher currentApp="chat" />);
  await user.click(screen.getByRole('button', { name: /apps/i }));
  const chat = await screen.findByRole('link', { name: /Chat/ });
  expect(chat).toHaveAttribute('href', 'https://chat.mattstack');
  expect(screen.getByRole('link', { name: /Board/ })).toHaveAttribute(
    'href',
    'https://board.mattstack'
  );
});

test('marks the current app', async () => {
  const user = userEvent.setup();
  renderWithProviders(<AppLauncher currentApp="chat" />);
  await user.click(screen.getByRole('button', { name: /apps/i }));
  const chat = await screen.findByRole('link', { name: /Chat/ });
  expect(chat).toHaveAttribute('data-current', 'true');
  expect(within(chat).getByTestId('current-app-marker')).toBeInTheDocument();
});

test('does not mark a non-current app', async () => {
  const user = userEvent.setup();
  renderWithProviders(<AppLauncher currentApp="chat" />);
  await user.click(screen.getByRole('button', { name: /apps/i }));
  const board = await screen.findByRole('link', { name: /Board/ });
  expect(board).toHaveAttribute('data-current', 'false');
  expect(within(board).queryByTestId('current-app-marker')).toBeNull();
});

test('renders no launcher when the origin is not a mattstack surface and no override', () => {
  vi.stubGlobal('location', { origin: 'https://example.com' } as Location);
  renderWithProviders(<AppLauncher />);
  // Assert the trigger's absence, not container emptiness: renderWithProviders
  // always mounts Notifications + ModalsProvider scaffolding, so `container` is
  // never empty even when AppLauncher correctly returns null.
  expect(screen.queryByRole('button', { name: 'Apps' })).toBeNull();
});

test('sorts the current app first even when it is not first in the fetch response', async () => {
  const user = userEvent.setup();
  renderWithProviders(<AppLauncher currentApp="board" />);
  await user.click(screen.getByRole('button', { name: /apps/i }));
  await screen.findByRole('link', { name: 'Board' });
  const links = screen.getAllByRole('link');
  expect(links[0]).toHaveAccessibleName('Board');
  expect(links[1]).toHaveAccessibleName('Chat');
});

test('an empty list shows a muted note, not a crash', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ apps: [] }) }) as Response)
  );
  const user = userEvent.setup();
  renderWithProviders(<AppLauncher />);
  await user.click(screen.getByRole('button', { name: /apps/i }));
  await waitFor(() =>
    expect(screen.getByText(/no apps/i)).toBeInTheDocument()
  );
});
