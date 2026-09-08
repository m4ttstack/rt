import { describe, expect, test } from 'bun:test';

import type { TabConfig } from '../config.ts';
import type { BoardMR } from '../data.ts';
import {
  behindToken,
  commentDot,
  dataAgeLabel,
  DEFAULT_VIEW,
  filterByMember,
  filterBySlack,
  filterByTab,
  groupMRs,
  joinRowState,
  memberPeerState,
  nestStacks,
  parseViewState,
  rosterUsernamesFor,
  serializeViewState,
  sortMRs,
  statusFlags,
} from '../view.ts';

function mr(overrides: Partial<BoardMR>): BoardMR {
  return {
    iid: 1,
    title: 'MR',
    author: { id: 'x', username: 'alice', name: 'Alice', avatarUrl: null },
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-01T00:00:00Z',
    pipelineState: 'none',
    unresolvedThreads: 0,
    reviewerComments: 0,
    reviews: { required: 2, given: 0, isApproved: false },
    blockers: {},
    ...overrides,
  } as unknown as BoardMR;
}

describe('filterBySlack', () => {
  const posted = mr({
    iid: 1,
    slack: { status: 'found', reactions: [], posted: true },
  } as any);
  const foundNoReply = mr({
    iid: 2,
    slack: { status: 'found', reactions: [], posted: false },
  } as any);
  const notFound = mr({
    iid: 3,
    slack: { status: 'notfound', reactions: [], posted: false },
  } as any);
  const unresolved = mr({ iid: 4 });
  const list = [posted, foundNoReply, notFound, unresolved];
  test('all returns everything', () => {
    expect(filterBySlack(list, 'all')).toHaveLength(4);
  });
  test('posted keeps only rows the posted-in-slack chip would mark', () => {
    expect(filterBySlack(list, 'posted').map(m => m.iid)).toEqual([1]);
  });
});

describe('filterByMember', () => {
  const list = [
    mr({ iid: 1, author: { username: 'alice' } as any }),
    mr({ iid: 2, author: { username: 'bob' } as any }),
  ];
  test('all returns everything', () => {
    expect(filterByMember(list, 'all')).toHaveLength(2);
  });
  test('filters to one member', () => {
    expect(filterByMember(list, 'bob').map(m => m.iid)).toEqual([2]);
  });
});

describe('rosterUsernamesFor', () => {
  const configUsernames = ['ada', 'grace'];
  const rows = [
    mr({
      iid: 1,
      author: { username: 'ada' } as any,
      codeownerSections: ['Acme'],
    } as any),
    mr({
      iid: 2,
      author: { username: 'outsider' } as any,
      codeownerSections: ['Acme'],
    } as any),
    mr({
      iid: 3,
      author: { username: 'drifter' } as any,
      codeownerSections: [],
    } as any),
  ];

  test('an authors tab answers with the configured roster', () => {
    const team: TabConfig = {
      id: 't',
      label: 'T',
      source: { kind: 'authors' },
    };
    expect([...rosterUsernamesFor(rows, team, configUsernames)].sort()).toEqual(
      ['ada', 'grace']
    );
  });

  test('a codeowners tab answers with the authors of the rows it shows', () => {
    const q: TabConfig = {
      id: 'q',
      label: 'Q',
      source: { kind: 'codeowners', section: 'Acme', excludeMembers: true },
    };
    const valid = rosterUsernamesFor(rows, q, configUsernames);
    expect([...valid]).toEqual(['outsider']); // the picked author survives re-validation
    expect(valid.has('ada')).toBe(false); // excludeMembers still applies
    expect(valid.has('drifter')).toBe(false); // untagged row is not on this tab
  });

  test('no tab falls back to the configured roster', () => {
    expect(
      [...rosterUsernamesFor(rows, undefined, configUsernames)].sort()
    ).toEqual(['ada', 'grace']);
  });

  /* Board resolves the first load in two passes for this reason: the member's
     valid set depends on which tab wins, so validating against the config
     roster alone drops a stored codeowners-tab author on every reload. */
  test('two-pass resolution keeps a stored codeowners-tab author across a reload', () => {
    const q: TabConfig = {
      id: 'q',
      label: 'Q',
      source: { kind: 'codeowners', section: 'Acme', excludeMembers: true },
    };
    const stored = { tab: 'q', member: 'outsider' };
    const tabIds = ['t', 'q'];

    // Single pass drops the stored author as "not on the team" and lands on
    // defaultMember, so a reload on the queue would silently filter to you.
    const onePass = parseViewState('', stored, configUsernames, 'ada', tabIds);
    expect(onePass.tab).toBe('q');
    expect(onePass.member).toBe('ada');

    const valid = [...rosterUsernamesFor(rows, q, configUsernames)];
    expect(parseViewState('', stored, valid, 'ada', tabIds).member).toBe(
      'outsider'
    );
  });
});

describe('filterByTab', () => {
  const members = new Set(['ada']);
  const rows = [
    mr({
      iid: 1,
      author: { username: 'ada' } as any,
      codeownerSections: ['Acme'],
    } as any),
    mr({
      iid: 2,
      author: { username: 'outsider' } as any,
      codeownerSections: ['Acme'],
    } as any),
    mr({
      iid: 3,
      author: { username: 'outsider' } as any,
      codeownerSections: [],
    } as any),
  ];

  test('authors tab excludes a tagged stranger, keeps roster rows', () => {
    const team: TabConfig = {
      id: 't',
      label: 'T',
      source: { kind: 'authors' },
    };
    expect(filterByTab(rows, team, members).map(m => m.iid)).toEqual([1]);
  });

  test('codeowners tab filters to the section and excludes roster authors', () => {
    const q: TabConfig = {
      id: 'q',
      label: 'Q',
      source: { kind: 'codeowners', section: 'Acme', excludeMembers: true },
    };
    expect(filterByTab(rows, q, members).map(m => m.iid)).toEqual([2]);
  });

  test('codeowners tab without excludeMembers keeps roster authors in the section', () => {
    const q: TabConfig = {
      id: 'q',
      label: 'Q',
      source: { kind: 'codeowners', section: 'Acme' },
    };
    expect(filterByTab(rows, q, members).map(m => m.iid)).toEqual([1, 2]);
  });

  test('codeowners tab drops rows outside the section regardless of authorship', () => {
    const q: TabConfig = {
      id: 'q',
      label: 'Q',
      source: { kind: 'codeowners', section: 'Acme', excludeMembers: true },
    };
    expect(filterByTab(rows, q, members).some(m => m.iid === 3)).toBe(false);
  });
});

describe('commentDot', () => {
  test('no summary → no dot (fetch skipped/failed)', () => {
    expect(commentDot(undefined)).toBeNull();
  });
  test('nothing unresolved → no dot', () => {
    expect(commentDot({ awaiting: 0, replied: 0, resolved: 3 })).toBeNull();
  });
  test('any thread awaiting the author → amber, action needed', () => {
    expect(commentDot({ awaiting: 1, replied: 0, resolved: 0 })).toEqual({
      cls: 'warn',
      title: '1 awaiting your reply',
    });
  });
  test('amber title lists both awaiting and replied counts', () => {
    expect(commentDot({ awaiting: 1, replied: 2, resolved: 0 })).toEqual({
      cls: 'warn',
      title: '1 awaiting your reply · 2 you replied to',
    });
  });
  test('all replied, none awaiting → green', () => {
    expect(commentDot({ awaiting: 0, replied: 2, resolved: 0 })).toEqual({
      cls: 'ok',
      title: "you've replied to every comment",
    });
  });
  test('resolved threads never force amber', () => {
    expect(commentDot({ awaiting: 0, replied: 1, resolved: 5 })?.cls).toBe(
      'ok'
    );
  });
});

describe('statusFlags', () => {
  test('statusFlags adds the stacked chip last for stacked MRs', () => {
    const flags = statusFlags(
      mr({
        isStacked: true,
        targetBranch: 'parent-branch',
        blockers: { hasConflicts: true },
      } as any)
    );
    expect(flags[flags.length - 1]).toEqual({
      text: 'stacked → parent-branch',
      cls: 't-cyan',
    });
    expect(flags[0]).toEqual({ text: 'conflicts', cls: 't-bad' });
  });

  test('statusFlags has no stacked chip for default-target MRs', () => {
    const flags = statusFlags(mr({ targetBranch: 'main' } as any));
    expect(flags.some(f => f.text.startsWith('stacked'))).toBe(false);
  });

  test('nested option drops the stacked chip but keeps the rest', () => {
    const flags = statusFlags(
      mr({
        isStacked: true,
        targetBranch: 'parent-branch',
        blockers: { hasConflicts: true },
      } as any),
      { nested: true }
    );
    expect(flags.some(f => f.text.startsWith('stacked'))).toBe(false);
    expect(flags[0]).toEqual({ text: 'conflicts', cls: 't-bad' });
  });

  test('armed auto-merge shows an ok flag, before the stacked chip', () => {
    const flags = statusFlags(
      mr({
        isStacked: true,
        targetBranch: 'parent-branch',
        autoMergeButton: { isActive: true },
      } as any)
    );
    expect(flags[0]).toEqual({ text: 'auto-merge', cls: 't-ok' });
    expect(flags.at(-1)?.text).toBe('stacked → parent-branch');
  });

  test('no auto-merge flag when it is not armed', () => {
    const flags = statusFlags(
      mr({ autoMergeButton: { isActive: false } } as any)
    );
    expect(flags.some(f => f.text === 'auto-merge')).toBe(false);
  });
});

describe('behindToken', () => {
  test('behind by N renders ↓N with a plural title', () => {
    expect(behindToken(mr({ behindTarget: 3 } as any))).toEqual({
      text: '↓3',
      title: '3 commits behind target',
    });
  });

  test('behind by one keeps the title singular', () => {
    expect(behindToken(mr({ behindTarget: 1 } as any))).toEqual({
      text: '↓1',
      title: '1 commit behind target',
    });
  });

  test('zero behind renders nothing', () => {
    expect(behindToken(mr({ behindTarget: 0 } as any))).toBeNull();
  });

  test('null is unknown, not zero — renders nothing', () => {
    expect(behindToken(mr({ behindTarget: null } as any))).toBeNull();
  });
});

describe('nestStacks', () => {
  const url = (iid: number, project = 'acme/webapp') =>
    `https://gitlab.com/${project}/-/merge_requests/${iid}`;
  const smr = (
    iid: number,
    source: string,
    target: string,
    opts: { project?: string; stacked?: boolean } = {}
  ) =>
    mr({
      iid,
      webUrl: url(iid, opts.project),
      sourceBranch: source,
      targetBranch: target,
      isStacked: opts.stacked ?? target !== 'master',
    } as any);

  test('child nests under its parent; root keeps its position', () => {
    const parent = smr(1, 'feat-a', 'master');
    const child = smr(2, 'feat-b', 'feat-a');
    const other = smr(3, 'feat-c', 'master');
    const nodes = nestStacks([other, parent, child]);
    expect(nodes.map(n => n.mr.iid)).toEqual([3, 1]);
    expect(nodes[1]!.children.map(n => n.mr.iid)).toEqual([2]);
  });

  test('three-layer chain nests recursively', () => {
    const nodes = nestStacks([
      smr(1, 'l1', 'master'),
      smr(2, 'l2', 'l1'),
      smr(3, 'l3', 'l2'),
    ]);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.children[0]!.mr.iid).toBe(2);
    expect(nodes[0]!.children[0]!.children[0]!.mr.iid).toBe(3);
  });

  test('siblings under one parent keep input order', () => {
    const nodes = nestStacks([
      smr(1, 'l1', 'master'),
      smr(3, 'l2b', 'l1'),
      smr(2, 'l2a', 'l1'),
    ]);
    expect(nodes[0]!.children.map(n => n.mr.iid)).toEqual([3, 2]);
  });

  test('missing parent leaves the child top-level', () => {
    const nodes = nestStacks([smr(2, 'feat-b', 'feat-a')]);
    expect(nodes.map(n => n.mr.iid)).toEqual([2]);
    expect(nodes[0]!.children).toEqual([]);
  });

  test('same branch name in another project never links', () => {
    const parent = smr(1, 'feat-a', 'master', { project: 'other/repo' });
    const child = smr(2, 'feat-b', 'feat-a');
    const nodes = nestStacks([parent, child]);
    expect(nodes.map(n => n.mr.iid)).toEqual([1, 2]);
  });

  test('non-stacked MR never attaches even when branches line up', () => {
    const parent = smr(1, 'feat-a', 'master');
    const child = smr(2, 'feat-b', 'feat-a', { stacked: false });
    const nodes = nestStacks([parent, child]);
    expect(nodes.map(n => n.mr.iid)).toEqual([1, 2]);
  });

  test('a branch cycle renders flat instead of dropping MRs', () => {
    const a = smr(1, 'feat-a', 'feat-b', { stacked: true });
    const b = smr(2, 'feat-b', 'feat-a', { stacked: true });
    const nodes = nestStacks([a, b]);
    expect(nodes.map(n => n.mr.iid).sort()).toEqual([1, 2]);
  });

  test('MR without a webUrl stays top-level and breaks no one', () => {
    const parent = smr(1, 'feat-a', 'master');
    const orphan = mr({
      iid: 2,
      webUrl: undefined,
      sourceBranch: 'feat-b',
      targetBranch: 'feat-a',
      isStacked: true,
    } as any);
    const nodes = nestStacks([parent, orphan]);
    expect(nodes.map(n => n.mr.iid)).toEqual([1, 2]);
  });
});

test('dataAgeLabel: fresh, stale, unknown', () => {
  const now = Date.parse('2026-07-29T15:00:00Z');
  expect(dataAgeLabel(now - 60_000, now).stale).toBe(false);
  expect(dataAgeLabel(now - 11 * 60_000, now).stale).toBe(true);
  expect(dataAgeLabel(null, now)).toEqual({
    text: 'data age unknown',
    stale: true,
  });
});

test('dataAgeLabel: epoch-zero syncedAt (cold shell record) reads as unknown, not 1:00', () => {
  const now = Date.parse('2026-07-29T15:00:00Z');
  expect(dataAgeLabel(0, now)).toEqual({
    text: 'data age unknown',
    stale: true,
  });
});

describe('sortMRs', () => {
  test('oldest: oldest last activity (updatedAt) first, nulls last', () => {
    const list = [
      mr({ iid: 1, updatedAt: '2026-07-05T00:00:00Z' }),
      mr({ iid: 2, updatedAt: null }),
      mr({ iid: 3, updatedAt: '2026-07-01T00:00:00Z' }),
    ];
    expect(sortMRs(list, 'oldest').map(m => m.iid)).toEqual([3, 1, 2]);
  });

  test('progress: highest approval ratio first', () => {
    const list = [
      mr({
        iid: 1,
        reviews: { required: 2, given: 0, isApproved: false } as any,
      }),
      mr({
        iid: 2,
        reviews: { required: 2, given: 2, isApproved: true } as any,
      }),
      mr({
        iid: 3,
        reviews: { required: 2, given: 1, isApproved: false } as any,
      }),
    ];
    expect(sortMRs(list, 'progress').map(m => m.iid)).toEqual([2, 3, 1]);
  });

  test('does not mutate input', () => {
    const list = [
      mr({ iid: 1, createdAt: '2026-07-05T00:00:00Z' }),
      mr({ iid: 2, createdAt: '2026-07-01T00:00:00Z' }),
    ];
    sortMRs(list, 'oldest');
    expect(list.map(m => m.iid)).toEqual([1, 2]);
  });
});

const NOW = Date.parse('2026-07-13T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

describe('groupMRs stack cohesion', () => {
  const url = (iid: number, project = 'acme/webapp') =>
    `https://gitlab.com/${project}/-/merge_requests/${iid}`;
  const smr = (
    iid: number,
    source: string,
    target: string,
    extra: Record<string, unknown> = {}
  ) =>
    mr({
      iid,
      webUrl: url(iid),
      sourceBranch: source,
      targetBranch: target,
      isStacked: target !== 'master',
      ...extra,
    } as any);

  test("a child in another age bucket follows its parent's group", () => {
    const parent = smr(1, 'feat-a', 'master', { updatedAt: daysAgo(0) });
    const child = smr(2, 'feat-b', 'feat-a', { updatedAt: daysAgo(9) });
    const groups = groupMRs([parent, child], 'age', [], NOW);
    expect(groups.map(g => g.label)).toEqual(['Today']);
    expect(groups[0]!.mrs.map(m => m.iid).sort()).toEqual([1, 2]);
  });

  test("a whole chain lands in the root's group, however deep", () => {
    const list = [
      smr(1, 'l1', 'master', { updatedAt: daysAgo(30) }),
      smr(2, 'l2', 'l1', { updatedAt: daysAgo(0) }),
      smr(3, 'l3', 'l2', { updatedAt: daysAgo(1) }),
    ];
    const groups = groupMRs(list, 'age', [], NOW);
    expect(groups.map(g => g.label)).toEqual(['Older']);
    expect(groups[0]!.mrs.map(m => m.iid).sort()).toEqual([1, 2, 3]);
  });

  test('a child follows its parent across status buckets too', () => {
    const parent = smr(1, 'feat-a', 'master', {
      reviews: { given: 1, required: 1, isApproved: true },
    });
    const child = smr(2, 'feat-b', 'feat-a', {
      blockers: { hasConflicts: true },
    });
    const groups = groupMRs([parent, child], 'status', [], NOW);
    expect(groups.map(g => g.label)).toEqual(['approved']);
    expect(groups[0]!.mrs.map(m => m.iid).sort()).toEqual([1, 2]);
  });

  test("a cross-author stack renders under the root author's group", () => {
    const parent = smr(1, 'feat-a', 'master', {
      author: { username: 'alice', name: 'Alice' },
    });
    const child = smr(2, 'feat-b', 'feat-a', {
      author: { username: 'bob', name: 'Bob' },
    });
    const groups = groupMRs([parent, child], 'author', ['alice', 'bob'], NOW);
    expect(groups.map(g => g.label)).toEqual(['Alice']);
    expect(groups[0]!.mrs.map(m => m.iid).sort()).toEqual([1, 2]);
  });

  test('an orphaned child (parent out of view) stays in its own group', () => {
    const child = smr(2, 'feat-b', 'feat-a', { updatedAt: daysAgo(9) });
    const other = smr(3, 'feat-c', 'master', { updatedAt: daysAgo(0) });
    const groups = groupMRs([child, other], 'age', [], NOW);
    expect(groups.map(g => g.label)).toEqual(['Today', 'Last week']);
  });

  test('a branch cycle never collapses or drops its members', () => {
    const a = smr(1, 'feat-a', 'feat-b', { updatedAt: daysAgo(0) });
    const b = smr(2, 'feat-b', 'feat-a', { updatedAt: daysAgo(9) });
    const groups = groupMRs([a, b], 'age', [], NOW);
    expect(groups.map(g => g.label)).toEqual(['Today', 'Last week']);
    expect(
      groups
        .flatMap(g => g.mrs)
        .map(m => m.iid)
        .sort()
    ).toEqual([1, 2]);
  });
});

describe('groupMRs age', () => {
  test('buckets by last activity (updatedAt), by day then week, ordered', () => {
    const list = [
      mr({ iid: 1, updatedAt: daysAgo(0) }),
      mr({ iid: 2, updatedAt: daysAgo(1) }),
      mr({ iid: 3, updatedAt: daysAgo(3) }),
      mr({ iid: 4, updatedAt: daysAgo(9) }),
      mr({ iid: 5, updatedAt: daysAgo(30) }),
    ];
    const groups = groupMRs(list, 'age', [], NOW);
    expect(groups.map(g => g.label)).toEqual([
      'Today',
      'Yesterday',
      '3 days ago',
      'Last week',
      'Older',
    ]);
  });
});

describe('groupMRs author', () => {
  test('one group per member in config order, skips empty', () => {
    const list = [
      mr({ iid: 1, author: { username: 'bob', name: 'Bob' } as any }),
      mr({ iid: 2, author: { username: 'alice', name: 'Alice' } as any }),
    ];
    const groups = groupMRs(list, 'author', ['alice', 'bob', 'carol'], NOW);
    expect(groups.map(g => g.label)).toEqual(['Alice', 'Bob']);
  });
});

describe('groupMRs status', () => {
  test('mechanical blockers (conflicts/ci) do not form their own groups; MRs bucket by review state', () => {
    const list = [
      // conflicts but no review yet -> needs review, not a "conflicts" group
      mr({
        iid: 1,
        blockers: { hasConflicts: true } as any,
        reviews: { required: 2, given: 0, isApproved: false } as any,
      }),
      // ci failing but approved -> still approved
      mr({
        iid: 2,
        blockers: { pipelineFailing: true } as any,
        reviews: { required: 2, given: 2, isApproved: true } as any,
      }),
    ];
    const groups = groupMRs(list, 'status', [], NOW);
    expect(groups.map(g => g.label)).toEqual(['needs review', 'approved']);
  });

  test('partial approvals fold into needs review', () => {
    const list = [
      mr({
        iid: 1,
        blockers: {} as any,
        reviews: { required: 2, given: 1, isApproved: false } as any,
      }),
    ];
    const groups = groupMRs(list, 'status', [], NOW);
    expect(groups.map(g => g.label)).toEqual(['needs review']);
  });

  test('commented: unresolved comments, no formal review, not approved', () => {
    const list = [
      mr({
        iid: 1,
        reviewerComments: 3,
        reviews: { required: 2, given: 0, isApproved: false } as any,
      }),
    ];
    const groups = groupMRs(list, 'status', [], NOW);
    expect(groups.map(g => g.label)).toEqual(['commented']);
  });

  test("changes requested: a reviewer's REQUESTED_CHANGES state buckets separately from comments", () => {
    const list = [
      mr({
        iid: 1,
        reviewerComments: 3,
        reviews: {
          required: 2,
          given: 0,
          isApproved: false,
          reviewers: [{ reviewState: 'REQUESTED_CHANGES' }],
        } as any,
      }),
    ];
    const groups = groupMRs(list, 'status', [], NOW);
    expect(groups.map(g => g.label)).toEqual(['changes requested']);
  });

  test('approved outranks commented: approved MR with comments still buckets approved', () => {
    const list = [
      mr({
        iid: 1,
        reviewerComments: 3,
        reviews: { required: 2, given: 2, isApproved: true } as any,
      }),
    ];
    const groups = groupMRs(list, 'status', [], NOW);
    expect(groups.map(g => g.label)).toEqual(['approved']);
  });

  test("all comments resolved, not approved: 'comments resolved', not 'needs review'", () => {
    const list = [
      mr({
        iid: 1,
        reviewerComments: 0,
        threadSummary: { awaiting: 0, replied: 0, resolved: 3 },
        reviews: { required: 2, given: 0, isApproved: false } as any,
      }),
    ];
    const groups = groupMRs(list, 'status', [], NOW);
    expect(groups.map(g => g.label)).toEqual(['comments resolved']);
  });

  test("no thread breakdown (never commented) stays 'needs review'", () => {
    const list = [
      mr({
        iid: 1,
        reviewerComments: 0,
        reviews: { required: 2, given: 0, isApproved: false } as any,
      }),
    ];
    const groups = groupMRs(list, 'status', [], NOW);
    expect(groups.map(g => g.label)).toEqual(['needs review']);
  });

  test("still some unresolved: stays 'commented', not 'comments resolved'", () => {
    const list = [
      mr({
        iid: 1,
        reviewerComments: 2,
        threadSummary: { awaiting: 1, replied: 1, resolved: 4 },
        reviews: { required: 2, given: 0, isApproved: false } as any,
      }),
    ];
    const groups = groupMRs(list, 'status', [], NOW);
    expect(groups.map(g => g.label)).toEqual(['commented']);
  });

  test('approved outranks all-resolved: approved MR with resolved threads buckets approved', () => {
    const list = [
      mr({
        iid: 1,
        reviewerComments: 0,
        threadSummary: { awaiting: 0, replied: 0, resolved: 2 },
        reviews: { required: 2, given: 2, isApproved: true } as any,
      }),
    ];
    const groups = groupMRs(list, 'status', [], NOW);
    expect(groups.map(g => g.label)).toEqual(['approved']);
  });

  test('review-state order: changes requested, commented, needs review, comments resolved, approved', () => {
    const list = [
      mr({
        iid: 1,
        blockers: {} as any,
        reviews: { required: 2, given: 2, isApproved: true } as any,
      }), // approved
      mr({
        iid: 2,
        reviewerComments: 2,
        blockers: {} as any,
        reviews: { required: 2, given: 0, isApproved: false } as any,
      }), // commented
      mr({
        iid: 3,
        blockers: {} as any,
        reviews: { required: 2, given: 0, isApproved: false } as any,
      }), // needs review
      mr({
        iid: 5,
        reviewerComments: 0,
        threadSummary: { awaiting: 0, replied: 0, resolved: 1 },
        blockers: {} as any,
        reviews: { required: 2, given: 0, isApproved: false } as any,
      }), // comments resolved
      mr({
        iid: 4,
        blockers: {} as any,
        reviews: {
          required: 2,
          given: 0,
          isApproved: false,
          reviewers: [{ reviewState: 'REQUESTED_CHANGES' }],
        } as any,
      }), // changes requested
    ];
    const groups = groupMRs(list, 'status', [], NOW);
    expect(groups.map(g => g.label)).toEqual([
      'changes requested',
      'commented',
      'needs review',
      'comments resolved',
      'approved',
    ]);
  });
});

describe('groupMRs review', () => {
  const reviewed = (iid: number, status?: string) =>
    mr({ iid, ...(status ? { review: { status } } : {}) } as any);

  test("buckets by app-initiated review status, most-active first; unlaunched fall to 'not reviewed'", () => {
    const list = [
      reviewed(1, 'done'),
      reviewed(2),
      reviewed(3, 'reviewing'),
      reviewed(4, 'error'),
      reviewed(5, 'queued'),
    ];
    const groups = groupMRs(list, 'review', [], NOW);
    expect(groups.map(g => g.label)).toEqual([
      'reviewing',
      'queued',
      'review ready',
      'review failed',
      'not reviewed',
    ]);
  });

  test('collapses MRs sharing a status into one group', () => {
    const list = [reviewed(1, 'done'), reviewed(2, 'done'), reviewed(3)];
    const groups = groupMRs(list, 'review', [], NOW);
    expect(groups.map(g => [g.label, g.mrs.length])).toEqual([
      ['review ready', 2],
      ['not reviewed', 1],
    ]);
  });
});

describe('parseViewState', () => {
  const members = ['alice', 'bob'];
  test('defaults when nothing provided', () => {
    expect(parseViewState('', null, members)).toEqual(DEFAULT_VIEW);
  });
  test('URL wins over localStorage', () => {
    expect(
      parseViewState(
        '?member=bob&group=status',
        { member: 'alice', sort: 'progress' },
        members
      )
    ).toEqual({
      member: 'bob',
      group: 'status',
      sort: 'progress',
      tab: '',
      slack: 'all',
    });
  });
  test('ignores unknown member and invalid group/sort', () => {
    expect(
      parseViewState('?member=ghost&group=bogus&sort=bogus', null, members)
    ).toEqual(DEFAULT_VIEW);
  });

  test('uses defaultMember when no URL or stored value', () => {
    expect(parseViewState('', null, members, 'bob').member).toBe('bob');
  });

  test('falls back to all when defaultMember is not in the valid set', () => {
    expect(parseViewState('', null, members, 'ghost').member).toBe('all');
  });

  test('URL still wins over defaultMember', () => {
    expect(parseViewState('?member=alice', null, members, 'bob').member).toBe(
      'alice'
    );
  });

  test('stored value still wins over defaultMember', () => {
    expect(parseViewState('', { member: 'alice' }, members, 'bob').member).toBe(
      'alice'
    );
  });

  test('no validTabs known yet resolves tab to empty, matching DEFAULT_VIEW', () => {
    expect(parseViewState('?tab=q', null, members).tab).toBe('');
  });

  test('a known tab id from the URL wins', () => {
    expect(parseViewState('?tab=q', null, members, 'all', ['t', 'q']).tab).toBe(
      'q'
    );
  });

  test('an unknown tab id falls back to the first configured tab', () => {
    expect(
      parseViewState('?tab=zzz', null, members, 'all', ['t', 'q']).tab
    ).toBe('t');
  });

  test('no tab in the URL falls back to the first configured tab', () => {
    expect(parseViewState('', null, members, 'all', ['t', 'q']).tab).toBe('t');
  });

  test('slack filter defaults to all', () => {
    expect(parseViewState('', null, members).slack).toBe('all');
  });

  test('slack=posted from the URL', () => {
    expect(parseViewState('?slack=posted', null, members).slack).toBe('posted');
  });

  test('stored slack filter is honoured', () => {
    expect(parseViewState('', { slack: 'posted' }, members).slack).toBe(
      'posted'
    );
  });

  test('an unknown slack filter value falls back to all', () => {
    expect(parseViewState('?slack=bogus', null, members).slack).toBe('all');
  });
});

describe('serializeViewState', () => {
  test('omits defaults', () => {
    expect(serializeViewState(DEFAULT_VIEW)).toBe('');
  });
  test('includes non-defaults', () => {
    expect(
      serializeViewState({
        member: 'bob',
        group: 'status',
        sort: 'oldest',
        tab: '',
        slack: 'all',
      })
    ).toBe('?member=bob&group=status');
  });
  test('includes a set tab, even a first-tab id', () => {
    expect(
      serializeViewState({
        member: 'all',
        group: 'age',
        sort: 'oldest',
        tab: 'team',
        slack: 'all',
      })
    ).toBe('?tab=team');
  });
  test('includes the slack filter when it is on', () => {
    expect(serializeViewState({ ...DEFAULT_VIEW, slack: 'posted' })).toBe(
      '?slack=posted'
    );
  });
});

describe('memberPeerState', () => {
  test('peered when listed, invitable when not, unknown before load', () => {
    expect(memberPeerState('grace', ['grace', 'bob'])).toBe('peered');
    expect(memberPeerState('dana', ['grace'])).toBe('invitable');
    expect(memberPeerState('dana', null)).toBe('unknown');
  });
  test('comparison is canonical: case and padding do not hide a peer', () => {
    expect(memberPeerState('Grace ', ['grace'])).toBe('peered');
  });
});

describe('joinRowState', () => {
  test('unconfigured board: open join row', () => {
    expect(joinRowState(false, null)).toEqual({
      label: 'join peer boards',
      collapsed: false,
    });
  });
  test('configured + healthy: collapsed re-join affordance', () => {
    expect(joinRowState(true, 'ok')).toEqual({
      label: 're-join with a new invite',
      collapsed: true,
    });
  });
  test('token rejected: expanded with warning copy', () => {
    const s = joinRowState(true, 'unauthorized');
    expect(s.collapsed).toBe(false);
    expect(s.warning).toContain('re-join');
  });
});
