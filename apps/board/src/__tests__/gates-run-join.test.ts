/** A pipeline run's gate joins the MR its run recorded, through every path
    that feeds the board's gate cache: relay frames, the boot warm, and the
    frames that settle it elsewhere. Real GateCache, real ingest, a fake
    `runs:get`. */

import { describe, expect, test } from 'bun:test';

import type {
  GateRow as FacilityGateRow,
  RtResponse,
  RunDetail,
} from '@mattstack/rt-client';
import { answerGate } from '../gates/answer.ts';
import {
  answeredWinner,
  attachGates,
  GateCache,
  isRowAnswerable,
} from '../gates/cache.ts';
import {
  buildQueueExtras,
  ingestRelayFrame,
  reconcileRunGatesOnBoot,
} from '../gates/ingest.ts';
import { RunMrResolver } from '../gates/run-mr.ts';

const MR_ON_BOARD =
  'https://gitlab.example.com/acme/webapp/-/merge_requests/301';
const MR_QUIET = 'https://gitlab.example.com/acme/webapp/-/merge_requests/302';
const MR_OFF_BOARD =
  'https://gitlab.example.com/acme/webapp/-/merge_requests/399';

const RUN_ON_BOARD = '20260923-090000-aaaa-1111';
const RUN_OFF_BOARD = '20260923-090500-bbbb-2222';
const RUN_NO_MR = '20260923-091000-cccc-3333';

const RUN_FIELDS: Record<string, string> = {
  [RUN_ON_BOARD]: MR_ON_BOARD,
  [RUN_OFF_BOARD]: MR_OFF_BOARD,
};

function fakeGetRun(runId: string): Promise<RtResponse<RunDetail>> {
  if (runId === RUN_NO_MR)
    return Promise.resolve({
      ok: true,
      data: {
        run: {} as RunDetail['run'],
        stages: [],
        fields: [{ key: 'branch', value: 'fix', produced_by: 'x', at: 1 }],
        decisions: [],
        schemaAhead: false,
      },
    } as RtResponse<RunDetail>);
  const mr = RUN_FIELDS[runId];
  if (!mr)
    return Promise.resolve({
      ok: false,
      error: 'run not found',
    } as RtResponse<RunDetail>);
  return Promise.resolve({
    ok: true,
    data: {
      run: {} as RunDetail['run'],
      stages: [],
      fields: [{ key: 'mr', value: mr, produced_by: 'ship', at: 1 }],
      decisions: [],
      schemaAhead: false,
    },
  } as RtResponse<RunDetail>);
}

function openedFrame(
  id: string,
  runId: string,
  extra: Record<string, unknown> = {}
) {
  return {
    topic: `gate/opened/${id}`,
    payload: {
      id,
      subject: `run:${runId}`,
      kind: 'clarify',
      questions: [
        {
          id: 'verify',
          label: 'How should this be verified?',
          multi: false,
          options: ['push-ci', 'local'],
        },
      ],
      meta: null,
      agent: null,
      paneId: 'pane-4',
      label: 'clarify',
      origin: { presentation: 'form', paneId: 'pane-4', runId },
      owner: 'human',
      ...extra,
    },
  };
}

function thinFrame(verb: string, id: string, runId: string) {
  return {
    topic: `gate/${verb}/${id}`,
    payload: {
      id,
      subject: `run:${runId}`,
      kind: 'clarify',
      answers: { verify: 'push-ci' },
      by: 'console',
      reason: 'abandoned',
      owner: 'herd:acme-batch',
    },
  };
}

function facilityRow(
  overrides: Partial<FacilityGateRow> = {}
): FacilityGateRow {
  return {
    id: 'gate-boot',
    subject: `run:${RUN_ON_BOARD}`,
    kind: 'ship',
    questions: [
      { id: 'next', label: 'Open the MR?', multi: false, options: ['go'] },
    ],
    meta: null,
    status: 'open',
    answer: null,
    openedAt: 5000,
    parkedAt: null,
    closedAt: null,
    closedReason: null,
    agent: null,
    pane: null,
    nudge: null,
    delivery: null,
    released: false,
    supersededBy: null,
    owner: 'human',
    escalatedAt: null,
    consumedAt: null,
    ...overrides,
  };
}

const BOARD = [{ webUrl: MR_ON_BOARD }, { webUrl: MR_QUIET }];

function harness() {
  const cache = new GateCache();
  let notified = 0;
  const resolver = new RunMrResolver({
    getRun: fakeGetRun,
    onChange: () => notified++,
  });
  return {
    cache,
    relay(frame: { topic: string; payload: unknown }) {
      ingestRelayFrame(cache, frame, () => notified++);
    },
    get notified() {
      return notified;
    },
    /** One board read, then another once the lookups it started land. */
    async board(mrs: Array<{ webUrl: string }> = BOARD) {
      attachGates(mrs, cache, resolver.links(cache.rows()));
      await resolver.settled();
      return attachGates(mrs, cache, resolver.links(cache.rows()));
    },
  };
}

describe('relay frames', () => {
  test("an opened run gate joins its run's MR with its own id and subject", async () => {
    const h = harness();
    h.relay(openedFrame('g-clarify', RUN_ON_BOARD));
    const [onBoard, quiet] = await h.board();

    expect(h.notified).toBe(2);
    expect(quiet!.gates).toEqual([]);
    expect(onBoard!.gates).toHaveLength(1);
    expect(onBoard!.gates[0]).toMatchObject({
      gateId: 'g-clarify',
      subject: `run:${RUN_ON_BOARD}`,
      kind: 'clarify',
      label: 'clarify',
      status: 'open',
      origin: { paneId: 'pane-4', runId: RUN_ON_BOARD },
    });
    expect(onBoard!.gates[0]!.questions[0]!.label).toBe(
      'How should this be verified?'
    );
    expect(
      isRowAnswerable(h.cache.rows().find(r => r.id === 'g-clarify'))
    ).toBe(true);
  });

  test('a parked frame keeps it on the MR, parked', async () => {
    const h = harness();
    h.relay(openedFrame('g-clarify', RUN_ON_BOARD));
    h.relay(thinFrame('parked', 'g-clarify', RUN_ON_BOARD));
    const [onBoard] = await h.board();
    expect(onBoard!.gates.map(g => g.status)).toEqual(['parked']);
  });

  test.each(['answered', 'closed'])(
    'a %s frame from another surface takes it off the MR',
    async verb => {
      const h = harness();
      h.relay(openedFrame('g-clarify', RUN_ON_BOARD));
      expect((await h.board())[0]!.gates).toHaveLength(1);

      h.relay(thinFrame(verb, 'g-clarify', RUN_ON_BOARD));
      expect((await h.board())[0]!.gates).toEqual([]);
      expect(
        isRowAnswerable(h.cache.rows().find(r => r.id === 'g-clarify'))
      ).toBe(false);
    }
  );

  test("a herd's gate stays off the MR until the daemon escalates it", async () => {
    const h = harness();
    h.relay(openedFrame('g-herd', RUN_ON_BOARD, { owner: 'herd:acme-batch' }));
    expect((await h.board())[0]!.gates).toEqual([]);

    h.relay(thinFrame('escalated', 'g-herd', RUN_ON_BOARD));
    const [onBoard] = await h.board();
    expect(onBoard!.gates.map(g => g.gateId)).toEqual(['g-herd']);
    expect(onBoard!.gates[0]!.escalatedAt).toBeNumber();
  });

  test('a run with no MR, or an MR the board does not track, joins nothing and stays out of the queue extras', async () => {
    const h = harness();
    h.relay(openedFrame('g-nomr', RUN_NO_MR));
    h.relay(openedFrame('g-off', RUN_OFF_BOARD));
    h.relay(openedFrame('g-unknown', '20260923-099999-dddd-4444'));
    const board = await h.board();
    expect(board.flatMap(mr => mr.gates)).toEqual([]);
    expect(buildQueueExtras(h.cache.rows())).toEqual([]);
  });

  test("the MR's own gates come first, then its runs' gates", async () => {
    const h = harness();
    h.relay(openedFrame('g-clarify', RUN_ON_BOARD));
    h.relay({
      topic: 'gate/opened/g-review',
      payload: {
        id: 'g-review',
        subject: `mr:${MR_ON_BOARD}`,
        kind: 'review-post',
        questions: [],
        owner: 'human',
      },
    });
    const [onBoard] = await h.board();
    expect(onBoard!.gates.map(g => g.gateId)).toEqual([
      'g-review',
      'g-clarify',
    ]);
  });

  test("an MR url with a trailing slash still finds its runs' gates", async () => {
    const h = harness();
    h.relay(openedFrame('g-clarify', RUN_ON_BOARD));
    const [onBoard] = await h.board([{ webUrl: `${MR_ON_BOARD}/` }]);
    expect(onBoard!.gates.map(g => g.gateId)).toEqual(['g-clarify']);
  });
});

describe('answering late', () => {
  test('a board answer to a run gate answered elsewhere loses to the recorded answer', async () => {
    const h = harness();
    h.relay(openedFrame('g-clarify', RUN_ON_BOARD));
    h.relay(thinFrame('answered', 'g-clarify', RUN_ON_BOARD));
    const row = () => h.cache.rows().find(r => r.id === 'g-clarify');

    const result = await answerGate(
      'g-clarify',
      { verify: 'local' },
      {
        isAnswerable: () => isRowAnswerable(row()),
        answeredRow: () => answeredWinner(row()),
        gateAnswer: () => {
          throw new Error('the daemon is never asked');
        },
      }
    );

    expect(result.kind).toBe('conflict');
    expect(result.kind === 'conflict' && result.row.answer).toMatchObject({
      answers: { verify: 'push-ci' },
      by: 'console',
    });
  });
});

describe('a CAS loss the board missed the frame for', () => {
  test('the winning row lands in the cache, so the gate leaves its MR', async () => {
    const h = harness();
    h.relay(openedFrame('g-clarify', RUN_ON_BOARD));
    expect((await h.board())[0]!.gates).toHaveLength(1);
    const row = () => h.cache.rows().find(r => r.id === 'g-clarify');
    const winner = {
      ...row()!,
      status: 'answered' as const,
      answer: { answers: { verify: 'local' }, by: 'pane', answeredAt: 9 },
    };

    const result = await answerGate(
      'g-clarify',
      { verify: 'push-ci' },
      {
        isAnswerable: () => isRowAnswerable(row()),
        answeredRow: () => answeredWinner(row()),
        recordWinner: won => h.cache.applyRow(won),
        gateAnswer: async () => ({
          ok: true,
          data: { row: winner, conflict: true },
        }),
      }
    );

    expect(result.kind).toBe('conflict');
    expect(row()?.status).toBe('answered');
    expect(isRowAnswerable(row())).toBe(false);
    expect((await h.board())[0]!.gates).toEqual([]);
  });
});

describe('boot warm', () => {
  test('a run gate opened while the board was down joins its MR; its settled rows do not', async () => {
    const h = harness();
    await reconcileRunGatesOnBoot(
      async () => ({
        ok: true,
        data: {
          gates: [
            facilityRow({ id: 'g-ship', kind: 'ship', status: 'open' }),
            facilityRow({
              id: 'g-plan',
              kind: 'plan',
              status: 'answered',
              answer: {
                answers: { tier: 'tdd' },
                by: 'console',
                answeredAt: 9,
              },
            }),
            facilityRow({ id: 'g-old', kind: 'self-review', status: 'closed' }),
          ],
          cursor: 3,
        },
      }),
      h.cache
    );
    const [onBoard] = await h.board();
    expect(onBoard!.gates.map(g => [g.gateId, g.status])).toEqual([
      ['g-ship', 'open'],
    ]);
    expect(h.cache.rows().map(r => r.id)).toEqual(['g-ship']);
  });

  test('a warmed gate answered elsewhere later leaves the MR', async () => {
    const h = harness();
    await reconcileRunGatesOnBoot(
      async () => ({
        ok: true,
        data: { gates: [facilityRow({ id: 'g-ship' })], cursor: 1 },
      }),
      h.cache
    );
    expect((await h.board())[0]!.gates).toHaveLength(1);
    h.relay(thinFrame('answered', 'g-ship', RUN_ON_BOARD));
    expect((await h.board())[0]!.gates).toEqual([]);
  });
});

describe('without run links', () => {
  test('a run gate never attaches on its subject alone', () => {
    const cache = new GateCache();
    cache.applyRow(facilityRow());
    const [onBoard] = attachGates([{ webUrl: MR_ON_BOARD }], cache);
    expect(onBoard!.gates).toEqual([]);
  });
});
