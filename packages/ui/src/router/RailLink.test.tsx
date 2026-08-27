import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { ShellRailContext } from '../app/shell-context';
import { RailLink } from './RailLink';

function renderAt(path: string, ui: React.ReactNode, close = vi.fn()) {
  const { hook } = memoryLocation({ path });
  renderWithProviders(
    <Router hook={hook}>
      <ShellRailContext.Provider value={{ expanded: true, close }}>
        {ui}
      </ShellRailContext.Provider>
    </Router>
  );
  return { close };
}

test('renders an anchor with the href', () => {
  renderAt('/', <RailLink icon="layers" label="Runs" href="/runs" />);
  expect(screen.getByRole('link', { name: 'Runs' })).toHaveAttribute(
    'href',
    '/runs'
  );
});

test('is active when the location matches the href exactly', () => {
  renderAt('/runs', <RailLink icon="layers" label="Runs" href="/runs" />);
  expect(screen.getByRole('link', { name: 'Runs' })).toHaveAttribute(
    'aria-current',
    'page'
  );
});

test('an explicit active prop wins over the location', () => {
  renderAt(
    '/elsewhere',
    <RailLink icon="layers" label="Runs" href="/runs" active />
  );
  expect(screen.getByRole('link', { name: 'Runs' })).toHaveAttribute(
    'aria-current',
    'page'
  );
});

test('closes the rail on click', async () => {
  const { close } = renderAt(
    '/',
    <RailLink icon="layers" label="Runs" href="/runs" />
  );
  await userEvent.click(screen.getByRole('link', { name: 'Runs' }));
  expect(close).toHaveBeenCalledTimes(1);
});
