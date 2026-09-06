import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { COLUMNS } from '../columns';
import { DeltaBadge } from './DeltaBadge';

const mrsMerged = COLUMNS.find(c => c.key === 'mrsMerged')!; // better: "desc"
const revertRate = COLUMNS.find(c => c.key === 'revertRate')!; // better: "asc"

describe('DeltaBadge', () => {
  it("renders an up arrow and 'good' color for a positive delta on a higher-is-better metric", () => {
    renderWithProviders(<DeltaBadge delta={5} col={mrsMerged} />);

    const badge = screen.getByText(/▲ 5/);
    expect(badge).toHaveAttribute('data-good', 'true');
  });

  it("renders a down arrow and 'bad' color for a negative delta on a higher-is-better metric", () => {
    renderWithProviders(<DeltaBadge delta={-5} col={mrsMerged} />);

    const badge = screen.getByText(/▼ 5/);
    expect(badge).toHaveAttribute('data-good', 'false');
  });

  it("flips good/bad for a lower-is-better metric: a positive (worsening) delta is 'bad'", () => {
    renderWithProviders(<DeltaBadge delta={0.05} col={revertRate} />);

    const badge = screen.getByText(/▲ 5%/);
    expect(badge).toHaveAttribute('data-good', 'false');
  });

  it("flips good/bad for a lower-is-better metric: a negative (improving) delta is 'good'", () => {
    renderWithProviders(<DeltaBadge delta={-0.05} col={revertRate} />);

    const badge = screen.getByText(/▼ 5%/);
    expect(badge).toHaveAttribute('data-good', 'true');
  });
});
