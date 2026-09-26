import { describe, expect, test } from 'bun:test';

import { allDefs } from '@mattstack/rt-client';
import type { ExplainRowWire } from '@mattstack/settings-kit/react';
import { DEFAULT_SLACK_EMOJI as KIT_SLACK_EMOJI } from '@mattstack/settings-kit/shapes';
import { DEFAULT_SLACK_EMOJI } from '../../slack-emoji.ts';
import {
  addToList,
  filterDefs,
  getLeaf,
  groupByScope,
  isSet,
  leafWrite,
  matchesShape,
  parseScalar,
  rosterSummary,
  rowKind,
  scopeLabel,
  setLeaf,
  shapeOf,
  slugTabId,
  type ConfigDef,
} from '../board/config-shapes.ts';

const REGISTRY = new Map(allDefs().map(d => [d.key, d]));

function def(over: Partial<ConfigDef> & { key: string }): ConfigDef {
  return {
    type: 'string',
    scopes: ['team'],
    merge: 'replace',
    secret: false,
    teamLocked: false,
    repoScoped: false,
    writable: true,
    description: '',
    hasDefault: false,
    defaultValue: undefined,
    effective: { scope: null, file: null },
    storeVersion: 1,
    schema: REGISTRY.get(over.key)?.schema,
    ...over,
  };
}

/** Composite board.* registry keys with no edit UI yet -- rowKind's
    "readonly" fallback (no shapeOf editor) is the intended rendering for
    these, not a coverage gap. */
// board.rtRepos is retired: the board derives it from board.projects and
// board.gitlabHost (config.ts deriveRtRepos). The registry row goes with the
// next @mattstack/rt-client publish; until board picks that up, the key is
// still registered and must not be offered for editing.
const DELIBERATELY_READONLY_COMPOSITES: string[] = ['board.rtRepos'];

describe('shapeOf', () => {
  test('gives every composite board.* registry key a board editor or a widget', () => {
    const missing = allDefs()
      .filter(
        d =>
          d.key.startsWith('board.') &&
          (d.type === 'object' || d.type === 'array') &&
          !DELIBERATELY_READONLY_COMPOSITES.includes(d.key)
      )
      .filter(d => shapeOf(d) === undefined)
      .map(d => d.key);
    expect(missing).toEqual([]);
  });

  test('previously shaped keys keep their widget, fields and fallbacks', () => {
    expect(shapeOf(REGISTRY.get('board.projects')!)).toEqual({
      kind: 'stringList',
    });
    expect(shapeOf(REGISTRY.get('board.cwds')!)).toEqual({
      kind: 'leaves',
      fields: { review: 'string', respond: 'string', doctor: 'string' },
      fallbacks: {},
    });
    expect(shapeOf(REGISTRY.get('board.slack')!)).toMatchObject({
      kind: 'leaves',
      fallbacks: {
        'emoji.looking': 'eyes',
        'emoji.commented': 'speech_balloon',
        'emoji.approved': 'white_check_mark',
      },
    });
    expect(shapeOf(REGISTRY.get('board.tabs')!)).toEqual({ kind: 'tabs' });
    expect(shapeOf(REGISTRY.get('board.members')!)).toEqual({
      kind: 'roster',
    });
  });

  test('a schema board has no widget for is undefined', () => {
    expect(
      shapeOf({ key: 'board.mystery', schema: { type: 'object' } })
    ).toBeUndefined();
    expect(
      shapeOf({ key: 'board.mystery', schema: undefined })
    ).toBeUndefined();
  });
});

describe('rowKind', () => {
  test('scalars by type when writable', () => {
    expect(rowKind(def({ key: 'board.title' }))).toBe('scalar');
    expect(rowKind(def({ key: 'board.staleAfterDays', type: 'number' }))).toBe(
      'scalar'
    );
  });

  test('secrets and unwritable keys are read-only', () => {
    expect(rowKind(def({ key: 'board.title', secret: true }))).toBe('readonly');
    expect(rowKind(def({ key: 'board.title', writable: false }))).toBe(
      'readonly'
    );
  });

  test('composites dispatch on their shape', () => {
    expect(rowKind(def({ key: 'board.projects', type: 'array' }))).toBe(
      'stringList'
    );
    expect(rowKind(def({ key: 'board.cwds', type: 'object' }))).toBe('leaves');
  });

  test('roster keys summarize regardless of writability', () => {
    expect(
      rowKind(def({ key: 'board.members', type: 'array', writable: false }))
    ).toBe('roster');
    expect(rowKind(def({ key: 'board.hiddenMembers', type: 'array' }))).toBe(
      'roster'
    );
  });

  test('composites the server refuses, or with no shape, are read-only', () => {
    expect(
      rowKind(def({ key: 'board.projects', type: 'array', writable: false }))
    ).toBe('readonly');
    expect(rowKind(def({ key: 'board.mystery', type: 'object' }))).toBe(
      'readonly'
    );
  });
});

describe('isSet', () => {
  test('true only when a real scope layer holds the value', () => {
    expect(
      isSet(
        def({ key: 'k', effective: { scope: 'team', value: 'x', file: '/t' } })
      )
    ).toBe(true);
    expect(
      isSet(
        def({
          key: 'k',
          effective: { scope: 'default', value: 'x', file: null },
        })
      )
    ).toBe(false);
    expect(
      isSet(def({ key: 'k', effective: { scope: null, file: null } }))
    ).toBe(false);
    expect(isSet(def({ key: 'k' }))).toBe(false);
  });
});

describe('scopeLabel', () => {
  test('machine applies immediately; the git-backed scopes warn', () => {
    expect(scopeLabel('machine')).toBe('machine');
    expect(scopeLabel('user')).toBe('user · local until pushed');
    expect(scopeLabel('team')).toBe('team · local until pushed');
  });
});

describe('matchesShape', () => {
  test('stringList accepts only arrays of strings', () => {
    const s = shapeOf(REGISTRY.get('board.projects')!)!;
    expect(matchesShape(s, [])).toBe(true);
    expect(matchesShape(s, ['a/b'])).toBe(true);
    expect(matchesShape(s, ['a', 1])).toBe(false);
    expect(matchesShape(s, 'a')).toBe(false);
  });

  test('board.rtRepos is no longer a configurable key: the board derives it', () => {
    const retired = REGISTRY.get('board.rtRepos');
    expect(retired === undefined || shapeOf(retired) === undefined).toBe(true);
  });

  test('pairList accepts arrays of objects carrying both string fields', () => {
    const s = { kind: 'pairList', fields: ['project', 'repo'] } as const;
    expect(matchesShape(s, [{ project: 'g/p', repo: 'host/x' }])).toBe(true);
    expect(matchesShape(s, [{ project: 'g/p' }])).toBe(false);
    expect(matchesShape(s, [['g/p', 'x']])).toBe(false);
  });

  test('leaves accepts a plain object whose known leaves have the right type; unknown keys pass through', () => {
    const s = shapeOf(REGISTRY.get('board.triage')!)!;
    expect(matchesShape(s, {})).toBe(true);
    expect(
      matchesShape(s, {
        enabled: true,
        fixClasses: { retryFlake: false },
        notify: 'rt',
      })
    ).toBe(true);
    expect(matchesShape(s, { enabled: 'yes' })).toBe(false);
    expect(matchesShape(s, { notify: 'loud' })).toBe(false);
    expect(matchesShape(s, { fixClasses: { retryFlake: 'no' } })).toBe(false);
    expect(matchesShape(s, { doctorSkill: 'x' })).toBe(true);
    expect(matchesShape(s, [])).toBe(false);
  });
});

describe('leaf access', () => {
  test('getLeaf walks dotted paths and tolerates missing branches', () => {
    expect(getLeaf({ emoji: { looking: 'eyes' } }, 'emoji.looking')).toBe(
      'eyes'
    );
    expect(getLeaf({}, 'emoji.looking')).toBeUndefined();
    expect(getLeaf(undefined, 'channel')).toBeUndefined();
  });

  test('setLeaf returns a new object, creating intermediates, without touching the input', () => {
    const before = { channel: 'reviews', emoji: { looking: 'eyes' } };
    const after = setLeaf(before, 'emoji.approved', 'white_check_mark');
    expect(after).toEqual({
      channel: 'reviews',
      emoji: { looking: 'eyes', approved: 'white_check_mark' },
    });
    expect(before).toEqual({ channel: 'reviews', emoji: { looking: 'eyes' } });
    expect(setLeaf(undefined, 'a.b', 1)).toEqual({ a: { b: 1 } });
  });

  test('setLeaf with undefined removes the leaf', () => {
    expect(setLeaf({ a: 1, b: 2 }, 'a', undefined)).toEqual({ b: 2 });
  });
});

describe('parseScalar', () => {
  test('strings pass through untouched', () => {
    expect(parseScalar('string', '  x ')).toEqual({ ok: true, value: '  x ' });
  });

  test('numbers must parse whole', () => {
    expect(parseScalar('number', '14')).toEqual({ ok: true, value: 14 });
    expect(parseScalar('number', ' 2.5 ')).toEqual({ ok: true, value: 2.5 });
    expect(parseScalar('number', '')).toEqual({
      ok: false,
      error: 'enter a number',
    });
    expect(parseScalar('number', '14 days')).toEqual({
      ok: false,
      error: 'not a number',
    });
  });
});

describe('addToList', () => {
  test('trims, drops empties, and refuses duplicates', () => {
    expect(addToList(['a'], ' b ')).toEqual(['a', 'b']);
    expect(addToList(['a'], '   ')).toBeNull();
    expect(addToList(['a'], 'a')).toBeNull();
  });
});

describe('filterDefs', () => {
  const defs = [
    def({
      key: 'board.title',
      description: "Display title shown in the board's UI.",
    }),
    def({
      key: 'board.staleAfterDays',
      description: 'Days of MR inactivity before stale.',
    }),
  ];

  test('empty query keeps everything', () => {
    expect(filterDefs(defs, '  ')).toHaveLength(2);
  });

  test('matches key or description, case-insensitively', () => {
    expect(filterDefs(defs, 'STALE').map(d => d.key)).toEqual([
      'board.staleAfterDays',
    ]);
    expect(filterDefs(defs, 'display').map(d => d.key)).toEqual([
      'board.title',
    ]);
    expect(filterDefs(defs, 'nothing')).toEqual([]);
  });
});

describe('groupByScope', () => {
  test('orders team, user, machine and drops empty groups', () => {
    const groups = groupByScope([
      def({ key: 'm', scopes: ['machine'] }),
      def({ key: 't', scopes: ['team'] }),
      def({ key: 'm2', scopes: ['machine'] }),
    ]);
    expect(groups.map(g => [g.scope, g.defs.map(d => d.key)])).toEqual([
      ['team', ['t']],
      ['machine', ['m', 'm2']],
    ]);
  });
});

describe('rosterSummary', () => {
  test('counts hidden from the overlay alone once the store owns it', () => {
    // board.hiddenMembers replaces the roster's inline flags in
    // withBoardStoreFallback, so counting the union would double-report a
    // member the overlay already checked back in.
    expect(
      rosterSummary([{ username: 'a', hidden: true }, { username: 'b' }], ['b'])
    ).toBe('2 members, 1 hidden');
  });

  test('falls back to inline flags with no overlay', () => {
    expect(
      rosterSummary(
        [{ username: 'a', hidden: true }, { username: 'b' }],
        undefined
      )
    ).toBe('2 members, 1 hidden');
  });

  test('tolerates unset values', () => {
    expect(rosterSummary(undefined, undefined)).toBe('no members');
    expect(rosterSummary([{ username: 'a' }], undefined)).toBe('1 member');
  });

  test('an overlay name that is not on the roster is not counted', () => {
    expect(rosterSummary([{ username: 'a' }, { username: 'b' }], ['c'])).toBe(
      '2 members'
    );
  });

  test('an empty overlay means nobody is hidden, not "fall back to inline flags"', () => {
    expect(rosterSummary([{ username: 'a', hidden: true }], [])).toBe(
      '1 member'
    );
  });
});

describe('tabs shape', () => {
  const s = shapeOf(REGISTRY.get('board.tabs')!)!;
  const team = { id: 'team', label: 'Team', source: { kind: 'authors' } };
  const acme = {
    id: 'acme',
    label: 'Acme',
    source: { kind: 'codeowners', section: 'Acme', excludeMembers: true },
    slackChannel: 'c',
    reviewSkill: 's',
  };

  test('board.tabs rows are the tabs kind regardless of writability', () => {
    expect(rowKind(def({ key: 'board.tabs', type: 'array' }))).toBe('tabs');
  });

  test('accepts the shapes parseTabs accepts', () => {
    expect(matchesShape(s, [team])).toBe(true);
    expect(matchesShape(s, [team, acme])).toBe(true);
  });

  test('rejects an empty list and duplicate ids, like parseTabs', () => {
    expect(matchesShape(s, [])).toBe(false);
    expect(matchesShape(s, [team, { ...acme, id: 'team' }])).toBe(false);
  });

  test('rejects what parseTabs rejects', () => {
    expect(matchesShape(s, 'team')).toBe(false);
    expect(matchesShape(s, [{ ...team, id: '' }])).toBe(false);
    expect(matchesShape(s, [{ ...team, label: 3 }])).toBe(false);
    expect(matchesShape(s, [{ ...team, source: { kind: 'codeowners' } }])).toBe(
      false
    );
    expect(
      matchesShape(s, [
        { ...acme, source: { ...acme.source, excludeMembers: 'yes' } },
      ])
    ).toBe(false);
    expect(matchesShape(s, [{ ...team, source: { kind: 'other' } }])).toBe(
      false
    );
    expect(matchesShape(s, [{ ...team, slackChannel: 1 }])).toBe(false);
  });
});

describe('slugTabId', () => {
  test('slugs the label and dodges taken ids', () => {
    expect(slugTabId('Acme Codeowners', [])).toBe('acme-codeowners');
    expect(slugTabId('  Team!  ', ['team'])).toBe('team-2');
    expect(slugTabId('Team', ['team', 'team-2'])).toBe('team-3');
    expect(slugTabId('???', [])).toBe('tab');
  });
});

describe('shared shapes', () => {
  test("settings-kit's slack emoji fallbacks match the board's", () => {
    expect(DEFAULT_SLACK_EMOJI).toEqual(KIT_SLACK_EMOJI);
  });
});

describe('leafWrite', () => {
  const row = (
    scope: ExplainRowWire['scope'],
    value: unknown
  ): ExplainRowWire => ({
    scope,
    file: `${scope}.jsonc`,
    present: true,
    value,
  });

  test('starts from the target layer, never the default', () => {
    const rows = [
      row('default', { channel: 'd', multiHeader: 'h' }),
      row('team', { channel: 't' }),
    ];
    expect(leafWrite(rows, 'team', 'multiItem', 'i')).toEqual({
      channel: 't',
      multiItem: 'i',
    });
  });

  test('prunes an object a removed leaf left empty', () => {
    const rows = [row('team', { emoji: { looking: 'x' } })];
    expect(leafWrite(rows, 'team', 'emoji.looking', undefined)).toEqual({});
  });
});
