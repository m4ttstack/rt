import { describe, expect, test } from 'bun:test';

import {
  gateDeepLinkAction,
  gateParam,
  linkedGroupLabel,
  mrForGate,
  mrParam,
  stripDeepLinkParams,
  viewStateForMr,
} from '../client/board/deep-link.ts';
import type { TabConfig } from '../config.ts';
import type { BoardMR } from '../data.ts';
import { DEFAULT_VIEW } from '../view.ts';

type GateLinkMR = BoardMR & { slack?: { posted?: boolean } | null };

function mr(overrides: Partial<GateLinkMR>): GateLinkMR {
  return {
    iid: 1,
    title: 'MR',
    author: { id: 'x', username: 'bob', name: 'Bob', avatarUrl: null },
    codeownerSections: [],
    ...overrides,
  } as unknown as GateLinkMR;
}

describe('gateParam', () => {
  test('reads gate from a query string', () => {
    expect(gateParam('?gate=abc123')).toBe('abc123');
  });

  test('reads gate alongside other params', () => {
    expect(gateParam('?member=alice&gate=abc123&tab=mine')).toBe('abc123');
  });

  test('returns null when gate is absent', () => {
    expect(gateParam('?member=alice')).toBeNull();
  });

  test('returns null for an empty search string', () => {
    expect(gateParam('')).toBeNull();
  });

  test('returns null when gate is present but empty', () => {
    expect(gateParam('?gate=')).toBeNull();
  });
});

describe('mrParam', () => {
  const MR_URL = 'https://gitlab.example.com/acme/webapp/-/merge_requests/45';

  test('reads an encoded MR url back as the plain url', () => {
    expect(mrParam(`?mr=${encodeURIComponent(MR_URL)}`)).toBe(MR_URL);
  });

  test('reads mr alongside other params', () => {
    expect(
      mrParam(`?member=alice&mr=${encodeURIComponent(MR_URL)}&tab=mine`)
    ).toBe(MR_URL);
  });

  test('returns null when mr is absent', () => {
    expect(mrParam('?gate=abc123')).toBeNull();
  });

  test('returns null when mr is present but empty', () => {
    expect(mrParam('?mr=')).toBeNull();
  });
});

describe('mrForGate', () => {
  const mrs = [
    { iid: 1, gates: [{ gateId: 'g1' }] },
    { iid: 2, gates: [{ gateId: 'g2' }, { gateId: 'g3' }] },
    { iid: 3 },
  ];

  test('finds the iid whose gates carry the id', () => {
    expect(mrForGate(mrs, 'g1')).toBe(1);
  });

  test('finds the iid among multiple gates on one row', () => {
    expect(mrForGate(mrs, 'g3')).toBe(2);
  });

  test('returns null when no row carries the gate', () => {
    expect(mrForGate(mrs, 'missing')).toBeNull();
  });

  test('returns null when a row has no gates array at all', () => {
    expect(mrForGate(mrs, 'g4')).toBeNull();
  });
});

describe('viewStateForMr', () => {
  const teamTab: TabConfig = {
    id: 'team',
    label: 'Team',
    source: { kind: 'authors' },
  };
  const designTab: TabConfig = {
    id: 'design',
    label: 'Design',
    source: { kind: 'codeowners', section: 'design' },
  };
  const byIid = (iid: number) => (m: GateLinkMR) => m.iid === iid;

  test('widens member to all when the current pick hides the row', () => {
    const mrs = [
      mr({
        iid: 1,
        author: { id: 'a', username: 'alice', name: 'Alice', avatarUrl: null },
      }),
      mr({
        iid: 2,
        author: { id: 'b', username: 'bob', name: 'Bob', avatarUrl: null },
      }),
    ];
    const state = { ...DEFAULT_VIEW, tab: 'team', member: 'alice' };
    const result = viewStateForMr(
      state,
      mrs,
      [teamTab],
      new Set(['alice', 'bob']),
      byIid(2)
    );
    expect(result.member).toBe('all');
    expect(result.tab).toBe('team');
  });

  test('switches to the first tab whose filter carries the linked row', () => {
    const mrs = [
      mr({
        iid: 3,
        author: { id: 'c', username: 'carol', name: 'Carol', avatarUrl: null },
        codeownerSections: ['design'],
      }),
    ];
    // carol isn't on the roster, so the authors tab hides her row entirely.
    const state = { ...DEFAULT_VIEW, tab: 'team' };
    const result = viewStateForMr(
      state,
      mrs,
      [teamTab, designTab],
      new Set(['alice', 'bob']),
      byIid(3)
    );
    expect(result.tab).toBe('design');
  });

  test('leaves the tab alone when the current one already shows the row', () => {
    const mrs = [
      mr({
        iid: 4,
        author: { id: 'b', username: 'bob', name: 'Bob', avatarUrl: null },
      }),
    ];
    const state = { ...DEFAULT_VIEW, tab: 'team' };
    const result = viewStateForMr(
      state,
      mrs,
      [teamTab, designTab],
      new Set(['bob']),
      byIid(4)
    );
    expect(result.tab).toBe('team');
  });

  test('clears a posted-only slack filter that would hide the row', () => {
    const mrs = [mr({ iid: 5, slack: { posted: false } })];
    const state = { ...DEFAULT_VIEW, tab: 'team', slack: 'posted' as const };
    const result = viewStateForMr(
      state,
      mrs,
      [teamTab],
      new Set(['bob']),
      byIid(5)
    );
    expect(result.slack).toBe('all');
  });

  test('clears a drafts-hide filter that would hide the row', () => {
    const mrs = [mr({ iid: 5, isDraft: true } as Partial<GateLinkMR>)];
    const state = { ...DEFAULT_VIEW, tab: 'team', drafts: 'hide' as const };
    const result = viewStateForMr(
      state,
      mrs,
      [teamTab],
      new Set(['bob']),
      byIid(5)
    );
    expect(result.drafts).toBe('all');
  });

  test('returns state unchanged when no row matches', () => {
    const mrs = [mr({ iid: 6 })];
    const state = { ...DEFAULT_VIEW, tab: 'team', member: 'bob' };
    const result = viewStateForMr(
      state,
      mrs,
      [teamTab],
      new Set(['bob']),
      byIid(999)
    );
    expect(result).toEqual(state);
  });

  test('a url match lands on its own repo when another repo shares the iid', () => {
    const REPO_A = 'https://gitlab.example.com/acme/webapp/-/merge_requests/7';
    const REPO_B = 'https://gitlab.example.com/acme/design/-/merge_requests/7';
    const mrs = [
      mr({
        iid: 7,
        webUrl: REPO_A,
        author: { id: 'b', username: 'bob', name: 'Bob', avatarUrl: null },
      } as Partial<GateLinkMR>),
      mr({
        iid: 7,
        webUrl: REPO_B,
        author: { id: 'c', username: 'carol', name: 'Carol', avatarUrl: null },
        codeownerSections: ['design'],
      } as Partial<GateLinkMR>),
    ];
    const state = { ...DEFAULT_VIEW, tab: 'team' };
    const result = viewStateForMr(
      state,
      mrs,
      [teamTab, designTab],
      new Set(['bob']),
      m => m.webUrl === REPO_B
    );
    expect(result.tab).toBe('design');
  });
});

describe('linkedGroupLabel', () => {
  const groups = [
    {
      label: 'today',
      mrs: [mr({ iid: 1, webUrl: 'https://h/a/-/merge_requests/1' })],
    },
    {
      label: 'this week',
      mrs: [
        mr({ iid: 2, webUrl: 'https://h/a/-/merge_requests/2' }),
        mr({ iid: 1, webUrl: 'https://h/b/-/merge_requests/1' }),
      ],
    },
  ];

  test('finds the group holding the linked url', () => {
    expect(
      linkedGroupLabel(groups, {
        iid: null,
        mrUrl: 'https://h/b/-/merge_requests/1',
      })
    ).toBe('this week');
  });

  test('finds the first group holding the linked iid', () => {
    expect(linkedGroupLabel(groups, { iid: 1, mrUrl: null })).toBe('today');
  });

  test('returns null when no group holds the link', () => {
    expect(
      linkedGroupLabel(groups, {
        iid: null,
        mrUrl: 'https://h/c/-/merge_requests/9',
      })
    ).toBeNull();
    expect(linkedGroupLabel(groups, { iid: 7, mrUrl: null })).toBeNull();
  });

  test('returns null for a link with no row to land on', () => {
    expect(linkedGroupLabel(groups, { iid: null, mrUrl: null })).toBeNull();
  });
});

describe('stripDeepLinkParams', () => {
  test('removes gate and leaves other params intact', () => {
    expect(stripDeepLinkParams('?member=alice&gate=abc123&tab=mine')).toBe(
      '?member=alice&tab=mine'
    );
  });

  test('removes mr and leaves other params intact', () => {
    expect(
      stripDeepLinkParams(
        `?member=alice&mr=${encodeURIComponent('https://x/-/merge_requests/1')}&tab=mine`
      )
    ).toBe('?member=alice&tab=mine');
  });

  test('returns empty string when a link param was the only one', () => {
    expect(stripDeepLinkParams('?gate=abc123')).toBe('');
    expect(stripDeepLinkParams('?mr=https%3A%2F%2Fx')).toBe('');
  });

  test('returns the search string unchanged when there is no link param', () => {
    expect(stripDeepLinkParams('?member=alice')).toBe('?member=alice');
  });

  test('returns empty string for an empty search string', () => {
    expect(stripDeepLinkParams('')).toBe('');
  });
});

describe('gateDeepLinkAction', () => {
  const entries = [{ gate: { gateId: 'g1' } }, { gate: { gateId: 'g2' } }];

  test('a gate with a queue entry opens the modal', () => {
    expect(gateDeepLinkAction(entries, 'g1')).toBe('modal');
  });

  test('a gate without a queue entry falls back to the row flash', () => {
    expect(gateDeepLinkAction(entries, 'answered-elsewhere')).toBe('flash');
  });

  test('an empty queue always falls back to the row flash', () => {
    expect(gateDeepLinkAction([], 'g1')).toBe('flash');
  });
});
