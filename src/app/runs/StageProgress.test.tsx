import { describe, expect, it } from 'vitest';

import { staticSchemeColors } from '@mattstack/app-kit/hooks';
import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { segmentColor } from './StageProgress';

const { StageProgress } = await import('./StageProgress');

describe('StageProgress', () => {
  it('renders nothing when stages is absent', () => {
    const { queryByTestId } = renderWithProviders(<StageProgress />);
    expect(queryByTestId('stage-progress')).not.toBeInTheDocument();
  });

  it('renders nothing when stages is empty', () => {
    const { queryByTestId } = renderWithProviders(
      <StageProgress stages={[]} />
    );
    expect(queryByTestId('stage-progress')).not.toBeInTheDocument();
  });

  it('renders one segment per executed stage, colored by status', () => {
    const { getByTestId } = renderWithProviders(
      <StageProgress
        stages={[
          { name: 'plan', status: 'done' },
          { name: 'implement', status: 'running' },
          { name: 'review', status: 'failed' },
          { name: 'ship', status: 'queued' },
        ]}
      />
    );

    const track = getByTestId('stage-progress');
    const segments = track.querySelectorAll('[data-status]');
    expect(segments).toHaveLength(4);

    expect(segments[0]).toHaveAttribute('data-status', 'done');
    expect(segments[0]).toHaveStyle({
      backgroundColor: segmentColor('ok'),
    });

    expect(segments[1]).toHaveAttribute('data-status', 'running');
    expect(segments[1]).toHaveStyle({
      backgroundColor: segmentColor('accent'),
    });

    expect(segments[2]).toHaveAttribute('data-status', 'failed');
    expect(segments[2]).toHaveStyle({
      backgroundColor: segmentColor('bad'),
    });

    // An unmapped status (not done/failed/running) falls back to the
    // default border color rather than an alert or success hue.
    expect(segments[3]).toHaveAttribute('data-status', 'queued');
    expect(segments[3]).toHaveStyle({
      backgroundColor: staticSchemeColors.border.default,
    });
  });

  it('sizes each segment 26x4 with a 2px radius, 4px apart', () => {
    const { getByTestId } = renderWithProviders(
      <StageProgress
        stages={[
          { name: 'plan', status: 'done' },
          { name: 'implement', status: 'running' },
        ]}
      />
    );
    const segments =
      getByTestId('stage-progress').querySelectorAll('[data-status]');
    for (const segment of segments) {
      expect(segment).toHaveStyle({
        width: '26px',
        height: '4px',
        borderRadius: '2px',
      });
    }
  });
});
