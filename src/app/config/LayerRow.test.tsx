import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
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

const SECRET_DEF: SettingDefWire = {
  key: 'board.apiToken',
  type: 'string',
  scopes: ['user'],
  merge: 'replace',
  secret: true,
  teamLocked: false,
  repoScoped: false,
  writable: false,
  description: 'Forge API token.',
  hasDefault: false,
  defaultValue: null,
};

async function stageChange(newValue: string) {
  await userEvent.click(screen.getByRole('button', { name: /edit/i }));
  const input = screen.getByRole('textbox', { name: /new value/i });
  await userEvent.clear(input);
  await userEvent.type(input, newValue);
  await userEvent.click(screen.getByRole('button', { name: /^stage$/i }));
}

function renderStagedRow() {
  const onApply = vi.fn();
  const utils = renderWithProviders(
    <LayerRow
      def={NUMBER_DEF}
      row={USER_ROW}
      role="winner"
      onApply={onApply}
      applying={false}
      applyError={null}
    />
  );
  return { onApply, ...utils };
}

describe('LayerRow: staged edit-at-layer', () => {
  test('staging shows the delta, the exact command, and the staged copy; onApply is not yet called', async () => {
    const onApply = vi.fn();
    renderWithProviders(
      <LayerRow
        def={NUMBER_DEF}
        row={USER_ROW}
        role="winner"
        onApply={onApply}
      />
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
      <LayerRow
        def={NUMBER_DEF}
        row={USER_ROW}
        role="winner"
        onApply={onApply}
      />
    );

    await stageChange('14');
    await userEvent.click(screen.getByRole('button', { name: /^apply$/i }));

    expect(onApply).toHaveBeenCalledWith(14, 'user');
  });

  test('pressing Discard closes the staged block without calling onApply', async () => {
    const onApply = vi.fn();
    renderWithProviders(
      <LayerRow
        def={NUMBER_DEF}
        row={USER_ROW}
        role="winner"
        onApply={onApply}
      />
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
    renderWithProviders(
      <LayerRow def={NUMBER_DEF} row={teamRow} role="inert" />
    );

    expect(
      screen.getByText('not allowed at this layer (allowed: user, machine)')
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /edit/i })
    ).not.toBeInTheDocument();
  });

  test('an allowed-scope row of a secret def does not show the allowed-list copy', () => {
    const secretUserRow: ExplainRowWire = {
      scope: 'user',
      file: '/stores/user.jsonc',
      present: true,
    };
    renderWithProviders(
      <LayerRow def={SECRET_DEF} row={secretUserRow} role="winner" />
    );

    expect(
      screen.queryByText(/not allowed at this layer/)
    ).not.toBeInTheDocument();
  });

  test('a disallowed-scope row of a secret def still shows the allowed-list copy', () => {
    const secretMachineRow: ExplainRowWire = {
      scope: 'machine',
      file: '/stores/machine.jsonc',
      present: true,
    };
    renderWithProviders(
      <LayerRow def={SECRET_DEF} row={secretMachineRow} role="inert" />
    );

    expect(
      screen.getByText('not allowed at this layer (allowed: user)')
    ).toBeInTheDocument();
  });

  test('a composite def renders the file-edit copy, never an edit affordance', () => {
    renderWithProviders(
      <LayerRow def={COMPOSITE_DEF} row={COMPOSITE_ROW} role="contributor" />
    );

    expect(
      screen.getByText('composite value — edit the file')
    ).toBeInTheDocument();
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

  test('the staged block closes on a successful apply, restoring the edit affordance', async () => {
    const { onApply, rerender } = renderStagedRow();
    await stageChange('14');

    rerender(
      <LayerRow
        def={NUMBER_DEF}
        row={USER_ROW}
        role="winner"
        onApply={onApply}
        applying
        applyError={null}
      />
    );
    rerender(
      <LayerRow
        def={NUMBER_DEF}
        row={USER_ROW}
        role="winner"
        onApply={onApply}
        applying={false}
        applyError={null}
      />
    );

    expect(
      screen.queryByTestId('layer-stage-user:/stores/user.jsonc')
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument();
  });

  test('a failed apply leaves the staged block up, with the error shown, instead of closing', async () => {
    const { onApply, rerender } = renderStagedRow();
    await stageChange('14');

    rerender(
      <LayerRow
        def={NUMBER_DEF}
        row={USER_ROW}
        role="winner"
        onApply={onApply}
        applying
        applyError={null}
      />
    );
    rerender(
      <LayerRow
        def={NUMBER_DEF}
        row={USER_ROW}
        role="winner"
        onApply={onApply}
        applying={false}
        applyError="rt: two teams have local stores — pass --team"
      />
    );

    const panel = screen.getByTestId('layer-stage-user:/stores/user.jsonc');
    expect(panel).toHaveTextContent(
      'rt: two teams have local stores — pass --team'
    );
  });
});

describe('LayerRow: the file a layer was authored in', () => {
  test('opens the store file in the editor, at the path the resolver named', () => {
    // The spec's "file paths clickable": the console cannot edit a composite
    // or inspect a store itself, so the path IS the handoff -- same
    // `vscode://file` form every other outward action in the app uses.
    renderWithProviders(
      <LayerRow def={NUMBER_DEF} row={USER_ROW} role="winner" />
    );

    expect(
      screen.getByRole('link', { name: /open \/stores\/user\.jsonc/i })
    ).toHaveAttribute('href', 'vscode://file/stores/user.jsonc');
  });

  test('the registry default is stated, not linked — it lives in no file', () => {
    renderWithProviders(
      <LayerRow
        def={NUMBER_DEF}
        row={{ scope: 'default', file: null, present: true, value: 30 }}
        role="winner"
      />
    );

    expect(screen.getByText('registry default')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
