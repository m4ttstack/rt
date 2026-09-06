import { describe, expect, test } from 'bun:test';

import type { GateRow as FacilityGateRow } from '@mattstack/rt-client';
import { attachGates, GateCache } from '../gates/cache.ts';

const SUBJECT_A = 'mr:https://gitlab.com/acme/webapp/-/merge_requests/4821';
const SUBJECT_B = 'mr:https://gitlab.com/acme/webapp/-/merge_requests/1';

function row(overrides: Partial<FacilityGateRow> = {}): FacilityGateRow {
  return {
    id: 'gate-1',
    subject: SUBJECT_A,
    kind: 'review-post',
    questions: [
      { id: 'q1', label: 'Ship it?', multi: false, options: ['yes', 'no'] },
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
    ...overrides,
  };
}

describe('GateCache.applyRow / reconcile', () => {
  test('applyRow sets a row, retrievable by subject+kind', () => {
    const cache = new GateCache();
    cache.applyRow(row());
    expect(cache.get(SUBJECT_A, 'review-post')?.id).toBe('gate-1');
  });

  test('reconcile replaces matching subjects and leaves others alone', () => {
    const cache = new GateCache();
    cache.applyRow(row({ subject: SUBJECT_A, status: 'open' }));
    cache.applyRow(row({ subject: SUBJECT_B, id: 'gate-2', status: 'parked' }));

    cache.reconcile([
      row({
        subject: SUBJECT_A,
        status: 'answered',
        answer: { answers: { q1: 'yes' }, by: 'board-ui', answeredAt: 2000 },
      }),
    ]);

    expect(cache.get(SUBJECT_A, 'review-post')?.status).toBe('answered');
    // SUBJECT_B wasn't in the reconcile list -- untouched.
    expect(cache.get(SUBJECT_B, 'review-post')?.status).toBe('parked');
  });

  test('two kinds on the same subject coexist without clobbering each other', () => {
    const cache = new GateCache();
    cache.applyRow(
      row({
        subject: SUBJECT_A,
        kind: 'review-post',
        id: 'gate-review',
        status: 'open',
      })
    );
    cache.applyRow(
      row({
        subject: SUBJECT_A,
        kind: 'respond-plan',
        id: 'gate-respond',
        status: 'answered',
      })
    );

    expect(cache.get(SUBJECT_A, 'review-post')?.id).toBe('gate-review');
    expect(cache.get(SUBJECT_A, 'review-post')?.status).toBe('open');
    expect(cache.get(SUBJECT_A, 'respond-plan')?.id).toBe('gate-respond');
    expect(cache.get(SUBJECT_A, 'respond-plan')?.status).toBe('answered');
    expect(
      cache
        .rowsFor(SUBJECT_A)
        .map(r => r.id)
        .sort()
    ).toEqual(['gate-respond', 'gate-review']);
  });

  test("rowsFor returns only the given subject's rows", () => {
    const cache = new GateCache();
    cache.applyRow(
      row({ subject: SUBJECT_A, kind: 'review-post', id: 'gate-1' })
    );
    cache.applyRow(
      row({ subject: SUBJECT_A, kind: 'doctor-escalation', id: 'gate-2' })
    );
    cache.applyRow(
      row({ subject: SUBJECT_B, kind: 'review-post', id: 'gate-3' })
    );

    expect(
      cache
        .rowsFor(SUBJECT_A)
        .map(r => r.id)
        .sort()
    ).toEqual(['gate-1', 'gate-2']);
    expect(cache.rowsFor(SUBJECT_B).map(r => r.id)).toEqual(['gate-3']);
    expect(cache.rowsFor('mr:nothing-here')).toEqual([]);
  });
});

describe('GateCache.applyEvent', () => {
  test('opened frame creates a fresh row from full context (paneId, not pane; no openedAt on the wire)', () => {
    const cache = new GateCache();
    const before = Date.now();
    cache.applyEvent({
      topic: 'gate/opened/gate-9',
      payload: {
        id: 'gate-9',
        subject: SUBJECT_A,
        kind: 'review-post',
        questions: [
          { id: 'q1', label: 'Ship it?', multi: false, options: ['yes', 'no'] },
        ],
        meta: { label: 'review gate !4821' },
        agent: 'acme-bot',
        paneId: 'pane-9',
      },
    });
    const cached = cache.get(SUBJECT_A, 'review-post');
    expect(cached?.id).toBe('gate-9');
    expect(cached?.status).toBe('open');
    // Never on the wire -- the cache stamps receipt time instead.
    expect(cached?.openedAt).toBeGreaterThanOrEqual(before);
    expect(cached?.agent).toBe('acme-bot');
    expect(cached?.pane).toBe('pane-9');
    expect(cached?.questions).toEqual([
      { id: 'q1', label: 'Ship it?', multi: false, options: ['yes', 'no'] },
    ]);
  });

  test('opened frame drops malformed questions rather than blindly casting them', () => {
    const cache = new GateCache();
    const errors: unknown[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    try {
      cache.applyEvent({
        topic: 'gate/opened/gate-9',
        payload: {
          id: 'gate-9',
          subject: SUBJECT_A,
          kind: 'review-post',
          questions: [
            {
              id: 'q1',
              label: 'Ship it?',
              multi: false,
              options: ['yes', 'no'],
            },
            {
              id: 'q2',
              label: 'Labeled',
              multi: false,
              options: [{ value: 'v', label: 'V' }],
            },
            'not an object',
            { id: 'q3', label: 'Missing options' },
            { id: 4, label: 'Bad id type', options: ['yes'] },
            { id: 'q4', label: 'Bad option shape', options: [{ value: 'v' }] },
          ],
          meta: null,
        },
      });
    } finally {
      console.error = origError;
    }
    const cached = cache.get(SUBJECT_A, 'review-post');
    expect(cached?.questions).toEqual([
      { id: 'q1', label: 'Ship it?', multi: false, options: ['yes', 'no'] },
      {
        id: 'q2',
        label: 'Labeled',
        multi: false,
        options: [{ value: 'v', label: 'V' }],
      },
    ]);
    expect(errors.length).toBe(4);
  });

  test('opened frame for an already-cached subject+kind replaces it wholesale (re-review)', () => {
    const cache = new GateCache();
    cache.applyRow(
      row({
        status: 'answered',
        answer: { answers: { q1: 'yes' }, by: 'board-ui', answeredAt: 2000 },
      })
    );

    cache.applyEvent({
      topic: 'gate/opened/gate-2',
      payload: {
        id: 'gate-2',
        subject: SUBJECT_A,
        kind: 'review-post',
        questions: [],
        meta: null,
      },
    });

    const cached = cache.get(SUBJECT_A, 'review-post');
    expect(cached?.id).toBe('gate-2');
    expect(cached?.status).toBe('open');
    expect(cached?.answer).toBeNull();
  });

  test('opened frame for a different kind on the same subject adds a second row, not a replace', () => {
    const cache = new GateCache();
    cache.applyRow(
      row({ subject: SUBJECT_A, kind: 'review-post', id: 'gate-review' })
    );

    cache.applyEvent({
      topic: 'gate/opened/gate-respond',
      payload: {
        id: 'gate-respond',
        subject: SUBJECT_A,
        kind: 'respond-plan',
        questions: [],
        meta: null,
      },
    });

    expect(cache.get(SUBJECT_A, 'review-post')?.id).toBe('gate-review');
    expect(cache.get(SUBJECT_A, 'respond-plan')?.id).toBe('gate-respond');
    expect(cache.rowsFor(SUBJECT_A)).toHaveLength(2);
  });

  test('answered frame (full context) patches an existing row by id, reading paneId', () => {
    const cache = new GateCache();
    cache.applyRow(row());

    cache.applyEvent({
      topic: 'gate/answered/gate-1',
      payload: {
        id: 'gate-1',
        subject: SUBJECT_A,
        kind: 'review-post',
        answers: { q1: 'yes' },
        by: 'pane',
        paneId: 'pane-1',
      },
    });

    const cached = cache.get(SUBJECT_A, 'review-post');
    expect(cached?.status).toBe('answered');
    expect(cached?.answer?.answers).toEqual({ q1: 'yes' });
    expect(cached?.answer?.by).toBe('pane');
    expect(cached?.pane).toBe('pane-1');
  });

  test('a thin patch finds its row by id even when another kind shares the subject', () => {
    const cache = new GateCache();
    cache.applyRow(
      row({
        subject: SUBJECT_A,
        kind: 'review-post',
        id: 'gate-review',
        status: 'open',
      })
    );
    cache.applyRow(
      row({
        subject: SUBJECT_A,
        kind: 'respond-plan',
        id: 'gate-respond',
        status: 'open',
      })
    );

    cache.applyEvent({
      topic: 'gate/parked/gate-respond',
      payload: { id: 'gate-respond', subject: SUBJECT_A, kind: 'respond-plan' },
    });

    expect(cache.get(SUBJECT_A, 'respond-plan')?.status).toBe('parked');
    // The review row, a different kind on the same subject, is untouched.
    expect(cache.get(SUBJECT_A, 'review-post')?.status).toBe('open');
  });

  test.each(['parked', 'released'] as const)(
    '%s frame (thin) patches an existing row by id',
    kind => {
      const cache = new GateCache();
      cache.applyRow(row());

      cache.applyEvent({
        topic: `gate/${kind}/gate-1`,
        payload: { id: 'gate-1', subject: SUBJECT_A, kind: 'review-post' },
      });

      const cached = cache.get(SUBJECT_A, 'review-post')!;
      if (kind === 'parked') expect(cached.status).toBe('parked');
      if (kind === 'released') expect(cached.released).toBe(true);
    }
  );

  test('closed frame patches an existing row by id, reading reason (not closedReason)', () => {
    const cache = new GateCache();
    cache.applyRow(row());

    cache.applyEvent({
      topic: 'gate/closed/gate-1',
      payload: {
        id: 'gate-1',
        subject: SUBJECT_A,
        kind: 'review-post',
        reason: 'abandoned',
      },
    });

    const cached = cache.get(SUBJECT_A, 'review-post')!;
    expect(cached.status).toBe('closed');
    expect(cached.closedReason).toBe('abandoned');
  });

  test.each(['answered', 'parked', 'closed', 'released'] as const)(
    '%s frame for an unknown id is dropped silently, no throw, no phantom entry',
    kind => {
      const cache = new GateCache();
      expect(() =>
        cache.applyEvent({
          topic: `gate/${kind}/ghost`,
          payload: { id: 'ghost', subject: SUBJECT_A, kind: 'review-post' },
        })
      ).not.toThrow();
      expect(cache.get(SUBJECT_A, 'review-post')).toBeUndefined();
      expect(cache.rows()).toEqual([]);
    }
  );

  test('a non-gate topic is ignored', () => {
    const cache = new GateCache();
    expect(() =>
      cache.applyEvent({ topic: 'board/other/thing', payload: {} })
    ).not.toThrow();
    expect(cache.rows()).toEqual([]);
  });

  test('a malformed payload is tolerated without throwing', () => {
    const cache = new GateCache();
    expect(() =>
      cache.applyEvent({
        topic: 'gate/opened/gate-1',
        payload: 'not an object',
      })
    ).not.toThrow();
    expect(() =>
      cache.applyEvent({ topic: 'gate/opened/gate-1', payload: null })
    ).not.toThrow();
    expect(cache.rows()).toEqual([]);
  });

  test('applyEvent(opened) carries context and origin onto the cached row', () => {
    const cache = new GateCache();
    cache.applyEvent({
      topic: 'gate/opened/g9',
      payload: {
        id: 'g9',
        subject: 'mr:https://gitlab.example.com/x/9',
        kind: 'review-post',
        questions: [],
        meta: null,
        context: 'finding titles',
        origin: { paneId: 'p9', presentation: 'form' },
      },
    });
    const row = cache.rowsFor('mr:https://gitlab.example.com/x/9')[0]!;
    expect(row.context).toBe('finding titles');
    expect(row.origin).toEqual({ paneId: 'p9', presentation: 'form' });
  });
});

describe('attachGates', () => {
  test('an open row renders as the open affordance, carrying kind and label', () => {
    const cache = new GateCache();
    cache.applyRow(
      row({ status: 'open', meta: { label: 'review gate !4821' } })
    );
    const [mr] = attachGates(
      [{ webUrl: 'https://gitlab.com/acme/webapp/-/merge_requests/4821' }],
      cache
    );
    expect(mr!.gates).toEqual([
      {
        gateId: 'gate-1',
        kind: 'review-post',
        label: 'review gate !4821',
        status: 'open',
        openedAt: 1000,
        questions: [
          { id: 'q1', label: 'Ship it?', multi: false, options: ['yes', 'no'] },
        ],
        answers: undefined,
        context: undefined,
        origin: undefined,
        domain: 'review',
      },
    ]);
  });

  test('a row with no meta.label falls back to kind as the label', () => {
    const cache = new GateCache();
    cache.applyRow(row({ status: 'open', meta: null }));
    const [mr] = attachGates(
      [{ webUrl: 'https://gitlab.com/acme/webapp/-/merge_requests/4821' }],
      cache
    );
    expect(mr!.gates[0]?.label).toBe('review-post');
  });

  test('a parked row renders as the parked affordance', () => {
    const cache = new GateCache();
    cache.applyRow(row({ status: 'parked' }));
    const [mr] = attachGates(
      [{ webUrl: 'https://gitlab.com/acme/webapp/-/merge_requests/4821' }],
      cache
    );
    expect(mr!.gates[0]?.status).toBe('parked');
  });

  test("an answered review-post row renders while the MR's review state is non-terminal", () => {
    const cache = new GateCache();
    cache.applyRow(
      row({
        status: 'answered',
        answer: { answers: { q1: 'yes' }, by: 'board-ui', answeredAt: 2000 },
      })
    );
    const [mr] = attachGates(
      [
        {
          webUrl: 'https://gitlab.com/acme/webapp/-/merge_requests/4821',
          review: { status: 'reviewing' as const },
        },
      ],
      cache
    );
    expect(mr!.gates[0]?.status).toBe('answered');
    expect(mr!.gates[0]?.answers).toEqual({ q1: 'yes' });
  });

  test('an answered review-post row does NOT render once review state is done (never keyed on released)', () => {
    const cache = new GateCache();
    cache.applyRow(
      row({
        status: 'answered',
        released: false,
        answer: { answers: { q1: 'yes' }, by: 'board-ui', answeredAt: 2000 },
      })
    );
    const [mr] = attachGates(
      [
        {
          webUrl: 'https://gitlab.com/acme/webapp/-/merge_requests/4821',
          review: { status: 'done' as const },
        },
      ],
      cache
    );
    expect(mr!.gates).toEqual([]);
  });

  test('an answered review-post row does NOT render once review state is error', () => {
    const cache = new GateCache();
    cache.applyRow(
      row({
        status: 'answered',
        answer: { answers: { q1: 'yes' }, by: 'board-ui', answeredAt: 2000 },
      })
    );
    const [mr] = attachGates(
      [
        {
          webUrl: 'https://gitlab.com/acme/webapp/-/merge_requests/4821',
          review: { status: 'error' as const },
        },
      ],
      cache
    );
    expect(mr!.gates).toEqual([]);
  });

  test('an answered row with no review state at all still renders (non-terminal by default)', () => {
    const cache = new GateCache();
    cache.applyRow(
      row({
        status: 'answered',
        answer: { answers: { q1: 'yes' }, by: 'board-ui', answeredAt: 2000 },
      })
    );
    const [mr] = attachGates(
      [{ webUrl: 'https://gitlab.com/acme/webapp/-/merge_requests/4821' }],
      cache
    );
    expect(mr!.gates[0]?.status).toBe('answered');
  });

  test('a closed row never renders', () => {
    const cache = new GateCache();
    cache.applyRow(
      row({ status: 'closed', closedAt: 3000, closedReason: 'abandoned' })
    );
    const [mr] = attachGates(
      [{ webUrl: 'https://gitlab.com/acme/webapp/-/merge_requests/4821' }],
      cache
    );
    expect(mr!.gates).toEqual([]);
  });

  test('an MR with no cached gate gets an empty gates array', () => {
    const cache = new GateCache();
    const [mr] = attachGates(
      [{ webUrl: 'https://gitlab.com/acme/webapp/-/merge_requests/9999' }],
      cache
    );
    expect(mr!.gates).toEqual([]);
  });

  test('an MR with no webUrl gets an empty gates array without throwing', () => {
    const cache = new GateCache();
    const [mr] = attachGates([{ webUrl: null }], cache);
    expect(mr!.gates).toEqual([]);
  });

  test('empty cache renders no gates for any MR (nothing fed yet)', () => {
    const cache = new GateCache();
    const mrs = attachGates(
      [
        { webUrl: 'https://gitlab.com/acme/webapp/-/merge_requests/1' },
        { webUrl: 'https://gitlab.com/acme/webapp/-/merge_requests/2' },
      ],
      cache
    );
    expect(mrs.every(m => m.gates.length === 0)).toBe(true);
  });

  describe('two kinds coexisting on one MR', () => {
    const WEB_URL = 'https://gitlab.com/acme/webapp/-/merge_requests/4821';
    const SUBJECT = `mr:${WEB_URL}`;

    test('a done review with a live respond gate: review card gone, respond card present', () => {
      const cache = new GateCache();
      cache.applyRow(
        row({
          subject: SUBJECT,
          kind: 'review-post',
          id: 'gate-review',
          status: 'answered',
          answer: {
            answers: { outcome: 'approve' },
            by: 'board-ui',
            answeredAt: 2000,
          },
        })
      );
      cache.applyRow(
        row({
          subject: SUBJECT,
          kind: 'respond-plan',
          id: 'gate-respond',
          status: 'open',
        })
      );

      const [mr] = attachGates(
        [
          {
            webUrl: WEB_URL,
            review: { status: 'done' as const },
            respond: { status: 'triaging' as const },
          },
        ],
        cache
      );

      const kinds = mr!.gates.map(g => g.kind);
      expect(kinds).not.toContain('review-post');
      expect(kinds).toContain('respond-plan');
      expect(mr!.gates).toHaveLength(1);
    });

    test('an answered respond-post row renders while respond is non-terminal, hides once respond is done', () => {
      const cache = new GateCache();
      cache.applyRow(
        row({
          subject: SUBJECT,
          kind: 'respond-post',
          id: 'gate-respond',
          status: 'answered',
          answer: {
            answers: { outcome: 'posted' },
            by: 'board-ui',
            answeredAt: 2000,
          },
        })
      );

      const [stillGoing] = attachGates(
        [{ webUrl: WEB_URL, respond: { status: 'drafting' as const } }],
        cache
      );
      expect(stillGoing!.gates).toHaveLength(1);

      const [done] = attachGates(
        [{ webUrl: WEB_URL, respond: { status: 'done' as const } }],
        cache
      );
      expect(done!.gates).toEqual([]);
    });

    test('an answered doctor-escalation row renders while doctor is non-terminal, hides once doctor errors', () => {
      const cache = new GateCache();
      cache.applyRow(
        row({
          subject: SUBJECT,
          kind: 'doctor-escalation',
          id: 'gate-doctor',
          status: 'answered',
          answer: {
            answers: { outcome: 'hold' },
            by: 'board-ui',
            answeredAt: 2000,
          },
        })
      );

      const [stillGoing] = attachGates(
        [{ webUrl: WEB_URL, doctor: { status: 'watching' as const } }],
        cache
      );
      expect(stillGoing!.gates).toHaveLength(1);

      const [errored] = attachGates(
        [{ webUrl: WEB_URL, doctor: { status: 'error' as const } }],
        cache
      );
      expect(errored!.gates).toEqual([]);
    });
  });

  test("attachGates carries context, origin, and the kind's domain onto the board row", () => {
    const cache = new GateCache();
    cache.applyRow({
      id: 'g1',
      subject: 'mr:https://gitlab.example.com/x/1',
      kind: 'review-post',
      questions: [],
      meta: null,
      status: 'open',
      answer: null,
      openedAt: 1,
      parkedAt: null,
      closedAt: null,
      closedReason: null,
      agent: null,
      pane: null,
      nudge: null,
      delivery: null,
      released: false,
      context: 'ctx',
      origin: { worktree: '/tmp/wt' },
    });
    const [mr] = attachGates(
      [{ webUrl: 'https://gitlab.example.com/x/1' }],
      cache
    );
    expect(mr!.gates[0]!.context).toBe('ctx');
    expect(mr!.gates[0]!.origin).toEqual({ worktree: '/tmp/wt' });
    expect(mr!.gates[0]!.domain).toBe('review');
  });
});
