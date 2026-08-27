import { screen } from '@testing-library/react';
import { expect, test } from 'vitest';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';

import '../app/icons';

import { App } from './App';

test('the shell, the registered icon, and the banner render', () => {
  window.history.replaceState(null, '', '/');
  renderWithProviders(<App initialState={{ daemonReachable: false }} />);
  expect(screen.getByRole('banner')).toHaveTextContent('probe');
  expect(screen.getByTestId('probe-icon')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent(/daemon/);
  expect(screen.getByRole('link', { name: 'About' })).toHaveAttribute(
    'href',
    '/about'
  );
});
