import { describe, expect, test } from 'bun:test';

import type { Commands, GateRow, RtResponse } from '@mattstack/rt-client';
import { answerGate, type AnswerGateIo } from '../gates/answer.ts';
import { isRowAnswerable } from '../gates/cache.ts';
import type { GateAnswers } from '../gates/store.ts';

const MR_URL = 'https://gitlab.com/acme/webapp/-/merge_requests/4821';
const GATE_ID = 'gate-1';

function baseRow(overrides: Partial<GateRow> = {}): GateRow {
  return {
    id: GATE_ID,
    subject: `mr:${MR_URL}`,
    kind: 'review-post',
    questions: [
      {
        id: 'outcome',
        label: 'Outcome?',
        multi: false,
        options: ['comment', 'approve'],
      },
    ],
    meta: null,
    status: 'open',
    answer: null,
    openedAt: 1000,
    parkedAt: null,
    closedAt: null,
    closedReason: null,
    agent: null,
    pane: null,
    nudge: null,
    delivery: null,
    released: false,
    supersededBy: null,
    owner: null,
    escalatedAt: null,
    ...overrides,
  };
}

type GateAnswerPayload = Commands['gate:answer']['payload'];
type GateAnswerData = Commands['gate:answer']['data'];

interface FakeIoCalls {
  isAnswerable: string[];
  gateAnswer: GateAnswerPayload[];
}

/** `AnswerGateIo` carries only the answerable guard and the facility call --
    there is no emit or resume hook left to wire, so a fake built from this
    interface alone already proves the answer path can't reach either. */
function fakeIo(
  answerable: boolean,
  respond: (payload: GateAnswerPayload) => RtResponse<GateAnswerData>
): { io: AnswerGateIo; calls: FakeIoCalls } {
  const calls: FakeIoCalls = { isAnswerable: [], gateAnswer: [] };
  const io: AnswerGateIo = {
    isAnswerable: gateId => {
      calls.isAnswerable.push(gateId);
      return answerable;
    },
    gateAnswer: async payload => {
      calls.gateAnswer.push(payload);
      return respond(payload);
    },
  };
  return { io, calls };
}

describe('answerGate', () => {
  test("resolves by gate id and proxies gateAnswer({id, answers, by: 'board'})", async () => {
    const answers: GateAnswers = { outcome: 'approve' };
    const { io, calls } = fakeIo(true, () => ({
      ok: true,
      data: {
        row: baseRow({
          status: 'answered',
          answer: { answers, by: 'board', answeredAt: 7000 },
        }),
      },
    }));

    const result = await answerGate(GATE_ID, answers, io);

    expect(result).toEqual({ kind: 'ok' });
    expect(calls.isAnswerable).toEqual([GATE_ID]);
    expect(calls.gateAnswer).toEqual([{ id: GATE_ID, answers, by: 'board' }]);
  });

  test('CAS conflict yields the winning row instead of an error', async () => {
    const winner = baseRow({
      status: 'answered',
      answer: {
        answers: { outcome: 'comment' },
        by: 'board',
        answeredAt: 6500,
      },
    });
    const { io } = fakeIo(true, () => ({
      ok: true,
      data: { row: winner, conflict: true },
    }));

    const result = await answerGate(GATE_ID, { outcome: 'approve' }, io);

    expect(result).toEqual({ kind: 'conflict', row: winner });
  });

  test("an id the cache doesn't hold open/parked is not-found without calling the facility", async () => {
    const { io, calls } = fakeIo(false, () => {
      throw new Error('gateAnswer should not be called');
    });

    const result = await answerGate(GATE_ID, { outcome: 'approve' }, io);

    expect(result).toEqual({ kind: 'not-found' });
    expect(calls.gateAnswer.length).toBe(0);
  });

  test("daemon 'not-found' rejection maps to not-found", async () => {
    const { io } = fakeIo(true, () => ({ ok: false, error: 'not-found' }));

    const result = await answerGate(GATE_ID, { outcome: 'approve' }, io);

    expect(result).toEqual({ kind: 'not-found' });
  });

  test("daemon 'closed' rejection maps to not-found", async () => {
    const { io } = fakeIo(true, () => ({ ok: false, error: 'closed' }));

    const result = await answerGate(GATE_ID, { outcome: 'approve' }, io);

    expect(result).toEqual({ kind: 'not-found' });
  });

  test('daemon strict-membership/validation rejection maps to invalid, message verbatim', async () => {
    const message = `answers include ids outside gate ${GATE_ID}'s question set (strict membership)`;
    const { io } = fakeIo(true, () => ({ ok: false, error: message }));

    const result = await answerGate(
      GATE_ID,
      { bogus: 'yes' } as unknown as GateAnswers,
      io
    );

    expect(result).toEqual({ kind: 'invalid', reason: message });
  });

  test("a validation message that merely echoes the word 'closed' (e.g. an invalid option value) stays 400, not 404", async () => {
    const message = `answer for "outcome" is not one of its options: "closed"`;
    const { io } = fakeIo(true, () => ({ ok: false, error: message }));

    const result = await answerGate(
      GATE_ID,
      { outcome: 'closed' } as unknown as GateAnswers,
      io
    );

    expect(result).toEqual({ kind: 'invalid', reason: message });
  });

  test('gateAnswer rejecting (e.g. a network failure) maps to unreachable, not invalid', async () => {
    const io: AnswerGateIo = {
      isAnswerable: () => true,
      gateAnswer: async () => {
        throw new Error('connect ECONNREFUSED');
      },
    };

    const result = await answerGate(GATE_ID, { outcome: 'approve' }, io);

    expect(result).toEqual({
      kind: 'unreachable',
      reason: 'connect ECONNREFUSED',
    });
  });

  test("the rt-client transport's own daemon-unreachable ok:false response maps to unreachable, not invalid", async () => {
    const message =
      'rt daemon unreachable at /tmp/rt.sock: connect ECONNREFUSED';
    const { io } = fakeIo(true, () => ({ ok: false, error: message }));

    const result = await answerGate(GATE_ID, { outcome: 'approve' }, io);

    expect(result).toEqual({ kind: 'unreachable', reason: message });
  });

  test('a retry POST on an ANSWERED row left execution: "unassigned" reaches the daemon forward, not a 404', async () => {
    // Wires isAnswerable to the real predicate server.ts uses (gates/cache.ts's
    // isRowAnswerable) instead of a hardcoded boolean, so this proves the
    // same row shape server.ts's gate cache produces on a stuck retry
    // actually reaches gateAnswer rather than short-circuiting to not-found.
    const answeredUnassigned = {
      ...baseRow({
        status: 'answered',
        answer: { answers: { outcome: 'approve' }, by: 'agent', answeredAt: 1 },
      }),
      execution: 'unassigned',
    } as unknown as GateRow;
    const calls: GateAnswerPayload[] = [];
    const io: AnswerGateIo = {
      isAnswerable: gateId =>
        isRowAnswerable(gateId === GATE_ID ? answeredUnassigned : undefined),
      gateAnswer: async payload => {
        calls.push(payload);
        return {
          ok: true,
          data: {
            row: baseRow({
              status: 'answered',
              answer: {
                answers: { outcome: 'approve' },
                by: 'board',
                answeredAt: 2,
              },
            }),
          },
        };
      },
    };

    const result = await answerGate(GATE_ID, { outcome: 'approve' }, io);

    expect(result).toEqual({ kind: 'ok' });
    expect(calls).toEqual([
      { id: GATE_ID, answers: { outcome: 'approve' }, by: 'board' },
    ]);
  });
});
