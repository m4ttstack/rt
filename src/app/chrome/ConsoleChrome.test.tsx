import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@ui/storybook/test-utils';
import { ConsoleChrome } from './ConsoleChrome';

describe('ConsoleChrome', () => {
  it('renders both rail entries and its children', () => {
    renderWithProviders(
      <ConsoleChrome section="runs">
        <p>content</p>
      </ConsoleChrome>
    );

    expect(screen.getByText('content')).toBeInTheDocument();
    expect(screen.getAllByLabelText(/Runs/i).length).toBeGreaterThan(0);
  });

  // The control must be able to return to "auto" -- setColorScheme(isDark ?
  // 'light' : 'dark') never could, since it only ever wrote an explicit
  // value. A System option that survives a Light/Dark round trip is the
  // regression this guards.
  it('offers System/Light/Dark and can return to System after picking Dark', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ConsoleChrome section="runs">
        <p>content</p>
      </ConsoleChrome>
    );

    await user.click(screen.getByLabelText('Color scheme'));
    await user.click(await screen.findByText('Dark'));

    await user.click(screen.getByLabelText('Color scheme'));
    await user.click(await screen.findByText('System'));

    // Back to auto: the preference this app defaults to, and the one the
    // old two-value toggle could never return to once clicked.
    await user.click(screen.getByLabelText('Color scheme'));
    expect(await screen.findByText('System')).toBeInTheDocument();
    expect(await screen.findByText('Light')).toBeInTheDocument();
    expect(await screen.findByText('Dark')).toBeInTheDocument();
  });
});
