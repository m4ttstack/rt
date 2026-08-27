import { screen, waitFor } from '@testing-library/react';
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
    vi.fn(async () => ({ json: async () => ({ apps: APPS }) }) as Response)
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
});

test('renders no launcher when the origin is not a mattstack surface and no override', () => {
  vi.stubGlobal('location', { origin: 'https://example.com' } as Location);
  renderWithProviders(<AppLauncher />);
  // Assert the trigger's absence, not container emptiness: renderWithProviders
  // always mounts Notifications + ModalsProvider scaffolding, so `container` is
  // never empty even when AppLauncher correctly returns null.
  expect(screen.queryByRole('button', { name: 'Apps' })).toBeNull();
});

test('an empty list shows a muted note, not a crash', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ json: async () => ({ apps: [] }) }) as Response)
  );
  const user = userEvent.setup();
  renderWithProviders(<AppLauncher />);
  await user.click(screen.getByRole('button', { name: /apps/i }));
  await waitFor(() =>
    expect(screen.getByText(/no apps/i)).toBeInTheDocument()
  );
});
