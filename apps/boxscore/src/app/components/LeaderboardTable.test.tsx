import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { buildMetrics, buildResponse, buildUser } from './fixtures';
import { LeaderboardTable } from './LeaderboardTable';

// Column headers go through Mantine's Tooltip (task 6b), which needs no provider ancestor.
function renderTable(ui: Parameters<typeof renderWithProviders>[0]) {
  return renderWithProviders(ui);
}

function rowOrder(): string[] {
  return screen
    .getAllByTestId(/^row-/)
    .map(el => el.dataset.testid!.replace('row-', ''));
}

describe('LeaderboardTable', () => {
  it('renders a row per user, ranked by the default sort (mrsMerged, higher is better)', () => {
    const data = buildResponse([
      buildUser('alice', buildMetrics({ mrsMerged: { value: 9 } })),
      buildUser('bob', buildMetrics({ mrsMerged: { value: 14 } })),
      buildUser('carol', buildMetrics({ mrsMerged: { value: 3 } })),
    ]);

    renderTable(<LeaderboardTable data={data} trend={false} />);

    expect(rowOrder()).toEqual(['bob', 'alice', 'carol']);
  });

  it('sorts by a metric and respects its better-direction (revertRate is lower-is-better)', () => {
    const data = buildResponse([
      buildUser('alice', buildMetrics({ revertRate: { value: 0.2 } })),
      buildUser('bob', buildMetrics({ revertRate: { value: 0.05 } })),
      buildUser('carol', buildMetrics({ revertRate: { value: 0.4 } })),
    ]);

    renderTable(<LeaderboardTable data={data} trend={false} />);

    fireEvent.click(screen.getByTestId('sort-revertRate'));

    expect(rowOrder()).toEqual(['bob', 'alice', 'carol']);
  });

  it('re-sorts descending on a second click of the same header', () => {
    const data = buildResponse([
      buildUser('alice', buildMetrics({ revertRate: { value: 0.2 } })),
      buildUser('bob', buildMetrics({ revertRate: { value: 0.05 } })),
    ]);

    renderTable(<LeaderboardTable data={data} trend={false} />);

    fireEvent.click(screen.getByTestId('sort-revertRate'));
    expect(rowOrder()).toEqual(['bob', 'alice']);

    fireEvent.click(screen.getByTestId('sort-revertRate'));
    expect(rowOrder()).toEqual(['alice', 'bob']);
  });

  it("marks the current user's row and leaves other rows unmarked", () => {
    const data = buildResponse([
      buildUser('alice', buildMetrics()),
      buildUser('bob', buildMetrics(), { isCurrentUser: true }),
    ]);

    renderTable(<LeaderboardTable data={data} trend={false} />);

    expect(screen.getByTestId('row-bob')).toHaveAttribute(
      'data-current-user',
      'true'
    );
    expect(screen.getByTestId('row-alice')).not.toHaveAttribute(
      'data-current-user'
    );
  });

  it('renders a delta badge with the sign of the trend when trend is on', () => {
    const improving = buildResponse(
      [
        buildUser(
          'alice',
          buildMetrics({ mrsMerged: { value: 10, delta: 4 } })
        ),
      ],
      { hasTrend: true }
    );
    const { unmount } = renderTable(
      <LeaderboardTable data={improving} trend />
    );
    const up = screen.getByText(/▲ 4/);
    expect(up).toHaveAttribute('data-good', 'true');
    unmount();

    const worsening = buildResponse(
      [
        buildUser(
          'alice',
          buildMetrics({ mrsMerged: { value: 6, delta: -3 } })
        ),
      ],
      { hasTrend: true }
    );
    renderTable(<LeaderboardTable data={worsening} trend />);
    const down = screen.getByText(/▼ 3/);
    expect(down).toHaveAttribute('data-good', 'false');
  });
});
