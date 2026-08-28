import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { CommandProvenance } from './CommandProvenance';

describe('CommandProvenance', () => {
  it('names the command that produced the panel', () => {
    renderWithProviders(
      <CommandProvenance command="rt runs show r1 --repo repo-tools" asOf={0} />
    );

    expect(screen.getByTestId('command-provenance')).toHaveTextContent(
      'rt runs show r1 --repo repo-tools'
    );
  });

  it('states when the data was fetched, not just what fetched it', () => {
    const asOf = new Date('2026-08-23T12:00:00').getTime();
    renderWithProviders(<CommandProvenance command="rt runs" asOf={asOf} />);

    expect(screen.getByTestId('command-provenance')).toHaveTextContent(
      new Date(asOf).toLocaleTimeString()
    );
  });

  it('is honest about not having fetched yet rather than showing a stale or fake time', () => {
    renderWithProviders(
      <CommandProvenance command="rt runs" asOf={undefined} />
    );

    expect(screen.getByTestId('command-provenance')).toHaveTextContent(
      'not yet fetched'
    );
  });
});
