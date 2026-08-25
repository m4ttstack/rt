import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';

import { renderWithProviders } from '@ui/storybook/test-utils';
import type { ExplainRowWire, SettingDefWire } from '../../server/settings';
import { LayerRow } from './LayerRow';

const NUMBER_DEF: SettingDefWire = {
  key: 'rt.runsPruneDays',
  type: 'number',
  scopes: ['user', 'machine'],
  merge: 'replace',
  secret: false,
  teamLocked: false,
  repoScoped: false,
  writable: true,
  description: 'Days before pruning.',
  hasDefault: true,
  defaultValue: 30,
};

const USER_ROW: ExplainRowWire = {
  scope: 'user',
  file: '/stores/user.jsonc',
  present: true,
  value: 45,
};

const COMPOSITE_DEF: SettingDefWire = {
  key: 'rt.roles',
  type: 'object',
  scopes: ['user', 'team', 'machine'],
  merge: 'deep',
  secret: false,
  teamLocked: false,
  repoScoped: false,
  writable: false,
  description: 'Role map.',
  hasDefault: false,
  defaultValue: null,
};

const COMPOSITE_ROW: ExplainRowWire = {
  scope: 'user',
  file: '/stores/user.jsonc',
  present: true,
  value: { a: 1 },
};

async function stageChange(newValue: string) {
  await userEvent.click(screen.getByRole('button', { name: /edit/i }));
  const input = screen.getByRole('textbox', { name: /new value/i });
  await userEvent.clear(input);
  await userEvent.type(input, newValue);
  await userEvent.click(screen.getByRole('button', { name: /^stage$/i }));
}

describe('LayerRow: staged edit-at-layer', () => {
  test('staging shows the delta, the exact command, and the staged copy; onApply is not yet called', async () => {
    const onApply = vi.fn();
    renderWithProviders(
      <LayerRow def={NUMBER_DEF} row={USER_ROW} role="winner" onApply={onApply} />
    );

    await stageChange('14');

    const panel = screen.getByTestId('layer-stage-user:/stores/user.jsonc');
    expect(panel).toHaveTextContent('45 → 14');
    expect(panel).toHaveTextContent(
      "rt settings set rt.runsPruneDays '14' --scope user"
    );
    expect(panel).toHaveTextContent(
      'writes the user store, then this chain re-reads'
    );
    expect(panel).toHaveTextContent(
      '1 change staged — nothing is written until you apply'
    );
    expect(onApply).not.toHaveBeenCalled();
  });

  test('pressing Apply calls onApply with the staged draft and scope', async () => {
    const onApply = vi.fn();
    renderWithProviders(
      <LayerRow def={NUMBER_DEF} row={USER_ROW} role="winner" onApply={onApply} />
    );

    await stageChange('14');
    await userEvent.click(screen.getByRole('button', { name: /^apply$/i }));

    expect(onApply).toHaveBeenCalledWith(14, 'user');
  });

  test('pressing Discard closes the staged block without calling onApply', async () => {
    const onApply = vi.fn();
    renderWithProviders(
      <LayerRow def={NUMBER_DEF} row={USER_ROW} role="winner" onApply={onApply} />
    );

    await stageChange('14');
    await userEvent.click(screen.getByRole('button', { name: /discard/i }));

    expect(onApply).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId('layer-stage-user:/stores/user.jsonc')
    ).not.toBeInTheDocument();
  });

  test('a row whose scope the def disallows is labeled, never given an edit affordance', () => {
    const teamRow: ExplainRowWire = {
      scope: 'team',
      file: '/stores/team.jsonc',
      present: true,
      value: 10,
    };
    renderWithProviders(<LayerRow def={NUMBER_DEF} row={teamRow} role="inert" />);

    expect(
      screen.getByText('not allowed at this layer (allowed: user, machine)')
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /edit/i })
    ).not.toBeInTheDocument();
  });

  test('a composite def renders the file-edit copy, never an edit affordance', () => {
    renderWithProviders(
      <LayerRow def={COMPOSITE_DEF} row={COMPOSITE_ROW} role="contributor" />
    );

    expect(screen.getByText('composite value — edit the file')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /edit/i })
    ).not.toBeInTheDocument();
  });

  test('a failed apply renders applyError inside the staged block', async () => {
    renderWithProviders(
      <LayerRow
        def={NUMBER_DEF}
        row={USER_ROW}
        role="winner"
        applyError="rt: two teams have local stores — pass --team"
      />
    );

    await stageChange('14');

    const panel = screen.getByTestId('layer-stage-user:/stores/user.jsonc');
    expect(panel).toHaveTextContent(
      'rt: two teams have local stores — pass --team'
    );
  });
});
