import { screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { NotFoundPage } from './NotFoundPage';

test('links back to the configured home', () => {
  const { hook } = memoryLocation({ path: '/nope' });
  renderWithProviders(
    <Router hook={hook}>
      <NotFoundPage home="/runs" />
    </Router>
  );
  expect(
    screen.getByRole('heading', { name: 'Page not found' })
  ).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Back home' })).toHaveAttribute(
    'href',
    '/runs'
  );
});
