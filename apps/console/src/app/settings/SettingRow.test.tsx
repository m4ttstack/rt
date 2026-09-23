import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type { SettingDefWire } from '@mattstack/settings-kit/react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SettingRow } from './SettingRow';

function def(key: string, over: Partial<SettingDefWire> = {}): SettingDefWire {
  return {
    key,
    type: 'string',
    scopes: ['user', 'machine'],
    merge: 'replace',
    secret: false,
    teamLocked: false,
    repoScoped: false,
    writable: true,
    description: 'What it does. A second sentence nobody needs here.',
    hasDefault: false,
    defaultValue: null,
    effective: { scope: null, file: null },
    ...over,
  };
}

function store() {
  return {
    set: vi.fn(async () => null as string | null),
    unset: vi.fn(async () => null as string | null),
    move: vi.fn(async () => null as string | null),
  };
}

describe('SettingRow', () => {
  it('shows the key, the first sentence, the source, and an explain link', () => {
    renderWithProviders(
      <SettingRow
        def={def('agent.claude.effort', {
          effective: { scope: 'default', file: null, value: 'high' },
        })}
        store={store()}
        subhead={null}
        query=""
      />
    );
    expect(screen.getByText('agent.claude.')).toBeInTheDocument();
    expect(screen.getByText('effort')).toBeInTheDocument();
    expect(screen.getByText('What it does.')).toBeInTheDocument();
    expect(screen.getByText('default')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'explain agent.claude.effort' })
    ).toHaveAttribute('href', '/config/agent.claude.effort');
  });

  it('clamps the description to one line', () => {
    renderWithProviders(
      <SettingRow
        def={def('agent.claude.effort')}
        store={store()}
        subhead={null}
        query=""
      />
    );
    expect(screen.getByText('What it does.')).toHaveAttribute(
      'data-line-clamp'
    );
  });

  it('an unset scalar says so as a placeholder, never a blank box', () => {
    renderWithProviders(
      <>
        <SettingRow
          def={def('rt.daemonPath')}
          store={store()}
          subhead={null}
          query=""
        />
        <SettingRow
          def={def('board.gateGraceMinutes', { type: 'number' })}
          store={store()}
          subhead={null}
          query=""
        />
      </>
    );
    expect(screen.getByLabelText('rt.daemonPath')).toHaveAttribute(
      'placeholder',
      'unset'
    );
    expect(screen.getByLabelText('board.gateGraceMinutes')).toHaveAttribute(
      'placeholder',
      'unset'
    );
  });

  it('saves a string on blur to the winning layer', async () => {
    const s = store();
    renderWithProviders(
      <SettingRow
        def={def('agent.claude.effort', {
          effective: { scope: 'machine', file: '/m', value: 'high' },
        })}
        store={s}
        subhead={null}
        query=""
      />
    );
    const input = screen.getByLabelText('agent.claude.effort');
    await userEvent.clear(input);
    await userEvent.type(input, 'low');
    input.blur();
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith(
        'agent.claude.effort',
        'machine',
        'low'
      )
    );
    expect(await screen.findByText('saved')).toBeInTheDocument();
  });

  it('clearing a string unsets it instead of writing an empty string', async () => {
    const s = store();
    renderWithProviders(
      <SettingRow
        def={def('agent.claude.effort', {
          effective: { scope: 'user', file: '/u', value: 'high' },
        })}
        store={s}
        subhead={null}
        query=""
      />
    );
    const input = screen.getByLabelText('agent.claude.effort');
    await userEvent.clear(input);
    input.blur();
    await waitFor(() =>
      expect(s.unset).toHaveBeenCalledWith('agent.claude.effort', 'user')
    );
  });

  it('emptying a value that comes from the default restores it without a write', async () => {
    const s = store();
    renderWithProviders(
      <SettingRow
        def={def('agent.claude.effort', {
          effective: { scope: 'default', file: null, value: 'high' },
        })}
        store={s}
        subhead={null}
        query=""
      />
    );
    const input = screen.getByLabelText('agent.claude.effort');
    await userEvent.clear(input);
    input.blur();
    await waitFor(() =>
      expect(screen.getByLabelText('agent.claude.effort')).toHaveValue('high')
    );
    expect(s.unset).not.toHaveBeenCalled();
    expect(s.set).not.toHaveBeenCalled();
    expect(screen.queryByText('saved')).toBeNull();
  });

  it('emptying a number that comes from the default restores it without a write', async () => {
    const s = store();
    renderWithProviders(
      <SettingRow
        def={def('rt.runsPruneDays', {
          type: 'number',
          effective: { scope: 'default', file: null, value: 30 },
        })}
        store={s}
        subhead={null}
        query=""
      />
    );
    const input = screen.getByLabelText('rt.runsPruneDays');
    await userEvent.clear(input);
    input.blur();
    await waitFor(() =>
      expect(screen.getByLabelText('rt.runsPruneDays')).toHaveValue('30')
    );
    expect(s.unset).not.toHaveBeenCalled();
  });

  it('follows a refreshed effective value and writes nothing on a bare blur', async () => {
    const s = store();
    const { rerender } = renderWithProviders(
      <SettingRow
        def={def('agent.claude.effort', {
          effective: { scope: 'user', file: '/u', value: 'high' },
        })}
        store={s}
        subhead={null}
        query=""
      />
    );
    rerender(
      <SettingRow
        def={def('agent.claude.effort', {
          effective: { scope: 'default', file: null, value: 'medium' },
        })}
        store={s}
        subhead={null}
        query=""
      />
    );
    const input = screen.getByLabelText('agent.claude.effort');
    expect(input).toHaveValue('medium');
    await userEvent.click(input);
    input.blur();
    await new Promise(r => setTimeout(r, 0));
    expect(s.set).not.toHaveBeenCalled();
    expect(s.unset).not.toHaveBeenCalled();
  });

  it('Enter on a highlighted suggestion saves the suggestion, once', async () => {
    const s = store();
    renderWithProviders(
      <SettingRow
        def={def('board.agent.model')}
        store={s}
        subhead={null}
        query=""
        suggestions={['sonnet-long', 'opus']}
      />
    );
    const input = screen.getByRole('combobox', {
      name: 'board.agent.model',
    });
    await userEvent.type(input, 'son');
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith(
        'board.agent.model',
        'user',
        'sonnet-long'
      )
    );
    expect(s.set).toHaveBeenCalledTimes(1);
  });

  it("shows rt's refusal verbatim under the row", async () => {
    const s = store();
    s.set.mockResolvedValue('rt: nope');
    renderWithProviders(
      <SettingRow
        def={def('agent.claude.effort')}
        store={s}
        subhead={null}
        query=""
      />
    );
    const input = screen.getByLabelText('agent.claude.effort');
    await userEvent.type(input, 'x');
    input.blur();
    expect(await screen.findByText('rt: nope')).toBeInTheDocument();
  });

  it('an invalid winning layer says so and the next save still targets it', async () => {
    const s = store();
    renderWithProviders(
      <SettingRow
        def={def('agent.claude.yolo', {
          type: 'boolean',
          effective: { scope: 'user', file: '/u', invalid: 'expected boolean' },
        })}
        store={s}
        subhead={null}
        query=""
      />
    );
    expect(
      screen.getByText('stored value rejected: expected boolean')
    ).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('agent.claude.yolo'));
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith('agent.claude.yolo', 'user', true)
    );
  });

  it('toggles a boolean immediately', async () => {
    const s = store();
    renderWithProviders(
      <SettingRow
        def={def('agent.claude.yolo', { type: 'boolean' })}
        store={s}
        subhead={null}
        query=""
      />
    );
    await userEvent.click(screen.getByLabelText('agent.claude.yolo'));
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith('agent.claude.yolo', 'user', true)
    );
  });

  it('a Switch keeps its node and focus across a save and refresh', async () => {
    const s = store();
    const at = (value: boolean) =>
      def('agent.claude.yolo', {
        type: 'boolean',
        effective: { scope: 'user', file: '/u', value },
      });
    const { rerender } = renderWithProviders(
      <SettingRow def={at(false)} store={s} subhead={null} query="" />
    );
    const toggle = screen.getByLabelText('agent.claude.yolo');
    await userEvent.click(toggle);
    await waitFor(() => expect(s.set).toHaveBeenCalled());
    rerender(<SettingRow def={at(true)} store={s} subhead={null} query="" />);
    const after = screen.getByLabelText('agent.claude.yolo');
    expect(after).toBe(toggle);
    expect(after).toHaveFocus();
    expect(after).toBeChecked();
  });

  it('offers the ENUMS options as a select', async () => {
    const s = store();
    renderWithProviders(
      <SettingRow
        def={def('rt.logLevel', {
          scopes: ['machine', 'user'],
          effective: { scope: 'default', file: null, value: 'info' },
        })}
        store={s}
        subhead={null}
        query=""
      />
    );
    await userEvent.click(
      screen.getByRole('combobox', { name: 'rt.logLevel' })
    );
    await userEvent.click(await screen.findByRole('option', { name: 'debug' }));
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith('rt.logLevel', 'machine', 'debug')
    );
  });

  it('labels the provider options by product name and writes the id', async () => {
    const s = store();
    renderWithProviders(
      <SettingRow
        def={def('agent.provider', {
          effective: { scope: 'default', file: null, value: 'claude' },
        })}
        store={s}
        subhead={null}
        query=""
      />
    );
    const select = screen.getByRole('combobox', { name: 'agent.provider' });
    expect(select).toHaveValue('Claude');
    await userEvent.click(select);
    await userEvent.click(await screen.findByRole('option', { name: 'Codex' }));
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith('agent.provider', 'user', 'codex')
    );
  });

  it('hides the badge under a matching subhead and still moves from the row menu', async () => {
    const s = store();
    renderWithProviders(
      <SettingRow
        def={def('board.agent.model', {
          effective: { scope: 'machine', file: '/m', value: 'x' },
        })}
        store={s}
        subhead="machine"
        query=""
      />
    );
    expect(screen.queryByText('machine')).toBeNull();
    await userEvent.click(
      screen.getByRole('button', { name: 'board.agent.model actions' })
    );
    await userEvent.click(
      await screen.findByRole('menuitem', { name: 'Move to user' })
    );
    await waitFor(() =>
      expect(s.move).toHaveBeenCalledWith(
        'board.agent.model',
        'machine',
        'user'
      )
    );
  });

  it('removes a stored value from its layer through the row menu', async () => {
    const s = store();
    renderWithProviders(
      <SettingRow
        def={def('agent.claude.yolo', {
          type: 'boolean',
          effective: { scope: 'user', file: '/u', value: false },
        })}
        store={s}
        subhead={null}
        query=""
      />
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'agent.claude.yolo actions' })
    );
    await userEvent.click(
      await screen.findByRole('menuitem', { name: 'Remove from user' })
    );
    await waitFor(() =>
      expect(s.unset).toHaveBeenCalledWith('agent.claude.yolo', 'user')
    );
  });

  it('a stored secret or an unwritable stored row has no row menu', () => {
    renderWithProviders(
      <>
        <SettingRow
          def={def('chat.apiToken', {
            secret: true,
            writable: false,
            effective: { scope: 'user', file: '/u' },
          })}
          store={store()}
          subhead={null}
          query=""
        />
        <SettingRow
          def={def('rt.roles', {
            writable: false,
            effective: { scope: 'user', file: '/u', value: 'x' },
          })}
          store={store()}
          subhead={null}
          query=""
        />
      </>
    );
    expect(screen.queryByRole('button', { name: /actions$/ })).toBeNull();
  });

  it('offers moves only to the other scopes the key allows', async () => {
    renderWithProviders(
      <SettingRow
        def={def('board.agent.model', {
          scopes: ['user', 'machine'],
          effective: { scope: 'machine', file: '/m', value: 'x' },
        })}
        store={store()}
        subhead={null}
        query=""
      />
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'board.agent.model actions' })
    );
    await screen.findByRole('menuitem', { name: 'Remove from machine' });
    expect(
      screen
        .getAllByRole('menuitem')
        .map(i => i.textContent)
        .filter(t => t?.startsWith('Move'))
    ).toEqual(['Move to user']);
  });

  it("shows rt's refusal of a move under the row", async () => {
    const s = store();
    s.move.mockResolvedValueOnce('rt: the user store is read-only');
    renderWithProviders(
      <SettingRow
        def={def('board.agent.model', {
          effective: { scope: 'machine', file: '/m', value: 'x' },
        })}
        store={s}
        subhead={null}
        query=""
      />
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'board.agent.model actions' })
    );
    await userEvent.click(
      await screen.findByRole('menuitem', { name: 'Move to user' })
    );
    expect(
      await screen.findByText('rt: the user store is read-only')
    ).toBeInTheDocument();
  });

  it("shows rt's refusal of a remove under the row", async () => {
    const s = store();
    s.unset.mockResolvedValueOnce('rt: the machine store is locked');
    renderWithProviders(
      <SettingRow
        def={def('board.agent.model', {
          effective: { scope: 'machine', file: '/m', value: 'x' },
        })}
        store={s}
        subhead={null}
        query=""
      />
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'board.agent.model actions' })
    );
    await userEvent.click(
      await screen.findByRole('menuitem', { name: 'Remove from machine' })
    );
    expect(
      await screen.findByText('rt: the machine store is locked')
    ).toBeInTheDocument();
  });

  it('a value stored in a scope the key no longer allows has no row menu', () => {
    renderWithProviders(
      <SettingRow
        def={def('board.agent.model', {
          scopes: ['user', 'machine'],
          effective: { scope: 'team', file: '/t', value: 'x' },
        })}
        store={store()}
        subhead={null}
        query=""
      />
    );
    expect(screen.queryByRole('button', { name: /actions$/ })).toBeNull();
  });

  it('a rejected stored value can be removed but not moved', async () => {
    renderWithProviders(
      <SettingRow
        def={def('board.agent.model', {
          effective: { scope: 'machine', file: '/m', invalid: 'not a model' },
        })}
        store={store()}
        subhead={null}
        query=""
      />
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'board.agent.model actions' })
    );
    await screen.findByRole('menuitem', { name: 'Remove from machine' });
    expect(screen.queryByRole('menuitem', { name: /^Move/ })).toBeNull();
  });

  it('a default or unset row has no row menu', () => {
    renderWithProviders(
      <>
        <SettingRow
          def={def('rt.logLevel', {
            effective: { scope: 'default', file: null, value: 'info' },
          })}
          store={store()}
          subhead={null}
          query=""
        />
        <SettingRow
          def={def('rt.daemonPath')}
          store={store()}
          subhead={null}
          query=""
        />
      </>
    );
    expect(screen.queryByRole('button', { name: /actions$/ })).toBeNull();
  });

  it('an unset secret says unset once and shows no mask', () => {
    renderWithProviders(
      <SettingRow
        def={def('rt.linearToken', { secret: true, writable: false })}
        store={store()}
        subhead={null}
        query=""
      />
    );
    expect(screen.getAllByText('unset')).toHaveLength(1);
    expect(screen.queryByText('•••')).toBeNull();
  });

  it('an external row summarises and names its owner', () => {
    renderWithProviders(
      <SettingRow
        def={def('board.members', {
          type: 'array',
          scopes: ['team'],
          writable: false,
          effective: { scope: 'team', file: '/t', value: [{}, {}, {}] },
        })}
        store={store()}
        subhead={null}
        query=""
      />
    );
    expect(screen.getByText('3 members · edited in board')).toBeInTheDocument();
  });
});
