import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type { UserDetailResponse } from '../../shared/types';
import { DetailPage } from './DetailPage';
import { buildMetrics, buildUser } from './fixtures';

const { useUserDetail } = vi.hoisted(() => ({ useUserDetail: vi.fn() }));
vi.mock('../hooks/useLeaderboard', () => ({ useUserDetail }));

function buildDetail(
  overrides: Partial<UserDetailResponse> = {}
): UserDetailResponse {
  return {
    window: {
      start: '2026-08-01T00:00:00.000Z',
      end: '2026-08-31T00:00:00.000Z',
      key: '30d',
    },
    priorWindow: null,
    hasTrend: false,
    baseUrl: 'https://gitlab.example.com',
    currentUser: 'alice',
    generatedAt: '2026-08-31T12:00:00.000Z',
    fromCache: true,
    user: buildUser(
      'alice',
      buildMetrics({ mrsMerged: { value: 9 }, additions: { value: 100 } })
    ),
    evidence: {
      mrsMerged: {
        columns: ['MR', 'Title'],
        rows: [
          {
            cells: ['!1', 'Fix the thing'],
            href: 'https://gitlab.example.com/mr/1',
          },
        ],
      },
      additions: { columns: ['Commit'], rows: [{ cells: ['abc123'] }] },
    },
    warnings: [],
    ...overrides,
  };
}

describe('DetailPage', () => {
  it("renders the route's initial stat's evidence, and switches to another stat's evidence on rail selection", () => {
    useUserDetail.mockReturnValue({
      data: buildDetail(),
      error: null,
      isLoading: false,
    });

    renderWithProviders(
      <DetailPage
        username="alice"
        initialStat="mrsMerged"
        range={{ range: '30d' }}
        trend={false}
      />
    );

    expect(screen.getByText('!1')).toBeInTheDocument();
    expect(screen.queryByText('abc123')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('stat-additions'));

    expect(screen.getByText('abc123')).toBeInTheDocument();
    expect(screen.queryByText('!1')).not.toBeInTheDocument();
  });

  it("falls back to the first column when the route's stat is not a real metric key", () => {
    useUserDetail.mockReturnValue({
      data: buildDetail(),
      error: null,
      isLoading: false,
    });

    renderWithProviders(
      <DetailPage
        username="alice"
        initialStat="not-a-real-metric"
        range={{ range: '30d' }}
        trend={false}
      />
    );

    // COLUMNS[0] is issuesCompleted (delivery group, first in GROUP_ORDER), which has no evidence
    // fixture here, so the evidence table falls back to its no-records message rather than blanking.
    expect(
      screen.getByText('No records behind this stat.')
    ).toBeInTheDocument();
  });

  it('shows the error message and not a blank page when the detail query fails', () => {
    useUserDetail.mockReturnValue({
      data: undefined,
      error: new Error('boom'),
      isLoading: false,
    });

    renderWithProviders(
      <DetailPage
        username="alice"
        initialStat="mrsMerged"
        range={{ range: '30d' }}
        trend={false}
      />
    );

    expect(screen.getByText('boom')).toBeInTheDocument();
  });

  it('shows a loading state while the detail query is in flight and there is no data yet', () => {
    useUserDetail.mockReturnValue({
      data: undefined,
      error: null,
      isLoading: true,
    });

    renderWithProviders(
      <DetailPage
        username="alice"
        initialStat="mrsMerged"
        range={{ range: '30d' }}
        trend={false}
      />
    );

    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });
});
