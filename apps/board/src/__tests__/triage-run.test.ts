import { describe, expect, test } from 'bun:test';

import type { AuditEntry } from '../triage/audit.ts';
import { parseTriageBlock } from '../triage/config.ts';
import type { OwnMrFacts } from '../triage/edge.ts';
import { emptyMrMemory, type DispatchMemory } from '../triage/memory.ts';
import {
  composeFixClasses,
  enabledFixClassNames,
  numericPipelineId,
  runTriage,
  type TriageRunDeps,
} from '../triage/run.ts';

type NotifyCall = { title: string; message: string; mrUrl: string };

function deps(over: Partial<TriageRunDeps> = {}): TriageRunDeps & {
  audit: AuditEntry[];
  launches: any[];
  notifies: string[];
  notifyCalls: NotifyCall[];
  paneNudges: Array<{ paneId: string; text: string }>;
} {
  const audit: AuditEntry[] = [];
  const launches: any[] = [];
  const notifies: string[] = [];
  const notifyCalls: NotifyCall[] = [];
  const paneNudges: Array<{ paneId: string; text: string }> = [];
  const base: TriageRunDeps = {
    triage: parseTriageBlock({ enabled: true, doctorSkill: 'team:doctor-api' }),
    doctorCwd: '/repo',
    doctorsWorkspace: 'doctors',
    account: 'matt@example.com',
    model: 'opus',
    effort: 'high',
    repoForMr: () => 'acme/webapp',
    fetchOwnMrs: async () => [
      {
        mrUrl: 'https://x/mr/1',
        iid: 1,
        pipelineId: 100,
        pipelineState: 'failed',
        needsRebase: false,
        author: 'matt',
        sourceBranch: 'feat',
        targetBranch: 'master',
        isStacked: false,
      } satisfies OwnMrFacts,
    ],
    readDoctorStates: () => new Map(),
    launchDoctor: async opts => {
      launches.push(opts);
      return {
        agentId: 'agent-1',
        sessionId: 'sess-1',
        paneId: 'p',
        tabId: 't',
        workspaceId: 'w',
        focusedExisting: false,
      };
    },
    writeDoctorState: (path, patch) => ({
      mrUrl: patch.mrUrl ?? '',
      iid: patch.iid ?? 0,
      status: patch.status,
      origin: patch.origin,
      startedAt: 0,
      updatedAt: 0,
    }),
    doctorFilePath: mrUrl => `/state/${mrUrl.split('/').pop()}.json`,
    appendAudit: e => audit.push(e),
    notify: async (title, m, mrUrl) => {
      notifies.push(m);
      notifyCalls.push({ title, message: m, mrUrl });
    },
    memory: { identity: null, mrs: {} } as DispatchMemory,
    writeMemory: () => {},
    // Defaults to the SAME in-process snapshot (no separate-process race);
    // a test exercising the post-launch stand-down race overrides this to
    // simulate a different process's write landing mid-launch.
    readFreshMemory: () => base.memory,
    sendPaneText: async (paneId, text) => {
      paneNudges.push({ paneId, text });
    },
    now: () => 1_000_000_000,
    identity: 'matt',
  };
  return Object.assign(base, over, {
    audit,
    launches,
    notifies,
    notifyCalls,
    paneNudges,
  });
}

describe('runTriage', () => {
  test('red own MR dispatches an api-tier doctor and records everything', async () => {
    const d = deps();
    const result = await runTriage(d);
    expect(result.dispatched).toBe(1);
    expect(d.launches[0].tier).toBe('api');
    expect(d.launches[0].skill).toBe('team:doctor-api');
    expect(d.launches[0].fixClasses).toEqual([
      'retry-flake',
      'inherited-note-draft',
    ]); // cleanApiRebase off by default
    expect(d.audit.some(e => e.decision === 'dispatch')).toBe(true);
    expect(d.launches[0].account).toBe('matt@example.com');
    expect(d.launches[0].model).toBe('opus');
    expect(d.launches[0].effort).toBe('high');
    expect(d.memory.mrs['https://x/mr/1']!.attemptsToday).toBe(1);
    expect(d.memory.mrs['https://x/mr/1']!.lastHandledPipelineId).toBe(100);
  });

  test('budget exhausted notifies exactly once', async () => {
    // dayStamp must match now(): 1_000_000_000 ms is 1970-01-12, and a
    // mismatched stamp would legitimately roll the day and reset the budget.
    const d = deps({
      memory: {
        identity: null,
        mrs: {
          'https://x/mr/1': {
            ...emptyMrMemory('1970-01-12'),
            attemptsToday: 3,
          },
        },
      },
    });
    await runTriage(d);
    expect(d.notifies).toHaveLength(1);
    await runTriage(d);
    expect(d.notifies).toHaveLength(1); // budgetEscalatedDay dedups
    expect(d.launches).toHaveLength(0);
  });

  test('budget exhausted notifies in plain words, pointing at the MR', async () => {
    const d = deps({
      memory: {
        identity: null,
        mrs: {
          'https://x/mr/1': {
            ...emptyMrMemory('1970-01-12'),
            attemptsToday: 3,
          },
        },
      },
    });
    await runTriage(d);
    expect(d.notifyCalls).toEqual([
      {
        title: 'Auto-fix stopped on !1',
        message: 'Out of tries for today, over to you',
        mrUrl: 'https://x/mr/1',
      },
    ]);
  });

  test('an in-flight doctor on the MR skips without consuming budget', async () => {
    const inflight = new Map([
      [
        'https://x/mr/1',
        {
          mrUrl: 'https://x/mr/1',
          iid: 1,
          status: 'fixing' as const,
          origin: 'manual' as const,
          startedAt: 0,
          updatedAt: 0,
        },
      ],
    ]);
    const d = deps({ readDoctorStates: () => inflight });
    await runTriage(d);
    expect(d.launches).toHaveLength(0);
    expect(d.audit.some(e => e.reason === 'doctor-in-flight')).toBe(true);
  });

  test('disabled runs do nothing at all', async () => {
    const d = deps({ triage: parseTriageBlock(undefined) });
    const result = await runTriage(d);
    expect(result).toEqual({ dispatched: 0, escalated: 0, skipped: 0 });
    expect(d.audit).toHaveLength(0);
  });
});

describe('helpers', () => {
  test("numericPipelineId parses glance's scoped id", () => {
    expect(numericPipelineId('gitlab:pipeline:12345')).toBe(12345);
    expect(numericPipelineId('garbage')).toBeNull();
  });
  test('enabledFixClassNames kebab-cases only the enabled classes', () => {
    expect(
      enabledFixClassNames({
        retryFlake: true,
        inheritedNoteDraft: false,
        cleanApiRebase: true,
        mechanicalLint: false,
        codeFix: false,
      })
    ).toEqual(['retry-flake', 'clean-api-rebase']);
  });

  describe('composeFixClasses (MAT-351 author gate)', () => {
    const fc = {
      retryFlake: true,
      inheritedNoteDraft: true,
      cleanApiRebase: false,
      mechanicalLint: true,
      codeFix: true,
    };

    test('includes both branch-writing classes when the edge author matches the board identity', () => {
      expect(composeFixClasses(fc, 'matt', 'matt')).toEqual([
        'retry-flake',
        'inherited-note-draft',
        'mechanical-lint',
        'code-fix',
      ]);
    });

    test('omits both branch-writing classes when the edge author does not match, even though enabled', () => {
      expect(composeFixClasses(fc, 'teammate', 'matt')).toEqual([
        'retry-flake',
        'inherited-note-draft',
      ]);
    });

    test('omits both branch-writing classes when the board identity is not yet known', () => {
      expect(composeFixClasses(fc, 'matt', null)).toEqual([
        'retry-flake',
        'inherited-note-draft',
      ]);
    });

    test('each branch-writing class stays off when its config toggle is off, regardless of author match', () => {
      expect(
        composeFixClasses({ ...fc, mechanicalLint: false }, 'matt', 'matt')
      ).toEqual(['retry-flake', 'inherited-note-draft', 'code-fix']);
      expect(
        composeFixClasses({ ...fc, codeFix: false }, 'matt', 'matt')
      ).toEqual(['retry-flake', 'inherited-note-draft', 'mechanical-lint']);
      expect(
        composeFixClasses(
          { ...fc, mechanicalLint: false, codeFix: false },
          'matt',
          'matt'
        )
      ).toEqual(['retry-flake', 'inherited-note-draft']);
    });
  });
});

describe('runTriage mechanical-lint dispatch gate (MAT-351)', () => {
  const triageWithMechanicalLint = parseTriageBlock({
    enabled: true,
    doctorSkill: 'team:doctor',
    tier: 'checkout',
    fixClasses: { mechanicalLint: true },
  });

  test('Matt-authored MR gets mechanical-lint in the composed --fix-classes', async () => {
    const d = deps({ triage: triageWithMechanicalLint, identity: 'matt' });
    await runTriage(d);
    expect(d.launches[0].fixClasses).toEqual([
      'retry-flake',
      'inherited-note-draft',
      'mechanical-lint',
    ]);
  });

  test('teammate-authored MR does NOT get mechanical-lint even with the class enabled', async () => {
    const d = deps({
      triage: triageWithMechanicalLint,
      identity: 'matt',
      fetchOwnMrs: async () => [
        {
          mrUrl: 'https://x/mr/1',
          iid: 1,
          pipelineId: 100,
          pipelineState: 'failed',
          needsRebase: false,
          author: 'teammate',
          sourceBranch: 'feat',
          targetBranch: 'master',
          isStacked: false,
        } satisfies OwnMrFacts,
      ],
    });
    await runTriage(d);
    expect(d.launches[0].fixClasses).toEqual([
      'retry-flake',
      'inherited-note-draft',
    ]);
  });
});

test('checkout tier dispatches with tier omitted (historical full doctor); api stays explicit', async () => {
  const dApi = deps();
  await runTriage(dApi);
  expect(dApi.launches[0]?.tier).toBe('api');

  const dFull = deps({
    triage: parseTriageBlock({
      enabled: true,
      doctorSkill: 'team:doctor',
      tier: 'checkout',
    }),
  });
  await runTriage(dFull);
  expect(dFull.launches[0]?.tier).toBeUndefined();
});

describe('runTriage attendant lease (BOARD-10)', () => {
  function fakeAttendants(
    reads: Record<string, 'watch-ci' | 'doctor' | null> = {},
    byBranch: Record<
      string,
      { holder: 'watch-ci' | 'doctor'; iid: number }
    > = {}
  ) {
    const calls = {
      claims: [] as number[],
      heartbeats: [] as number[],
      releases: [] as number[],
    };
    return {
      calls,
      attendants: {
        read: (mrUrl: string, _iid: number) => {
          const holder = reads[mrUrl] ?? null;
          return holder === null
            ? null
            : {
                mr: mrUrl,
                holder,
                startedAt: 0,
                heartbeatAt: 0,
                ttlSeconds: 600,
              };
        },
        readByBranch: (branch: string) => {
          const hit = Object.entries(byBranch).find(([b]) => b === branch);
          return hit
            ? { mr: `https://x/mr/${hit[1].iid}`, holder: hit[1].holder }
            : null;
        },
        claim: (_mrUrl: string, iid: number) => {
          calls.claims.push(iid);
          return true;
        },
        heartbeat: (_mrUrl: string, iid: number) => {
          calls.heartbeats.push(iid);
        },
        release: (_mrUrl: string, iid: number) => {
          calls.releases.push(iid);
        },
      },
    };
  }

  test('a fresh watch-ci lease skips dispatch without consuming budget', async () => {
    const fa = fakeAttendants({ 'https://x/mr/1': 'watch-ci' });
    const d = deps({ attendants: fa.attendants });
    const result = await runTriage(d);
    expect(result.dispatched).toBe(0);
    expect(d.launches).toHaveLength(0);
    expect(d.audit.some(e => e.reason === 'attended')).toBe(true);
    expect(d.memory.mrs['https://x/mr/1']!.attemptsToday).toBe(0);
    expect(fa.calls.claims).toHaveLength(0);
  });

  test('a dispatch claims the lease as doctor', async () => {
    const fa = fakeAttendants();
    const d = deps({ attendants: fa.attendants });
    const result = await runTriage(d);
    expect(result.dispatched).toBe(1);
    expect(fa.calls.claims).toEqual([1]);
  });

  test('in-flight doctors get a heartbeat; terminal doctors release', async () => {
    const states = new Map([
      [
        'https://x/mr/1',
        {
          mrUrl: 'https://x/mr/1',
          iid: 1,
          status: 'fixing' as const,
          origin: 'auto' as const,
          startedAt: 0,
          updatedAt: 0,
        },
      ],
      [
        'https://x/mr/2',
        {
          mrUrl: 'https://x/mr/2',
          iid: 2,
          status: 'done' as const,
          origin: 'auto' as const,
          startedAt: 0,
          updatedAt: 0,
        },
      ],
    ]);
    const fa = fakeAttendants();
    const d = deps({
      attendants: fa.attendants,
      readDoctorStates: () => states,
    });
    await runTriage(d);
    expect(fa.calls.heartbeats).toEqual([1]);
    expect(fa.calls.releases).toEqual([2]);
  });
});

describe('runTriage stack chain (BOARD-12)', () => {
  const PARENT = 'https://x/mr/1';
  const CHILD = 'https://x/mr/2';

  function stack(
    over: { parent?: Partial<OwnMrFacts>; child?: Partial<OwnMrFacts> } = {}
  ): OwnMrFacts[] {
    return [
      {
        mrUrl: PARENT,
        iid: 1,
        pipelineId: 100,
        pipelineState: 'passed',
        needsRebase: false,
        author: 'matt',
        sourceBranch: 'feat-parent',
        targetBranch: 'master',
        isStacked: false,
        ...over.parent,
      },
      {
        mrUrl: CHILD,
        iid: 2,
        pipelineId: 200,
        pipelineState: 'failed',
        needsRebase: false,
        author: 'matt',
        sourceBranch: 'feat-child',
        targetBranch: 'feat-parent',
        isStacked: true,
        ...over.child,
      },
    ];
  }

  function attendants(
    reads: Record<string, 'watch-ci' | 'doctor' | null> = {},
    byBranch: Record<string, { holder: 'watch-ci' | 'doctor'; mr: string }> = {}
  ) {
    const claims: number[] = [];
    return {
      claims,
      port: {
        read: (mrUrl: string) =>
          reads[mrUrl]
            ? {
                mr: mrUrl,
                holder: reads[mrUrl]!,
                startedAt: 0,
                heartbeatAt: 0,
                ttlSeconds: 600,
              }
            : null,
        readByBranch: (branch: string) => byBranch[branch] ?? null,
        claim: (_mrUrl: string, iid: number) => {
          claims.push(iid);
          return true;
        },
        heartbeat: () => {},
        release: () => {},
      },
    };
  }

  test('a watch-ci lease on the parent skips the red child without consuming budget', async () => {
    const a = attendants({ [PARENT]: 'watch-ci' });
    const d = deps({ fetchOwnMrs: async () => stack(), attendants: a.port });
    const result = await runTriage(d);
    expect(result.dispatched).toBe(0);
    expect(d.launches).toHaveLength(0);
    expect(
      d.audit.some(e => e.mrUrl === CHILD && e.reason === 'attended-upstream')
    ).toBe(true);
    expect(d.memory.mrs[CHILD]!.attemptsToday).toBe(0);
    expect(a.claims).toHaveLength(0);
  });

  test('the skipped child re-fires next cycle -- the edge is never latched as handled', async () => {
    const a = attendants({ [PARENT]: 'watch-ci' });
    const d = deps({ fetchOwnMrs: async () => stack(), attendants: a.port });
    await runTriage(d);
    expect(d.memory.mrs[CHILD]!.lastHandledPipelineId).not.toBe(200);
    const again = await runTriage(d);
    expect(again.skipped).toBeGreaterThan(0);
  });

  test('a red parent skips the child as red-upstream while the parent itself still dispatches', async () => {
    const a = attendants();
    const d = deps({
      fetchOwnMrs: async () => stack({ parent: { pipelineState: 'failed' } }),
      attendants: a.port,
    });
    const result = await runTriage(d);
    expect(result.dispatched).toBe(1);
    expect(d.launches.map(l => l.iid)).toEqual([1]);
    expect(
      d.audit.some(e => e.mrUrl === CHILD && e.reason === 'red-upstream')
    ).toBe(true);
  });

  test("an attended parent suppresses the child's needs-rebase edge too, not just pipeline-red", async () => {
    const a = attendants({ [PARENT]: 'watch-ci' });
    const d = deps({
      fetchOwnMrs: async () =>
        stack({ child: { pipelineState: 'passed', needsRebase: true } }),
      attendants: a.port,
    });
    await runTriage(d);
    expect(d.launches).toHaveLength(0);
    expect(
      d.audit.some(
        e =>
          e.mrUrl === CHILD &&
          e.event === 'needs-rebase' &&
          e.reason === 'attended-upstream'
      )
    ).toBe(true);
  });

  test("a green unattended parent leaves the child's dispatch alone", async () => {
    const a = attendants();
    const d = deps({ fetchOwnMrs: async () => stack(), attendants: a.port });
    const result = await runTriage(d);
    expect(result.dispatched).toBe(1);
    expect(d.launches.map(l => l.iid)).toEqual([2]);
  });

  test('an in-flight doctor on the parent blocks the child even with no lease (manual board launches never claim)', async () => {
    const a = attendants();
    const states = new Map([
      [
        PARENT,
        {
          mrUrl: PARENT,
          iid: 1,
          status: 'fixing' as const,
          origin: 'manual' as const,
          startedAt: 0,
          updatedAt: 0,
        },
      ],
    ]);
    const d = deps({
      fetchOwnMrs: async () => stack(),
      attendants: a.port,
      readDoctorStates: () => states,
    });
    await runTriage(d);
    expect(d.launches).toHaveLength(0);
    expect(
      d.audit.some(e => e.mrUrl === CHILD && e.reason === 'attended-upstream')
    ).toBe(true);
  });

  test('a lease naming the parent branch blocks the child when the parent MR is outside the board window', async () => {
    const a = attendants(
      {},
      { 'feat-parent': { holder: 'watch-ci', mr: PARENT } }
    );
    const d = deps({
      fetchOwnMrs: async () => [stack()[1]!],
      attendants: a.port,
    });
    await runTriage(d);
    expect(d.launches).toHaveLength(0);
    expect(
      d.audit.some(e => e.mrUrl === CHILD && e.reason === 'attended-upstream')
    ).toBe(true);
  });

  test('an invisible parent with no lease anywhere still dispatches -- unknown is not blocked', async () => {
    const a = attendants();
    const d = deps({
      fetchOwnMrs: async () => [stack()[1]!],
      attendants: a.port,
    });
    const result = await runTriage(d);
    expect(result.dispatched).toBe(1);
    expect(a.claims).toEqual([2]);
  });

  test('the by-branch lookup is never consulted for an unstacked MR', async () => {
    const looked: string[] = [];
    const port = {
      ...attendants().port,
      readByBranch: (b: string) => {
        looked.push(b);
        return null;
      },
    };
    const d = deps({
      fetchOwnMrs: async () => [stack()[0]!],
      attendants: port,
    });
    await runTriage(d);
    expect(looked).toHaveLength(0);
  });
});

describe('runTriage stand-down (operator "never diagnose this stack")', () => {
  const PARENT = 'https://x/mr/1';
  const CHILD = 'https://x/mr/2';

  function stack(): OwnMrFacts[] {
    return [
      {
        mrUrl: PARENT,
        iid: 1,
        pipelineId: 100,
        pipelineState: 'failed',
        needsRebase: false,
        author: 'matt',
        sourceBranch: 'feat-parent',
        targetBranch: 'master',
        isStacked: false,
      },
      {
        mrUrl: CHILD,
        iid: 2,
        pipelineId: 200,
        pipelineState: 'failed',
        needsRebase: false,
        author: 'matt',
        sourceBranch: 'feat-child',
        targetBranch: 'feat-parent',
        isStacked: true,
      },
    ];
  }

  test('a stood-down MR skips without consuming budget', async () => {
    const d = deps({
      memory: {
        identity: null,
        mrs: {
          'https://x/mr/1': { ...emptyMrMemory('1970-01-12'), standDown: true },
        },
      },
    });
    const result = await runTriage(d);
    expect(d.launches).toHaveLength(0);
    expect(
      d.audit.some(
        e => e.mrUrl === 'https://x/mr/1' && e.reason === 'stood-down'
      )
    ).toBe(true);
    expect(d.memory.mrs['https://x/mr/1']!.attemptsToday).toBe(0);
    expect(result.dispatched).toBe(0);
  });

  test('standing down the parent also blocks the child (whole stack)', async () => {
    const d = deps({
      fetchOwnMrs: async () => stack(),
      memory: {
        identity: null,
        mrs: {
          [PARENT]: { ...emptyMrMemory('1970-01-12'), standDown: true },
        },
      },
    });
    await runTriage(d);
    expect(d.launches).toHaveLength(0);
    expect(
      d.audit.some(e => e.mrUrl === CHILD && e.reason === 'stood-down')
    ).toBe(true);
    expect(d.memory.mrs[CHILD]?.attemptsToday ?? 0).toBe(0);
  });

  test('a new pipeline id on a stood-down MR still skips -- the edge is never latched as handled', async () => {
    const d = deps({
      fetchOwnMrs: async () => stack(),
      memory: {
        identity: null,
        mrs: {
          [PARENT]: { ...emptyMrMemory('1970-01-12'), standDown: true },
        },
      },
    });
    await runTriage(d);
    expect(d.memory.mrs[PARENT]!.lastHandledPipelineId).not.toBe(100);
    const again = await runTriage(d);
    expect(again.skipped).toBeGreaterThan(0);
    expect(d.launches.filter(l => l.iid === 1)).toHaveLength(0);
  });

  test('clearing the flag lets the next run dispatch again', async () => {
    const d = deps({
      fetchOwnMrs: async () => stack(),
      memory: {
        identity: null,
        mrs: {
          [PARENT]: { ...emptyMrMemory('1970-01-12'), standDown: true },
        },
      },
    });
    await runTriage(d);
    d.memory.mrs[PARENT]!.standDown = false;
    const result = await runTriage(d);
    expect(d.launches.map(l => l.iid)).toContain(1);
    expect(result.dispatched).toBeGreaterThan(0);
  });
});

describe('runTriage post-launch stand-down race', () => {
  // A stand-down landing from a DIFFERENT process (the board server) while
  // this run's own launchDoctor await is in flight: readDoctorStates() and
  // readFreshMemory() are both fresh reads, distinct from this run's own
  // `memory` snapshot, so they can see a write this process never made.
  function raceDeps(
    over: Partial<ReturnType<typeof deps>> = {}
  ): ReturnType<typeof deps> {
    return deps({
      readDoctorStates: () =>
        new Map([
          [
            'https://x/mr/1',
            {
              mrUrl: 'https://x/mr/1',
              iid: 1,
              status: 'done' as const,
              message: 'stood down by operator',
              startedAt: 0,
              updatedAt: 0,
            },
          ],
        ]),
      readFreshMemory: () => ({
        identity: null,
        mrs: {
          'https://x/mr/1': { ...emptyMrMemory('1970-01-12'), standDown: true },
        },
      }),
      ...over,
    });
  }

  test('a row closed by stand-down mid-launch is never resurrected to queued', async () => {
    const writes: Array<{ status?: string; paneId?: string }> = [];
    const d = raceDeps({
      writeDoctorState: (path, patch) => {
        writes.push(patch);
        return {
          mrUrl: patch.mrUrl ?? '',
          iid: patch.iid ?? 0,
          status: patch.status,
          startedAt: 0,
          updatedAt: 0,
        };
      },
    });
    await runTriage(d);
    // The dispatch-time write (status: 'queued', origin: 'auto', no paneId
    // yet) is expected; the completion write carrying the fresh paneId is
    // the one that must never land once the race guard sees the row closed.
    expect(writes.some(w => w.status === 'queued' && w.paneId)).toBe(false);
    expect(d.paneNudges).toEqual([
      { paneId: 'p', text: expect.stringContaining('stood down') },
    ]);
  });

  test('the freshly launched pane gets the stand-down message', async () => {
    const d = raceDeps();
    await runTriage(d);
    expect(d.paneNudges).toHaveLength(1);
    expect(d.paneNudges[0]!.paneId).toBe('p'); // the launch's own paneId
  });

  test('a terminal row for an unrelated reason (not standDown) gets no nudge', async () => {
    const d = raceDeps({
      readFreshMemory: () => ({ identity: null, mrs: {} }), // standDown absent
    });
    await runTriage(d);
    expect(d.paneNudges).toEqual([]);
  });

  test('no race (default fresh reads): dispatch proceeds normally, no nudge', async () => {
    const d = deps();
    await runTriage(d);
    expect(d.paneNudges).toEqual([]);
    expect(d.launches).toHaveLength(1);
  });
});
