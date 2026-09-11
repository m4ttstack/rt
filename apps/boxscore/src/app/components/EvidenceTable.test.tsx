import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { EvidenceTable } from './EvidenceTable';

const issueEvidence = {
  columns: ['Issue', 'Title', 'State', 'Closed', 'MR(s)'],
  rows: [
    {
      cells: [
        'ACME-2612',
        'Purpose-built read paths',
        'Done',
        '2026-08-04',
        '!40664, !40659, !40658, !40657, !40656',
      ],
      href: 'https://linear.app/acme/issue/ACME-2612',
    },
  ],
};

describe('EvidenceTable', () => {
  it('links the first cell via href, and visually distinguishes a muted row from a counting one', () => {
    renderWithProviders(
      <EvidenceTable
        evidence={{
          columns: ['MR', 'Title'],
          rows: [
            {
              cells: ['!1', 'Counts toward the stat'],
              href: 'https://gitlab.example.com/mr/1',
            },
            { cells: ['!2', 'Stale, excluded'], muted: true },
          ],
        }}
      />
    );

    const link = screen.getByRole('link', { name: '!1' });
    expect(link).toHaveAttribute('href', 'https://gitlab.example.com/mr/1');

    const countingRow = screen
      .getByText('Counts toward the stat')
      .closest('tr')!;
    const mutedRow = screen.getByText('Stale, excluded').closest('tr')!;

    expect(mutedRow).toHaveAttribute('data-muted', 'true');
    expect(countingRow).not.toHaveAttribute('data-muted');
    expect(mutedRow).toHaveStyle({ opacity: '0.4' });
    expect(countingRow).not.toHaveStyle({ opacity: '0.4' });
  });

  it('renders a row with no href as plain text, not a link', () => {
    renderWithProviders(
      <EvidenceTable
        evidence={{ columns: ['Commit'], rows: [{ cells: ['abc123'] }] }}
      />
    );

    expect(screen.getByText('abc123')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('falls back to the evidence summary when there are no rows', () => {
    renderWithProviders(
      <EvidenceTable
        evidence={{ columns: ['MR'], rows: [], summary: '0 of 3 counted' }}
      />
    );

    expect(screen.getByText('0 of 3 counted')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('falls back to a generic message when there is no evidence at all', () => {
    renderWithProviders(<EvidenceTable evidence={undefined} />);

    expect(
      screen.getByText('No records behind this stat.')
    ).toBeInTheDocument();
  });

  it('lets a long MR(s) list wrap instead of forcing one line', () => {
    renderWithProviders(<EvidenceTable evidence={issueEvidence} />);
    const cell = screen
      .getByText('!40664, !40659, !40658, !40657, !40656')
      .closest('td')!;
    expect(cell.style.whiteSpace).toBe('normal');
  });

  it('keeps single-token columns like dates on one line', () => {
    renderWithProviders(<EvidenceTable evidence={issueEvidence} />);
    const cell = screen.getByText('2026-08-04').closest('td')!;
    expect(cell.style.whiteSpace).toBe('nowrap');
  });

  it('gives the title column a floor so it cannot collapse', () => {
    renderWithProviders(<EvidenceTable evidence={issueEvidence} />);
    const cell = screen.getByText('Purpose-built read paths').closest('td')!;
    expect(cell.style.minWidth).not.toBe('');
  });
});
