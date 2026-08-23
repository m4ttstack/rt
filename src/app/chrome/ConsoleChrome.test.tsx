import { screen } from '@testing-library/react';
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
});
