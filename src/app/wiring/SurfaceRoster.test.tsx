import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@ui/storybook/test-utils';
import type { SurfaceDelta } from './SurfaceRoster';
import { SurfaceRoster } from './SurfaceRoster';
import type { SkillsSurfaceRow } from './useWiring';

const ROWS: SkillsSurfaceRow[] = [
  { name: 'review', kind: 'compiled', status: 'public' },
  { name: 'watch-ci', kind: 'compiled', status: 'internal' },
  { name: 'ship', kind: 'compiled', status: 'public' },
  { name: 'model-tiering', kind: 'hand-authored', status: 'internal' },
];

function renderRoster(
  over: {
    rows?: SkillsSurfaceRow[];
    onApply?: (delta: SurfaceDelta) => void;
    onClose?: () => void;
    applying?: boolean;
    applyError?: string | null;
  } = {}
) {
  const rows = over.rows ?? ROWS;
  renderWithProviders(
    <SurfaceRoster
      pack="demo"
      rows={rows}
      asOf={1_700_000_000_000}
      onApply={over.onApply ?? (() => {})}
      onClose={over.onClose}
      applying={over.applying}
      applyError={over.applyError}
    />
  );
  return rows;
}

/** Reads the delta straight off the rendered switches -- not off any
    internal state -- by comparing each row's current checked state to the
    status it started render with. Mirrors exactly what the component itself
    is required to compute (see the "toggled twice" test below): a name only
    appears once its live state actually differs from disk. */
function stagedDelta(rows: SkillsSurfaceRow[]): SurfaceDelta {
  const toPublic: string[] = [];
  const toInternal: string[] = [];
  for (const row of rows) {
    const input = screen.getByRole('switch', {
      name: new RegExp(`^${row.name}$`),
    }) as HTMLInputElement;
    const now: 'public' | 'internal' = input.checked ? 'public' : 'internal';
    if (now === row.status) continue;
    (now === 'public' ? toPublic : toInternal).push(row.name);
  }
  toPublic.sort();
  toInternal.sort();
  return { toPublic, toInternal };
}

describe('SurfaceRoster: staging is the whole design', () => {
  it('toggling rows writes nothing until Apply', async () => {
    const applySpy = vi.fn();
    renderRoster({ onApply: applySpy });

    await userEvent.click(screen.getByRole('switch', { name: /watch-ci/ }));
    await userEvent.click(screen.getByRole('switch', { name: /ship/ }));

    expect(applySpy).not.toHaveBeenCalled();
  });

  it('the staged delta names the equivalent CLI command', async () => {
    renderRoster({
      rows: [{ name: 'watch-ci', kind: 'compiled', status: 'internal' }],
    });

    await userEvent.click(screen.getByRole('switch', { name: /watch-ci/ }));

    // The console never becomes the only way to do something.
    expect(
      screen.getByText('rt skills surface set watch-ci --public')
    ).toBeInTheDocument();
  });

  it('a row toggled twice leaves the delta empty rather than listing it as unchanged-but-touched', async () => {
    const rows = renderRoster({
      rows: [{ name: 'watch-ci', kind: 'compiled', status: 'internal' }],
    });
    const toggle = screen.getByRole('switch', { name: /watch-ci/ });

    await userEvent.click(toggle);
    await userEvent.click(toggle);

    // toPublic/toInternal are a DELTA against what is on disk, not an edit log.
    expect(stagedDelta(rows)).toEqual({ toPublic: [], toInternal: [] });
  });
});

describe('SurfaceRoster: pressing Apply', () => {
  it('hands Apply the full bidirectional delta, sorted', async () => {
    const applySpy = vi.fn();
    renderRoster({ onApply: applySpy });

    // watch-ci: internal -> public. ship: public -> internal.
    await userEvent.click(screen.getByRole('switch', { name: /^watch-ci$/ }));
    await userEvent.click(screen.getByRole('switch', { name: /^ship$/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(applySpy).toHaveBeenCalledTimes(1);
    expect(applySpy).toHaveBeenCalledWith({
      toPublic: ['watch-ci'],
      toInternal: ['ship'],
    });
  });

  it('disables Apply and Discard until something is staged', () => {
    renderRoster();

    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Discard' })).toBeDisabled();
  });

  it('Discard clears every staged row without calling Apply', async () => {
    const applySpy = vi.fn();
    renderRoster({ onApply: applySpy });

    await userEvent.click(screen.getByRole('switch', { name: /^watch-ci$/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));

    expect(
      screen.getByRole('switch', { name: /^watch-ci$/ })
    ).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    expect(applySpy).not.toHaveBeenCalled();
  });

  it('shows the caller-supplied error from a partial apply', () => {
    renderRoster({ applyError: 'ship: rt exited nonzero' });

    expect(screen.getByText('ship: rt exited nonzero')).toBeInTheDocument();
  });
});

describe('SurfaceRoster: compiled rows are not moved', () => {
  it('gives a compiled row its own effect line, never the hand-authored move wording', async () => {
    renderRoster({
      rows: [{ name: 'ship', kind: 'compiled', status: 'public' }],
    });

    await userEvent.click(screen.getByRole('switch', { name: /^ship$/ }));

    expect(
      screen.getByText('skills/ship/ stops being compiled and is removed')
    ).toBeInTheDocument();
    expect(screen.queryByText(/attachments\/ship/)).not.toBeInTheDocument();
  });

  it('describes a hand-authored row as a real move', async () => {
    renderRoster({
      rows: [
        { name: 'model-tiering', kind: 'hand-authored', status: 'internal' },
      ],
    });

    await userEvent.click(
      screen.getByRole('switch', { name: /^model-tiering$/ })
    );

    expect(
      screen.getByText('attachments/model-tiering/ → skills/model-tiering/')
    ).toBeInTheDocument();
  });
});
