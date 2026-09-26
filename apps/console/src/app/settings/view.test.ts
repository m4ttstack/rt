import type {
  ExplainRowWire,
  SettingDefWire,
} from '@mattstack/settings-kit/react';
import { describe, expect, it } from 'vitest';

import {
  applyFilter,
  badgeScope,
  buildSections,
  fieldSource,
  firstSentence,
  leafWrite,
  NO_FILTER,
  sourceText,
  splitKey,
} from './view';

function def(key: string, over: Partial<SettingDefWire> = {}): SettingDefWire {
  return {
    key,
    type: 'string',
    scopes: ['user'],
    merge: 'replace',
    secret: false,
    teamLocked: false,
    repoScoped: false,
    writable: true,
    description: `${key} does a thing. More detail.`,
    hasDefault: false,
    defaultValue: null,
    effective: { scope: null, file: null },
    ...over,
  };
}

const row = (
  scope: string,
  value?: unknown,
  extra: Partial<ExplainRowWire> = {}
): ExplainRowWire =>
  ({
    scope,
    file: null,
    present: value !== undefined,
    ...(value !== undefined ? { value } : {}),
    ...extra,
  }) as ExplainRowWire;

describe('applyFilter', () => {
  const defs = [
    def('rt.logLevel', {
      effective: { scope: 'default', file: null, value: 'info' },
    }),
    def('rt.runsPruneDays', {
      type: 'number',
      effective: { scope: 'machine', file: '/m', value: 7 },
    }),
    def('rt.cron', { type: 'object', writable: false }),
  ];
  it('filters on key and description', () => {
    expect(
      applyFilter(defs, { ...NO_FILTER, query: 'prune' }).map(d => d.key)
    ).toEqual(['rt.runsPruneDays']);
  });
  it('changed keeps only store-set keys', () => {
    expect(
      applyFilter(defs, { ...NO_FILTER, changedOnly: true }).map(d => d.key)
    ).toEqual(['rt.runsPruneDays']);
  });
  it('editable drops read-only rows', () => {
    expect(
      applyFilter(defs, { ...NO_FILTER, editableOnly: true }).map(d => d.key)
    ).toEqual(['rt.logLevel', 'rt.runsPruneDays']);
  });
  it('scope keeps keys whose winning layer is that scope', () => {
    expect(
      applyFilter(defs, { ...NO_FILTER, scope: 'machine' }).map(d => d.key)
    ).toEqual(['rt.runsPruneDays']);
  });
});

describe('buildSections', () => {
  it('orders sections by GROUPS and counts total and shown', () => {
    const s = buildSections(
      [def('board.title'), def('agent.provider'), def('rt.logLevel')],
      { ...NO_FILTER, query: 'title' }
    );
    expect(s.map(x => x.group.id)).toEqual(['agents', 'daemon', 'board']);
    expect(s.map(x => [x.total, x.shown])).toEqual([
      [1, 0],
      [1, 0],
      [1, 1],
    ]);
  });

  it('splits a section over the threshold into team, user, machine subsections', () => {
    const boards = [
      ...Array.from({ length: 6 }, (_, i) =>
        def(`board.t${i}`, { scopes: ['team'] })
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        def(`board.u${i}`, { scopes: ['user', 'machine'] })
      ),
      ...Array.from({ length: 2 }, (_, i) =>
        def(`board.m${i}`, { scopes: ['machine'] })
      ),
    ];
    const [board] = buildSections(boards, NO_FILTER);
    expect(board!.subsections.map(x => [x.scope, x.defs.length])).toEqual([
      ['team', 6],
      ['user', 5],
      ['machine', 2],
    ]);
  });

  it('orders rows selects, numbers, text, switches, then composites', () => {
    const [daemon] = buildSections(
      [
        def('rt.homeSnapshot', { type: 'object' }),
        def('rt.runsPruneDays', { type: 'number' }),
        def('rt.daemonPath'),
        def('rt.logVerbose', { type: 'boolean' }),
        def('rt.logLevel'),
        def('rt.apiPort', { type: 'number' }),
      ],
      NO_FILTER
    );
    expect(daemon!.subsections[0]!.defs.map(d => d.key)).toEqual([
      'rt.logLevel',
      'rt.runsPruneDays',
      'rt.apiPort',
      'rt.daemonPath',
      'rt.logVerbose',
      'rt.homeSnapshot',
    ]);
  });

  it('keeps a small section as one unlabelled subsection', () => {
    const [agents] = buildSections([def('agent.provider')], NO_FILTER);
    expect(agents!.subsections).toEqual([
      {
        scope: null,
        defs: [expect.objectContaining({ key: 'agent.provider' })],
      },
    ]);
  });
});

describe('row labels', () => {
  it('badgeScope shows a store layer unless it repeats the subhead', () => {
    const m = def('k', { effective: { scope: 'machine', file: '/m' } });
    expect(badgeScope(m, null)).toBe('machine');
    expect(badgeScope(m, 'user')).toBe('machine');
    expect(badgeScope(m, 'machine')).toBeNull();
    expect(
      badgeScope(
        def('k', { effective: { scope: 'default', file: null } }),
        null
      )
    ).toBeNull();
  });

  it('sourceText names default and unset only', () => {
    expect(
      sourceText(def('k', { effective: { scope: 'default', file: null } }))
    ).toBe('default');
    expect(sourceText(def('k'))).toBe('unset');
    expect(
      sourceText(def('k', { effective: { scope: 'user', file: '/u' } }))
    ).toBeNull();
  });

  it('firstSentence stops at the first sentence end, not at e.g.', () => {
    expect(
      firstSentence(
        'Ticket prefixes (e.g. RT, MAT) that scope the tab. Also links.'
      )
    ).toBe('Ticket prefixes (e.g. RT, MAT) that scope the tab.');
    expect(firstSentence('No full stop here')).toBe('No full stop here');
  });

  it('splitKey separates the namespace from the last segment', () => {
    expect(splitKey('agent.claude.model')).toEqual(['agent.claude.', 'model']);
    expect(splitKey('solo')).toEqual(['', 'solo']);
  });
});

describe('leaf provenance and writes', () => {
  const rows = [
    row('default', { enabled: true, debounceSec: 20 }),
    row('team'),
    row('user', { debounceSec: 30 }),
    row('machine', { enabled: false }),
  ];

  it('fieldSource is the strongest layer that sets the field', () => {
    expect(fieldSource(rows, 'enabled')).toBe('machine');
    expect(fieldSource(rows, 'debounceSec')).toBe('user');
    expect(fieldSource([row('default', { a: 1 })], 'a')).toBe('default');
    expect(fieldSource(rows, 'missing')).toBeNull();
  });

  it('leafWrite edits the target layer’s own object, never the merge', () => {
    expect(leafWrite(rows, 'machine', 'debounceSec', 45)).toEqual({
      enabled: false,
      debounceSec: 45,
    });
    expect(leafWrite(rows, 'team', 'enabled', true)).toEqual({ enabled: true });
  });
});
