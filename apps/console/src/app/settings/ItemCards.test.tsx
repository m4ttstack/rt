import { useState } from 'react';
import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type { SettingDefWire } from '@mattstack/settings-kit/react';
import { checkValue } from '@mattstack/settings-kit/shapes';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { formShape } from './formShape';
import { ItemCards } from './ItemCards';
import { SettingRow } from './SettingRow';
import { schemaFields } from './testSchemas';

const RULE = {
  pattern: 'gate/opened/*',
  subjectPrefix: 'run:',
  category: 'gate',
  title: '{label}',
  message: '{question}',
  url: 'http://localhost:11001/gates/{id}',
};

function bridges(value: unknown[]): SettingDefWire {
  return {
    key: 'rt.notify.eventBridges',
    type: 'array',
    scopes: ['user'],
    merge: 'replace',
    secret: false,
    teamLocked: false,
    repoScoped: false,
    writable: true,
    description: 'Event bridge rules.',
    hasDefault: false,
    defaultValue: null,
    effective: { scope: 'user', file: '/home/user/settings.user.jsonc', value },
    storeVersion: 1,
    ...schemaFields('rt.notify.eventBridges'),
  };
}

const store = () => ({
  set: vi.fn(async () => null as string | null),
  unset: vi.fn(async () => null as string | null),
  move: vi.fn(async () => null as string | null),
});

beforeEach(() =>
  vi.stubGlobal('fetch', async () => ({
    ok: true,
    status: 200,
    json: async () => ({ def: null, rows: [] }),
  }))
);
afterEach(() => vi.unstubAllGlobals());

async function open(value: unknown[], s = store()) {
  renderWithProviders(
    <SettingRow def={bridges(value)} store={s} subhead={null} query="" />
  );
  // The row's summary toggle ("1 bridge", "2 bridges"); the row menu's
  // button also carries aria-expanded, so match by name.
  await userEvent.click(screen.getByRole('button', { name: /^\d+ bridges?$/ }));
  return s;
}

describe('item cards', () => {
  it('draws one card per item with required fields and set optional ones', async () => {
    await open([RULE]);
    const card = screen.getByTestId('item-0');
    expect(within(card).getByLabelText('pattern')).toHaveValue('gate/opened/*');
    expect(within(card).getByLabelText('url')).toHaveValue(RULE.url);
    expect(within(card).queryByLabelText('surface')).toBeNull();
    expect(
      within(card).queryByRole('button', { name: 'remove pattern' })
    ).toBeNull();
    expect(
      within(card).getByRole('button', { name: 'remove url' })
    ).toBeInTheDocument();
  });

  it('Add item appends a card whose empty required fields keep Save disabled', async () => {
    const s = await open([RULE]);
    await userEvent.click(screen.getByRole('button', { name: 'Add item' }));
    const card = screen.getByTestId('item-1');
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    expect(within(card).queryByText('required')).toBeNull();
    expect(
      screen.getByText('#2 has 4 empty required fields')
    ).toBeInTheDocument();
    await userEvent.type(within(card).getByLabelText('pattern'), 'run/*');
    await userEvent.type(within(card).getByLabelText('category'), 'run');
    await userEvent.type(within(card).getByLabelText('title'), 't');
    await userEvent.type(within(card).getByLabelText('message'), 'm');
    expect(save).toBeEnabled();
    await userEvent.click(save);
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith('rt.notify.eventBridges', 'user', [
        RULE,
        { pattern: 'run/*', category: 'run', title: 't', message: 'm' },
      ])
    );
  });

  it('reorders and removes items', async () => {
    const other = { ...RULE, pattern: 'run/*', subjectPrefix: 'mr:' };
    const s = await open([RULE, other]);
    await userEvent.click(
      screen.getByRole('button', { name: 'move item 2 up' })
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'remove item 2' })
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith('rt.notify.eventBridges', 'user', [
        other,
      ])
    );
  });

  it('Add property reveals an optional field; its remove drops it again', async () => {
    await open([RULE]);
    const card = screen.getByTestId('item-0');
    await userEvent.click(
      within(card).getByRole('button', { name: 'Add property' })
    );
    await userEvent.click(
      await screen.findByRole('menuitem', { name: 'surface' })
    );
    expect(within(card).getByLabelText('surface')).toHaveValue('');
    await userEvent.click(
      within(card).getByRole('button', { name: 'remove surface' })
    );
    expect(within(card).queryByLabelText('surface')).toBeNull();
  });

  it('an unknown extra property is shown read-only and kept on save', async () => {
    const s = await open([{ ...RULE, legacy: 1 }]);
    const card = screen.getByTestId('item-0');
    expect(within(card).getByText('legacy')).toBeInTheDocument();
    expect(within(card).getByText('1')).toBeInTheDocument();
    const title = within(card).getByLabelText('title');
    await userEvent.clear(title);
    await userEvent.type(title, 'Gate');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith('rt.notify.eventBridges', 'user', [
        { ...RULE, title: 'Gate', legacy: 1 },
      ])
    );
  });

  it('Save is disabled until something changes; Cancel and Escape discard the draft', async () => {
    const s = await open([RULE]);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    const title = within(screen.getByTestId('item-0')).getByLabelText('title');
    await userEvent.clear(title);
    await userEvent.type(title, 'Changed{Escape}');
    expect(
      within(screen.getByTestId('item-0')).getByLabelText('title')
    ).toHaveValue('{label}');
    await userEvent.type(
      within(screen.getByTestId('item-0')).getByLabelText('title'),
      'x'
    );
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(
      within(screen.getByTestId('item-0')).getByLabelText('title')
    ).toHaveValue('{label}');
    expect(s.set).not.toHaveBeenCalled();
  });

  it("shows rt's refusal under the row and keeps the draft", async () => {
    const s = store();
    s.set.mockResolvedValueOnce(
      'merged value would fail: [0].url: expected string'
    );
    await open([RULE], s);
    const title = within(screen.getByTestId('item-0')).getByLabelText('title');
    await userEvent.type(title, '!');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText(
        'merged value would fail: [0].url: expected string'
      )
    ).toBeInTheDocument();
    expect(title).toHaveValue('{label}!');
  });

  it('clearing a set optional field keeps it visible while it is retyped', async () => {
    const s = await open([RULE]);
    const card = screen.getByTestId('item-0');
    await userEvent.clear(within(card).getByLabelText('url'));
    expect(within(card).getByLabelText('url')).toHaveValue('');
    await userEvent.type(within(card).getByLabelText('url'), 'http://x');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith('rt.notify.eventBridges', 'user', [
        { ...RULE, url: 'http://x' },
      ])
    );
  });

  it('Escape closes an open Select without discarding the draft; a second Escape discards it', async () => {
    const s = await open([RULE]);
    const card = screen.getByTestId('item-0');
    await userEvent.clear(within(card).getByLabelText('title'));
    await userEvent.type(within(card).getByLabelText('title'), 'Changed');
    await userEvent.click(
      within(card).getByRole('button', { name: 'Add property' })
    );
    await userEvent.click(
      await screen.findByRole('menuitem', { name: 'owner' })
    );
    await userEvent.click(
      within(card).getByRole('combobox', { name: 'owner' })
    );
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(
      within(screen.getByTestId('item-0')).getByLabelText('title')
    ).toHaveValue('Changed');
    await userEvent.keyboard('{Escape}');
    expect(
      within(screen.getByTestId('item-0')).getByLabelText('title')
    ).toHaveValue('{label}');
    expect(s.set).not.toHaveBeenCalled();
  });

  it('clearing and retyping a field keeps its position in the written object', async () => {
    const s = await open([RULE]);
    const card = screen.getByTestId('item-0');
    await userEvent.clear(within(card).getByLabelText('category'));
    await userEvent.type(within(card).getByLabelText('category'), 'run');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(s.set).toHaveBeenCalled());
    const call = s.set.mock.calls[0] as unknown as [
      string,
      string,
      Record<string, unknown>[],
    ];
    expect(Object.keys(call[2][0]!)).toEqual(Object.keys(RULE));
  });

  it('an untouched new card shows no issue text and Save is disabled', async () => {
    await open([RULE]);
    await userEvent.click(screen.getByRole('button', { name: 'Add item' }));
    const card = screen.getByTestId('item-1');
    expect(within(card).queryByText('required')).toBeNull();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('typing into and clearing a required field shows "required" on its row', async () => {
    await open([RULE]);
    const card = screen.getByTestId('item-0');
    const pattern = within(card).getByLabelText('pattern');
    await userEvent.type(pattern, 'x');
    await userEvent.clear(pattern);
    expect(
      within(screen.getByTestId('field-row-pattern')).getByText('required')
    ).toBeInTheDocument();
  });

  it("the footer's touched issue is numbered to match the card header", async () => {
    await open([RULE]);
    await userEvent.click(screen.getByRole('button', { name: 'Add item' }));
    const card = screen.getByTestId('item-1');
    expect(within(card).getByText('#2')).toBeInTheDocument();
    const pattern = within(card).getByLabelText('pattern');
    await userEvent.type(pattern, 'x');
    await userEvent.clear(pattern);
    expect(screen.getByText('#2 pattern: required')).toBeInTheDocument();
  });

  it('a field row with an issue keeps the same height as one without', async () => {
    await open([RULE]);
    const card = screen.getByTestId('item-0');
    const pattern = within(card).getByLabelText('pattern');
    await userEvent.type(pattern, 'x');
    await userEvent.clear(pattern);
    const patternRow = screen.getByTestId('field-row-pattern');
    const categoryRow = screen.getByTestId('field-row-category');
    expect(patternRow.style.height).not.toBe('');
    expect(patternRow.style.height).toBe(categoryRow.style.height);
  });

  it('a disabled move arrow leaves colour to Mantine and clears its background', async () => {
    const other = { ...RULE, pattern: 'run/*' };
    await open([RULE, other]);
    const up = screen.getByRole('button', { name: 'move item 1 up' });
    expect(up).toBeDisabled();
    expect(up.style.color).toBe('');
    expect(up.style.background).toBe('transparent');
    const down = screen.getByRole('button', { name: 'move item 1 down' });
    expect(down).toBeEnabled();
    expect(down.style.color).not.toBe('');
    expect(down.style.background).not.toBe('transparent');
  });

  it('stored issues show on their field at once', async () => {
    await open([{ ...RULE, subjectPrefix: 123 }]);
    const row = screen.getByTestId('field-row-subjectPrefix');
    expect(
      within(row).getByText('expected string, got number')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('the untouched note names every untouched card', async () => {
    await open([RULE]);
    await userEvent.click(screen.getByRole('button', { name: 'Add item' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add item' }));
    expect(
      screen.getByText('#2, #3 have 8 empty required fields')
    ).toBeInTheDocument();
  });

  it('footer issue text can shrink and truncate, and never displaces the buttons', async () => {
    await open([{ ...RULE, subjectPrefix: 123 }]);
    const fallback = screen.getByText(
      '#1 subjectPrefix: expected string, got number'
    );
    expect(fallback).toHaveAttribute('data-truncate');
    expect(fallback.style.minWidth).toBe('0px');
    expect(
      screen.getByRole('button', { name: 'Add item' })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });
});

describe('a card with a number, a switch and an enum field', () => {
  const CARD_SCHEMA = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'array',
    items: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        count: { type: 'number' },
        active: { type: 'boolean' },
        level: { type: 'string', enum: ['low', 'medium', 'high'] },
      },
      required: ['name'],
      additionalProperties: {},
    },
  };
  const CARD_SHAPE = formShape(CARD_SCHEMA)!;

  function CardsHarness({ initial }: { initial: Record<string, unknown>[] }) {
    const [value, setValue] = useState(initial);
    const issues = checkValue(CARD_SCHEMA, value);
    return (
      <ItemCards
        shape={CARD_SHAPE}
        value={value}
        onChange={setValue}
        disabled={false}
        issues={issues}
        footerEnd={null}
      />
    );
  }

  it('edits a number, a switch and an enum field on the same card', async () => {
    renderWithProviders(
      <CardsHarness
        initial={[{ name: 'a', count: 1, active: false, level: 'low' }]}
      />
    );
    const card = screen.getByTestId('item-0');
    const count = within(card).getByLabelText('count');
    await userEvent.clear(count);
    await userEvent.type(count, '5');
    await userEvent.click(within(card).getByLabelText('active'));
    await userEvent.click(
      within(card).getByRole('combobox', { name: 'level' })
    );
    await userEvent.click(await screen.findByRole('option', { name: 'high' }));
    expect(within(card).getByLabelText('count')).toHaveValue('5');
    expect(within(card).getByLabelText('active')).toBeChecked();
    expect(within(card).getByRole('combobox', { name: 'level' })).toHaveValue(
      'high'
    );
  });
});
