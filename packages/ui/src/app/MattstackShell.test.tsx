import { screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';

import { RailLink } from '@mattstack/app-kit/router';
import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { MattstackShell } from './MattstackShell';

function renderShell() {
  const { hook } = memoryLocation({ path: '/' });
  return renderWithProviders(
    <Router hook={hook}>
      <MattstackShell name="probe" mark={<svg data-testid="mark" />}>
        <MattstackShell.Rail>
          <RailLink icon="layers" label="Runs" href="/" />
          <RailLink icon="search" label="Search" href="/search" />
        </MattstackShell.Rail>
        <MattstackShell.RailBottom>
          <span data-testid="bottom">extra</span>
        </MattstackShell.RailBottom>
        <main data-testid="page">page</main>
      </MattstackShell>
    </Router>
  );
}

test('renders the wordmark, the mark, and the page', () => {
  renderShell();
  expect(screen.getByRole('banner')).toHaveTextContent('probe');
  expect(screen.getByTestId('mark')).toBeInTheDocument();
  expect(screen.getByTestId('page')).toHaveTextContent('page');
});

test('renders the rail entries inside the navigation', () => {
  renderShell();
  const nav = screen.getByRole('navigation', { name: 'App sections' });
  expect(within(nav).getByRole('link', { name: 'Runs' })).toHaveAttribute(
    'aria-current',
    'page'
  );
  expect(within(nav).getByRole('link', { name: 'Search' })).toBeInTheDocument();
  expect(within(nav).getByTestId('bottom')).toBeInTheDocument();
});

test('pins a colour-scheme control to the rail', () => {
  renderShell();
  expect(screen.getByLabelText('Color scheme')).toBeInTheDocument();
});
