import { describe, expect, test } from 'bun:test';

import type { MRDetail } from '@mattstack/glance';
import { armedLatchBody, spentLatchBody } from '../latch/markers.ts';
import type { LatchGateway } from '../latch/post.ts';
import type { ReviewState } from '../review-state.ts';
import { parseTriageBlock } from '../triage/config.ts';
import {
  runLatchPass,
  type LatchMrFacts,
  type LatchPassDeps,
} from '../triage/latch.ts';
import { emptyMrMemory, type DispatchMemory } from '../triage/memory.ts';

const NOW = 1_000_000_000;
const MR = 'https://gitlab.com/acme/web/-/merge_requests/2317';
const IMG = '![re-review latch](/uploads/ab12/latch-2317.png)';
const cfg = parseTriageBlock({
  enabled: true,
  cooldownMinutes: 30,
  dailyAttemptBudget: 3,
});

const facts: LatchMrFacts = {
  mrUrl: MR,
  iid: 2317,
  projectId: 42,
  projectPath: 'acme/web',
  rtRepo: 'acme-web',
  isApproved: false,
};
const commented: ReviewState = {
  mrUrl: MR,
  iid: 2317,
  status: 'done',
  outcome: 'comment',
  startedAt: 0,
  updatedAt: 0,
};

function disc(id: string, body: string, createdAt: string, resolved: boolean) {
  return {
    id,
    resolvable: true,
    resolved,
    notes: [
      {
        id: 1,
        body,
        author: { id: 1, username: 'matt', name: 'Matt', avatarUrl: null },
        createdAt,
        system: false,
        type: 'DiscussionNote',
        resolvable: true,
        resolved,
        position: null,
      },
    ],
  };
}
const detail = (...d: ReturnType<typeof disc>[]) =>
  ({
    mrIid: 2317,
    repositoryId: 'gitlab:42',
    discussions: d,
  }) as unknown as MRDetail;

function harness(
  over: Partial<LatchPassDeps> & { detail?: MRDetail | null } = {}
) {
  const calls: string[] = [];
  const launches: string[] = [];
  const noteBodies = new Map<number, string>();
  const gateway: LatchGateway = {
    async uploadFile() {
      calls.push('upload');
      return { alt: '', url: '', full_path: '', markdown: IMG };
    },
    async createDiscussion() {
      calls.push('createDiscussion');
      return { id: 'new', notes: [{ id: 1 }] };
    },
    async updateNote(_p, _i, id, body) {
      calls.push(`updateNote:${id}`);
      noteBodies.set(id, body);
    },
    async resolveDiscussion(_p, _i, id) {
      calls.push(`resolve:${id}`);
    },
    async unresolveDiscussion(_p, _i, id) {
      calls.push(`unresolve:${id}`);
    },
    async createNote(_p, _i, _b, d) {
      calls.push(`reply:${d}`);
      return { id: 9 };
    },
  };
  const memory: DispatchMemory = { identity: null, mrs: {} };
  const resurrects: string[] = [];
  const drops: string[] = [];
  const deps: LatchPassDeps = {
    readReviewStates: () => new Map([[MR, commented]]),
    readPrunedReviewStates: () => new Map(),
    resurrectReviewState: url => {
      resurrects.push(url);
    },
    dropPrunedReviewState: url => {
      drops.push(url);
    },
    fetchLatchMrs: async () => [facts],
    readDetail: async () =>
      over.detail === undefined ? detail() : over.detail,
    gateway,
    launchReReview: async u => {
      launches.push(u);
      return { kind: 'launched' };
    },
    memory,
    cfg,
    reReview: { enabled: true },
    appendAudit: () => {},
    notify: async () => {},
    now: () => NOW,
    ...over,
  };
  return { deps, calls, launches, memory, noteBodies, resurrects, drops };
}

describe('step 0: no latch', () => {
  test('posts one on a comment-outcome state', async () => {
    const { deps, calls } = harness({ detail: detail() });
    const r = await runLatchPass(deps);
    expect(r.posted).toBe(1);
    expect(calls).toEqual(['upload', 'createDiscussion']);
  });

  test('posts nothing on an approve-outcome state', async () => {
    const approved: ReviewState = { ...commented, outcome: 'approve' };
    const { deps, calls } = harness({
      detail: detail(),
      readReviewStates: () => new Map([[MR, approved]]),
    });
    expect((await runLatchPass(deps)).posted).toBe(0);
    expect(calls).toEqual([]);
  });

  // Descoped: a spent relic with no live latch is left alone. Arming a second
  // cycle is the server's job.
  test('posts nothing when a spent relic exists but no live latch', async () => {
    const { deps, calls } = harness({
      detail: detail(
        disc('relic', spentLatchBody(IMG), '2026-08-01T10:00:00Z', true)
      ),
    });
    expect((await runLatchPass(deps)).posted).toBe(0);
    expect(calls).toEqual([]);
  });

  // The server posts the instant a review lands; this pass checks for that
  // post through the daemon's discussion store, which within its staleness
  // window cannot prove the post exists yet. A freshly-done review defers to
  // a later tick instead of racing the server into a double post.
  test('holds off posting while the review is inside the grace window', async () => {
    const fresh: ReviewState = { ...commented, updatedAt: NOW - 60_000 };
    const { deps, calls } = harness({
      detail: detail(),
      readReviewStates: () => new Map([[MR, fresh]]),
    });
    const r = await runLatchPass(deps);
    expect(r.posted).toBe(0);
    expect(r.skipped).toBe(1);
    expect(calls).toEqual([]);
  });

  test('ignores a done state with no outcome at all', async () => {
    const noOutcome: ReviewState = { ...commented, outcome: undefined };
    const { deps, calls } = harness({
      detail: detail(),
      readReviewStates: () => new Map([[MR, noOutcome]]),
    });
    expect((await runLatchPass(deps)).skipped).toBe(1);
    expect(calls).toEqual([]);
  });
});

describe('step 1: spent latch', () => {
  test('a spent resolved latch draws no writes and never dispatches', async () => {
    const { deps, calls, launches } = harness({
      detail: detail(
        disc('d1', spentLatchBody(IMG), '2026-09-01T10:00:00Z', true)
      ),
    });
    await runLatchPass(deps);
    expect(calls).toEqual([]);
    expect(launches).toEqual([]);
  });

  test('a spent unresolved latch is re-resolved, never rearmed', async () => {
    const { deps, calls, launches } = harness({
      detail: detail(
        disc('d1', spentLatchBody(IMG), '2026-09-01T10:00:00Z', false)
      ),
    });
    expect((await runLatchPass(deps)).repaired).toBe(1);
    expect(calls).toEqual(['resolve:d1']);
    expect(launches).toEqual([]);
  });

  // Branch order only matters here. A lone spent latch can never be a carrier,
  // so it lands in step 2 regardless; only a spent canon beside a resolved
  // armed extra proves the spent check must come first.
  test('a spent canon beside a resolved armed extra never dispatches', async () => {
    const { deps, calls, launches } = harness({
      detail: detail(
        disc('spent', spentLatchBody(IMG), '2026-09-01T10:00:00Z', true),
        disc('extra', armedLatchBody(IMG), '2026-08-01T10:00:00Z', true)
      ),
    });
    expect((await runLatchPass(deps)).skipped).toBe(1);
    expect(calls).toEqual([]);
    expect(launches).toEqual([]);
  });
});

describe('step 2: armed and unresolved', () => {
  test('does nothing on a comment-outcome state', async () => {
    const { deps, calls } = harness({
      detail: detail(
        disc('d1', armedLatchBody(IMG), '2026-09-01T10:00:00Z', false)
      ),
    });
    await runLatchPass(deps);
    expect(calls).toEqual([]);
  });

  test('spends on an approve-outcome state, completing a missed server spend', async () => {
    const approved: ReviewState = { ...commented, outcome: 'approve' };
    const { deps, calls } = harness({
      detail: detail(
        disc('d1', armedLatchBody(IMG), '2026-09-01T10:00:00Z', false)
      ),
      readReviewStates: () => new Map([[MR, approved]]),
    });
    expect((await runLatchPass(deps)).spent).toBe(1);
    expect(calls).toEqual(['updateNote:1', 'resolve:d1']);
  });

  // Step 2 must spend every duplicate, not just the canonical latch.
  // Spending only the canon would strand an older armed-unresolved copy
  // forever, since the next tick sees the now-spent canon and stops at step 1
  // before ever looking at the older one.
  test('spends every armed-unresolved duplicate on an approve-outcome state', async () => {
    const approved: ReviewState = { ...commented, outcome: 'approve' };
    const { deps, calls } = harness({
      detail: detail(
        disc('newer', armedLatchBody(IMG), '2026-09-01T10:00:00Z', false),
        disc('older', armedLatchBody(IMG), '2026-08-01T10:00:00Z', false)
      ),
      readReviewStates: () => new Map([[MR, approved]]),
    });
    expect((await runLatchPass(deps)).spent).toBe(1);
    expect(calls).toContain('resolve:newer');
    expect(calls).toContain('resolve:older');
  });
});

describe('the re-review switch is board.reReview, not board.triage', () => {
  test('reReview disabled: a resolved latch is left alone, nothing is called', async () => {
    const { deps, calls, launches } = harness({
      detail: detail(
        disc('d1', armedLatchBody(IMG), '2026-09-01T10:00:00Z', true)
      ),
      reReview: { enabled: false },
    });
    const r = await runLatchPass(deps);
    expect(r).toEqual({
      posted: 0,
      dispatched: 0,
      rejected: 0,
      spent: 0,
      repaired: 0,
      resurrected: 0,
      skipped: 0,
      failed: 0,
    });
    expect(calls).toEqual([]);
    expect(launches).toEqual([]);
  });

  test('triage (doctor/nudge) disabled but reReview enabled: still dispatches', async () => {
    const { deps, calls, launches } = harness({
      detail: detail(
        disc('d1', armedLatchBody(IMG), '2026-09-01T10:00:00Z', true)
      ),
      cfg: parseTriageBlock({
        enabled: false,
        cooldownMinutes: 30,
        dailyAttemptBudget: 3,
      }),
    });
    expect((await runLatchPass(deps)).dispatched).toBe(1);
    expect(launches).toEqual([MR]);
    expect(calls).toEqual(['reply:d1', 'unresolve:d1']);
  });
});

describe('step 3: armed and resolved', () => {
  test('dispatches, replies, and unresolves to rearm', async () => {
    const { deps, calls, launches, memory } = harness({
      detail: detail(
        disc('d1', armedLatchBody(IMG), '2026-09-01T10:00:00Z', true)
      ),
    });
    expect((await runLatchPass(deps)).dispatched).toBe(1);
    expect(launches).toEqual([MR]);
    expect(calls).toEqual(['reply:d1', 'unresolve:d1']);
    expect(memory.mrs[MR]?.attemptsToday).toBe(1);
    expect(memory.mrs[MR]?.lastDispatchAt).toBe(NOW);
  });

  test('an approved MR spends instead of dispatching', async () => {
    const { deps, calls, launches } = harness({
      detail: detail(
        disc('d1', armedLatchBody(IMG), '2026-09-01T10:00:00Z', true)
      ),
      fetchLatchMrs: async () => [{ ...facts, isApproved: true }],
    });
    expect((await runLatchPass(deps)).spent).toBe(1);
    expect(launches).toEqual([]);
    expect(calls).toEqual(['updateNote:1', 'resolve:d1']);
  });

  // Spending only canon and the resolved carriers would strand an
  // armed-but-UNRESOLVED extra: it is not a carrier (requestCarriers only
  // counts resolved copies), so it survives to the next tick, which stops at
  // step 1 on the now-spent canon and never revisits it.
  test('an approved MR spends every latch found, including an armed-unresolved extra', async () => {
    const { deps, calls } = harness({
      detail: detail(
        disc('canon', armedLatchBody(IMG), '2026-09-01T10:00:00Z', true),
        disc('extra', armedLatchBody(IMG), '2026-08-01T10:00:00Z', false)
      ),
      fetchLatchMrs: async () => [{ ...facts, isApproved: true }],
    });
    expect((await runLatchPass(deps)).spent).toBe(1);
    expect(calls).toContain('resolve:canon');
    expect(calls).toContain('resolve:extra');
  });

  test('a refusal replies with the reason and still unresolves', async () => {
    const memory: DispatchMemory = {
      identity: null,
      mrs: {
        [MR]: { ...emptyMrMemory('1970-01-12'), lastDispatchAt: NOW - 60_000 },
      },
    };
    const { deps, calls, launches } = harness({
      detail: detail(
        disc('d1', armedLatchBody(IMG), '2026-09-01T10:00:00Z', true)
      ),
      memory,
    });
    expect((await runLatchPass(deps)).rejected).toBe(1);
    expect(launches).toEqual([]);
    expect(calls).toEqual(['reply:d1', 'unresolve:d1']);
    expect(memory.mrs[MR]?.attemptsToday).toBe(0);
    expect(memory.mrs[MR]?.lastDispatchAt).toBe(NOW - 60_000);
  });

  // A GitLab write failing after a successful launch must still charge the
  // attempt, or the next tick reads the same resolved latch as a fresh
  // request and dispatches again every tick for as long as the write fails.
  test('a successful launch with a failing createNote still charges the attempt', async () => {
    const { deps, launches, memory } = harness({
      detail: detail(
        disc('d1', armedLatchBody(IMG), '2026-09-01T10:00:00Z', true)
      ),
      gateway: {
        async uploadFile() {
          return { alt: '', url: '', full_path: '', markdown: IMG };
        },
        async createDiscussion() {
          return { id: 'new', notes: [{ id: 1 }] };
        },
        async updateNote() {},
        async resolveDiscussion() {},
        async unresolveDiscussion() {},
        async createNote() {
          throw new Error('gitlab 500');
        },
      },
    });
    const result = await runLatchPass(deps);
    expect(result.failed).toBe(1);
    expect(result.dispatched).toBe(0);
    expect(launches).toEqual([MR]);
    expect(memory.mrs[MR]?.attemptsToday).toBe(1);
    expect(memory.mrs[MR]?.lastDispatchAt).toBe(NOW);
  });

  test('a failed launch replies, consumes the request, and counts a rejection', async () => {
    const { deps, calls, launches } = harness({
      detail: detail(
        disc('canon', armedLatchBody(IMG), '2026-09-01T10:00:00Z', true),
        disc('extra', armedLatchBody(IMG), '2026-08-01T10:00:00Z', true)
      ),
      launchReReview: async () => ({ kind: 'error', message: 'boom' }),
    });
    expect((await runLatchPass(deps)).rejected).toBe(1);
    expect(launches).toEqual([]);
    expect(calls).toContain('reply:canon');
    expect(calls).toContain('resolve:extra');
  });
});

describe('idempotence across ticks', () => {
  // The write-loop the design eliminated: a spent latch must draw no writes on
  // any later tick, not merely on the tick that spent it.
  test('a second tick over an already-spent latch writes nothing', async () => {
    const spentDetail = detail(
      disc('d1', spentLatchBody(IMG), '2026-09-01T10:00:00Z', true)
    );
    const { deps, calls } = harness({ detail: spentDetail });
    await runLatchPass(deps);
    await runLatchPass(deps);
    expect(calls).toEqual([]);
  });

  test('an approve-outcome state repairs a spent-but-unresolved latch once', async () => {
    const approved: ReviewState = { ...commented, outcome: 'approve' };
    const { deps, calls } = harness({
      detail: detail(
        disc('d1', spentLatchBody(IMG), '2026-09-01T10:00:00Z', false)
      ),
      readReviewStates: () => new Map([[MR, approved]]),
    });
    expect((await runLatchPass(deps)).repaired).toBe(1);
    expect(calls).toEqual(['resolve:d1']);
  });
});

describe('dedupe', () => {
  // A spent relic must never outrank a fresh latch, or the feature silently
  // disables itself on this MR forever.
  test('a fresh latch beats a spent relic', async () => {
    const { deps, calls, launches } = harness({
      detail: detail(
        disc('relic', spentLatchBody(IMG), '2026-08-01T10:00:00Z', true),
        disc('fresh', armedLatchBody(IMG), '2026-09-01T10:00:00Z', true)
      ),
    });
    expect((await runLatchPass(deps)).dispatched).toBe(1);
    expect(launches).toEqual([MR]);
    expect(calls).toEqual(
      [
        'reply:fresh',
        'unresolve:fresh',
        'updateNote:1',
        'resolve:relic',
      ].filter(
        c => !c.startsWith('updateNote') && !c.startsWith('resolve:relic')
      )
    );
  });

  // Resolving the duplicate is still asking, and the request must be consumed
  // in BOTH copies or it re-fires on every re-entry into scope.
  test('a resolved extra triggers the request and is spent by the disposal', async () => {
    const { deps, calls, launches } = harness({
      detail: detail(
        disc('canon', armedLatchBody(IMG), '2026-09-01T10:00:00Z', false),
        disc('extra', armedLatchBody(IMG), '2026-09-01T09:00:00Z', true)
      ),
    });
    expect((await runLatchPass(deps)).dispatched).toBe(1);
    expect(launches).toEqual([MR]);
    expect(calls).toContain('reply:canon');
    expect(calls).toContain('updateNote:1');
    expect(calls).toContain('resolve:extra');
  });

  // The request bit must be consumed on the refusal path too, not just on
  // dispatch. Left in the extra, it re-fires on every re-entry into scope:
  // one unrequested dispatch per cooldown expiry, forever.
  test('a refusal consumes a resolved extra, not just the canonical latch', async () => {
    const memory: DispatchMemory = {
      identity: null,
      mrs: {
        [MR]: { ...emptyMrMemory('1970-01-12'), lastDispatchAt: NOW - 60_000 },
      },
    };
    const { deps, calls, launches } = harness({
      detail: detail(
        disc('canon', armedLatchBody(IMG), '2026-09-01T10:00:00Z', true),
        disc('extra', armedLatchBody(IMG), '2026-09-01T09:00:00Z', true)
      ),
      memory,
    });
    expect((await runLatchPass(deps)).rejected).toBe(1);
    expect(launches).toEqual([]);
    expect(calls).toContain('reply:canon');
    expect(calls).toContain('unresolve:canon');
    expect(calls).toContain('resolve:extra');
  });

  // The MR is not approved here (a dispatch, not an approval verdict), so the
  // extra's spend must read as a defunct duplicate, never as "Approved".
  test('consuming a duplicate on dispatch writes the superseded wording, not approved', async () => {
    const { deps, noteBodies } = harness({
      detail: detail(
        disc('canon', armedLatchBody(IMG), '2026-09-01T10:00:00Z', false),
        disc('extra', armedLatchBody(IMG), '2026-09-01T09:00:00Z', true)
      ),
    });
    await runLatchPass(deps);
    expect(noteBodies.get(1)).toContain(
      'Superseded by a newer latch on this MR'
    );
    expect(noteBodies.get(1)).not.toContain('Approved');
  });
});

describe('per-MR isolation', () => {
  // One MR's GitLab call throwing must not abort the tick: every MR queued
  // after it on the same run still has to get its own chance.
  test('a throwing MR is counted as failed and does not stop a later healthy one', async () => {
    const MR2 = 'https://gitlab.com/acme/web/-/merge_requests/9001';
    const facts2: LatchMrFacts = { ...facts, mrUrl: MR2, iid: 9001 };
    const { deps, calls } = harness({
      fetchLatchMrs: async () => [facts, facts2],
      readReviewStates: () =>
        new Map([
          [MR, commented],
          [MR2, commented],
        ]),
      readDetail: async mr => {
        if (mr.iid === facts.iid) throw new Error('gitlab 500');
        return detail();
      },
    });
    const result = await runLatchPass(deps);
    expect(result.failed).toBe(1);
    expect(result.posted).toBe(1);
    expect(calls).toEqual(['upload', 'createDiscussion']);
  });
});

describe('tombstone resurrection', () => {
  const tombstoned = {
    readReviewStates: () => new Map<string, ReviewState>(),
    readPrunedReviewStates: () => new Map([[MR, commented]]),
  };

  test('an armed resolved latch revives the tombstone and dispatches', async () => {
    const { deps, calls, launches, resurrects, drops } = harness({
      ...tombstoned,
      detail: detail(disc('d1', armedLatchBody(IMG), '2026-09-01', true)),
    });
    const result = await runLatchPass(deps);
    expect(resurrects).toEqual([MR]);
    expect(drops).toEqual([]);
    expect(result.resurrected).toBe(1);
    expect(result.dispatched).toBe(1);
    expect(launches).toEqual([MR]);
    expect(calls).toEqual(['reply:d1', 'unresolve:d1']);
  });

  test('an armed unresolved latch revives the tombstone and waits', async () => {
    const { deps, calls, resurrects } = harness({
      ...tombstoned,
      detail: detail(disc('d1', armedLatchBody(IMG), '2026-09-01', false)),
    });
    const result = await runLatchPass(deps);
    expect(resurrects).toEqual([MR]);
    expect(result.resurrected).toBe(1);
    expect(result.dispatched).toBe(0);
    expect(calls).toEqual([]);
  });

  test('a tombstone whose MR has discussions but no latch is dropped', async () => {
    const { deps, calls, resurrects, drops } = harness({
      ...tombstoned,
      detail: detail(disc('plain', 'just a human thread', '2026-09-01', false)),
    });
    const result = await runLatchPass(deps);
    expect(drops).toEqual([MR]);
    expect(resurrects).toEqual([]);
    expect(result.resurrected).toBe(0);
    expect(calls).toEqual([]);
  });

  // The daemon answers an unrecognized identity with an empty-but-ok result
  // (see LatchMrFacts.rtRepo). Dropping the tombstone on that wobble would
  // destroy the one record that lets the latch ever be found again.
  test('a tombstone is kept when the MR reads back zero discussions', async () => {
    const { deps, resurrects, drops } = harness({
      ...tombstoned,
      detail: detail(),
    });
    const result = await runLatchPass(deps);
    expect(drops).toEqual([]);
    expect(resurrects).toEqual([]);
    expect(result.skipped).toBe(1);
  });

  test('a tombstone whose only latch is spent is dropped', async () => {
    const { deps, calls, drops } = harness({
      ...tombstoned,
      detail: detail(disc('relic', spentLatchBody(IMG), '2026-09-01', true)),
    });
    await runLatchPass(deps);
    expect(drops).toEqual([MR]);
    expect(calls).toEqual([]);
  });

  test('an approved MR revives the tombstone and spends the latch', async () => {
    const { deps, calls, resurrects } = harness({
      ...tombstoned,
      fetchLatchMrs: async () => [{ ...facts, isApproved: true }],
      detail: detail(disc('d1', armedLatchBody(IMG), '2026-09-01', true)),
    });
    const result = await runLatchPass(deps);
    expect(resurrects).toEqual([MR]);
    expect(result.spent).toBe(1);
    expect(calls).toEqual(['updateNote:1', 'resolve:d1']);
  });

  test('an unreadable detail leaves the tombstone in place for the next tick', async () => {
    const { deps, resurrects, drops } = harness({
      ...tombstoned,
      detail: null,
    });
    const result = await runLatchPass(deps);
    expect(resurrects).toEqual([]);
    expect(drops).toEqual([]);
    expect(result.skipped).toBe(1);
  });

  test('an approve-outcome tombstone is not revived and never read', async () => {
    let reads = 0;
    const { deps, drops } = harness({
      readReviewStates: () => new Map<string, ReviewState>(),
      readPrunedReviewStates: () =>
        new Map([[MR, { ...commented, outcome: 'approve' as const }]]),
      readDetail: async () => {
        reads++;
        return detail();
      },
    });
    const result = await runLatchPass(deps);
    expect(reads).toBe(0);
    expect(drops).toEqual([]);
    expect(result.skipped).toBe(1);
  });

  test('no live row and no tombstone skips without reading discussions', async () => {
    let reads = 0;
    const { deps } = harness({
      readReviewStates: () => new Map<string, ReviewState>(),
      readDetail: async () => {
        reads++;
        return detail();
      },
    });
    const result = await runLatchPass(deps);
    expect(reads).toBe(0);
    expect(result.skipped).toBe(1);
  });
});
