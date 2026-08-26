import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';

import {
  renderWithProviders,
  setViewportWidth,
} from '@ui/storybook/test-utils';
import { App } from './App';

const DESKTOP_WIDTH = window.innerWidth;

// Reset the URL and the persisted scheme preference so nothing leaks
// across tests.
afterEach(() => {
  window.history.replaceState(null, '', '/');
  window.localStorage.removeItem('ui-color-scheme');
  setViewportWidth(DESKTOP_WIDTH);
});

function renderAt(path: string) {
  window.history.replaceState(null, '', path);
  return renderWithProviders(<App />);
}

test('/ renders the chat shell: wordmark, Rooms rail entry, placeholder home', () => {
  renderAt('/');

  expect(screen.getByText('chat')).toBeTruthy();

  const rail = within(screen.getByRole('navigation', { name: 'App sections' }));
  const rooms = rail.getByRole('button', { name: 'Rooms' });
  expect(rooms).toBeTruthy();
  expect(rooms.getAttribute('aria-current')).toBe('page');

  expect(screen.getByText('No rooms yet')).toBeTruthy();
});

test('the rail hosts the color-scheme toggle', () => {
  renderAt('/');
  const rail = within(screen.getByRole('navigation', { name: 'App sections' }));
  const scheme = () =>
    document.documentElement.getAttribute('data-mantine-color-scheme');

  // vitest.setup.ts's matchMedia polyfill defaults the OS preference to
  // light, so the initial computed scheme under `auto` is deterministic.
  expect(scheme()).toBe('light');
  fireEvent.click(rail.getByRole('button', { name: 'Switch to dark mode' }));
  expect(scheme()).toBe('dark');
  fireEvent.click(rail.getByRole('button', { name: 'Switch to light mode' }));
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
  fireEvent.click(rail.getByRole('button', { name: 'Rooms' }));

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
  expect(screen.getByText('No rooms yet')).toBeTruthy();
});
