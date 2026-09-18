import { describe, expect, test } from 'bun:test';

import type { Envelope, NudgeResult } from '../peer/envelope.ts';
import { materializeEnvelope, type MaterializeDeps } from '../peer/inbox.ts';
import type { NudgeState } from '../peer/nudges.ts';
import type { PeerReviewState } from '../peer/peer-reviews.ts';

const URL_A = 'https://gitlab.com/acme/webapp/-/merge_requests/4821';

/** Recording fake deps -- every call is pushed to its own array so tests can
    assert both "was it called" and "with exactly what". */
function fakeDeps(): MaterializeDeps & {
  peerReviews: PeerReviewState[];
  nudges: NudgeState[];
  resolutions: Array<{
    mrUrl: string;
    resolution: {
      result: NudgeResult | 'confirmed';
      reason?: string;
      at: number;
    };
  }>;
  retirements: Array<{ mrUrl: string; ifSentBefore: number; nudgeId?: string }>;
  logs: string[];
} {
  const peerReviews: PeerReviewState[] = [];
  const nudges: NudgeState[] = [];
  const resolutions: Array<{
    mrUrl: string;
    resolution: {
      result: NudgeResult | 'confirmed';
      reason?: string;
      at: number;
    };
  }> = [];
  const retirements: Array<{
    mrUrl: string;
    ifSentBefore: number;
    nudgeId?: string;
  }> = [];
  const logs: string[] = [];
  return {
    peerReviews,
    nudges,
    resolutions,
    retirements,
    logs,
    writePeerReview(s) {
      peerReviews.push(s);
      return true;
    },
    writeNudge(n) {
      nudges.push(n);
    },
    resolveSentNudge(mrUrl, resolution) {
      resolutions.push({ mrUrl, resolution });
    },
    retireSentNudge(mrUrl, ifSentBefore, nudgeId) {
      retirements.push({
        mrUrl,
        ifSentBefore,
        ...(nudgeId !== undefined ? { nudgeId } : {}),
      });
    },
    log(line) {
      logs.push(line);
    },
  };
}

function envelope(over: Partial<Envelope> = {}): Envelope {
  return {
    id: 'env-1',
    to: 'ada',
    from: 'grace',
    type: 'review-state',
    sentAt: 100,
    receivedAt: 200,
    payload: {},
    ...over,
  };
}

describe('materializeEnvelope', () => {
  describe('review-state', () => {
    test('writes a peer review with reviewer merged from envelope.from', () => {
      const deps = fakeDeps();
      const e = envelope({
        from: 'grace',
        payload: {
          mrUrl: URL_A,
          iid: 4821,
          status: 'reviewing',
          updatedAt: 500,
        },
      });
      materializeEnvelope(e, deps, 1000);
      expect(deps.peerReviews).toEqual([
        {
          mrUrl: URL_A,
          iid: 4821,
          status: 'reviewing',
          updatedAt: 500,
          reviewer: 'grace',
        },
      ]);
    });

    test("status 'reviewing' also confirms any pending sent nudge for the MR", () => {
      const deps = fakeDeps();
      const e = envelope({
        payload: {
          mrUrl: URL_A,
          iid: 4821,
          status: 'reviewing',
          updatedAt: 500,
        },
      });
      materializeEnvelope(e, deps, 1000);
      expect(deps.resolutions).toEqual([
        { mrUrl: URL_A, resolution: { result: 'confirmed', at: 1000 } },
      ]);
    });

    test("status 'queued' also confirms any pending sent nudge for the MR", () => {
      const deps = fakeDeps();
      const e = envelope({
        payload: { mrUrl: URL_A, iid: 4821, status: 'queued', updatedAt: 500 },
      });
      materializeEnvelope(e, deps, 1000);
      expect(deps.resolutions).toEqual([
        { mrUrl: URL_A, resolution: { result: 'confirmed', at: 1000 } },
      ]);
    });

    test("status 'done' does not resolve a sent nudge", () => {
      const deps = fakeDeps();
      const e = envelope({
        payload: { mrUrl: URL_A, iid: 4821, status: 'done', updatedAt: 500 },
      });
      materializeEnvelope(e, deps, 1000);
      expect(deps.peerReviews.length).toBe(1);
      expect(deps.resolutions).toEqual([]);
    });

    test("status 'done' retires the sent nudge, guarded on the review's updatedAt", () => {
      const deps = fakeDeps();
      const e = envelope({
        payload: { mrUrl: URL_A, iid: 4821, status: 'done', updatedAt: 500 },
      });
      materializeEnvelope(e, deps, 1000);
      expect(deps.retirements).toEqual([{ mrUrl: URL_A, ifSentBefore: 500 }]);
    });

    test('an in-flight status never retires the sent nudge', () => {
      for (const status of ['queued', 'reviewing'] as const) {
        const deps = fakeDeps();
        const e = envelope({
          payload: { mrUrl: URL_A, iid: 4821, status, updatedAt: 500 },
        });
        materializeEnvelope(e, deps, 1000);
        expect(deps.retirements).toEqual([]);
      }
    });

    test('malformed review-state payload only logs, never writes or resolves', () => {
      const deps = fakeDeps();
      const e = envelope({ from: 'grace', payload: { mrUrl: URL_A } });
      materializeEnvelope(e, deps, 1000);
      expect(deps.peerReviews).toEqual([]);
      expect(deps.resolutions).toEqual([]);
      expect(deps.nudges).toEqual([]);
      expect(deps.logs.length).toBe(1);
      expect(deps.logs[0]).toContain('grace');
      expect(deps.logs[0]).toContain(e.id);
    });
  });

  describe('re-review-request', () => {
    test('writes a nudge from envelope id/from/receivedAt and payload mrUrl/iid/note', () => {
      const deps = fakeDeps();
      const e = envelope({
        id: 'env-42',
        type: 're-review-request',
        from: 'ada',
        receivedAt: 777,
        payload: {
          mrUrl: URL_A,
          iid: 4821,
          note: 'please re-check the migration',
        },
      });
      materializeEnvelope(e, deps, 1000);
      expect(deps.nudges).toEqual([
        {
          id: 'env-42',
          mrUrl: URL_A,
          iid: 4821,
          from: 'ada',
          note: 'please re-check the migration',
          receivedAt: 777,
        },
      ]);
      expect(deps.resolutions).toEqual([]);
      expect(deps.peerReviews).toEqual([]);
    });

    test('malformed re-review-request payload only logs', () => {
      const deps = fakeDeps();
      const e = envelope({
        type: 're-review-request',
        from: 'ada',
        payload: { mrUrl: URL_A },
      });
      materializeEnvelope(e, deps, 1000);
      expect(deps.nudges).toEqual([]);
      expect(deps.logs.length).toBe(1);
    });
  });

  describe('review-request', () => {
    test('writes a kind:"review" nudge from envelope and payload fields', () => {
      const deps = fakeDeps();
      const e = envelope({
        id: 'env-77',
        type: 'review-request',
        from: 'ada',
        receivedAt: 888,
        payload: { mrUrl: URL_A, iid: 4821, note: 'fresh eyes please' },
      });
      materializeEnvelope(e, deps, 1000);
      expect(deps.nudges).toEqual([
        {
          id: 'env-77',
          mrUrl: URL_A,
          iid: 4821,
          from: 'ada',
          note: 'fresh eyes please',
          receivedAt: 888,
          kind: 'review',
        },
      ]);
      expect(deps.resolutions).toEqual([]);
      expect(deps.peerReviews).toEqual([]);
    });

    test('malformed review-request payload only logs', () => {
      const deps = fakeDeps();
      const e = envelope({
        type: 'review-request',
        from: 'ada',
        payload: { iid: 4821 },
      });
      materializeEnvelope(e, deps, 1000);
      expect(deps.nudges).toEqual([]);
      expect(deps.logs.length).toBe(1);
    });
  });

  describe('respond-request', () => {
    test('writes a kind:"respond" nudge', () => {
      const deps = fakeDeps();
      const e = envelope({
        id: 'env-88',
        type: 'respond-request',
        from: 'jo',
        receivedAt: 900,
        payload: { mrUrl: URL_A, iid: 4821 },
      });
      materializeEnvelope(e, deps, 1000);
      expect(deps.nudges).toEqual([
        {
          id: 'env-88',
          mrUrl: URL_A,
          iid: 4821,
          from: 'jo',
          note: undefined,
          receivedAt: 900,
          kind: 'respond',
        },
      ]);
    });
  });

  describe('respond-state', () => {
    test('a non-terminal respond state confirms the sent ask', () => {
      const deps = fakeDeps();
      const e = envelope({
        type: 'respond-state',
        from: 'pat',
        payload: { mrUrl: URL_A, iid: 4821, status: 'triaging', updatedAt: 5 },
      });
      materializeEnvelope(e, deps, 1000);
      expect(deps.resolutions).toEqual([
        { mrUrl: URL_A, resolution: { result: 'confirmed', at: 1000 } },
      ]);
      expect(deps.retirements).toEqual([]);
      expect(deps.peerReviews).toEqual([]);
    });

    test('a done respond state retires the sent ask', () => {
      const deps = fakeDeps();
      const e = envelope({
        type: 'respond-state',
        from: 'pat',
        payload: { mrUrl: URL_A, iid: 4821, status: 'done', updatedAt: 7 },
      });
      materializeEnvelope(e, deps, 1000);
      expect(deps.retirements).toEqual([{ mrUrl: URL_A, ifSentBefore: 7 }]);
      expect(deps.peerReviews).toEqual([]);
    });

    test('a done respond state carrying the nudge id retires by id, not clocks', () => {
      const deps = fakeDeps();
      const e = envelope({
        type: 'respond-state',
        from: 'pat',
        payload: {
          mrUrl: URL_A,
          iid: 4821,
          status: 'done',
          updatedAt: 7,
          nudgeId: 'ask-9',
        },
      });
      materializeEnvelope(e, deps, 1000);
      expect(deps.retirements).toEqual([
        { mrUrl: URL_A, ifSentBefore: 7, nudgeId: 'ask-9' },
      ]);
    });

    test('malformed respond-state only logs', () => {
      const deps = fakeDeps();
      const e = envelope({
        type: 'respond-state',
        from: 'pat',
        payload: { mrUrl: URL_A },
      });
      materializeEnvelope(e, deps, 1000);
      expect(deps.resolutions).toEqual([]);
      expect(deps.logs.length).toBe(1);
    });
  });

  describe('nudge-outcome', () => {
    test('resolves the sent nudge with result/reason/at', () => {
      const deps = fakeDeps();
      const e = envelope({
        type: 'nudge-outcome',
        payload: {
          mrUrl: URL_A,
          iid: 4821,
          nudgeId: 'env-42',
          result: 'launched',
          reason: 'shipped it',
        },
      });
      materializeEnvelope(e, deps, 1000);
      expect(deps.resolutions).toEqual([
        {
          mrUrl: URL_A,
          resolution: { result: 'launched', reason: 'shipped it', at: 1000 },
        },
      ]);
    });

    test('malformed nudge-outcome payload only logs', () => {
      const deps = fakeDeps();
      const e = envelope({
        type: 'nudge-outcome',
        from: 'grace',
        payload: { mrUrl: URL_A, iid: 4821 },
      });
      materializeEnvelope(e, deps, 1000);
      expect(deps.resolutions).toEqual([]);
      expect(deps.logs.length).toBe(1);
    });
  });

  describe('unknown envelope type', () => {
    test('only logs -- no writes, no resolves', () => {
      const deps = fakeDeps();
      const e = envelope({
        type: 'smoke-signal',
        from: 'grace',
        payload: { anything: true },
      });
      materializeEnvelope(e, deps, 1000);
      expect(deps.peerReviews).toEqual([]);
      expect(deps.nudges).toEqual([]);
      expect(deps.resolutions).toEqual([]);
      expect(deps.logs.length).toBe(1);
      expect(deps.logs[0]).toContain('smoke-signal');
      expect(deps.logs[0]).toContain('grace');
    });
  });

  describe('now default', () => {
    test('defaults now to Date.now() when omitted', () => {
      const deps = fakeDeps();
      const before = Date.now();
      const e = envelope({
        type: 'nudge-outcome',
        payload: {
          mrUrl: URL_A,
          iid: 4821,
          nudgeId: 'env-42',
          result: 'rejected',
        },
      });
      materializeEnvelope(e, deps);
      const after = Date.now();
      expect(deps.resolutions.length).toBe(1);
      const at = deps.resolutions[0]!.resolution.at;
      expect(at >= before && at <= after).toBe(true);
    });
  });
});
