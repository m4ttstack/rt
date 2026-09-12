import { describe, expect, test } from 'bun:test';

import type { BoardMRWithReview } from '../../types.ts';
import { needOf } from '../needs-me.ts';

const NOW = Date.parse('2026-09-12T12:00:00Z');
const NONE: ReadonlyMap<string, 'posted' | 'dismissed'> = new Map();
const ME = 'me';

type Over = Record<string, unknown>;
function mr(over: Over = {}): BoardMRWithReview {
  return {
    iid: 1418,
    title: 'ACME-2214 Port the v2 quiet-mode flows',
    webUrl: 'https://gitlab.example.com/acme/webapp/-/merge_requests/1418',
    sourceBranch: 'feature/acme-2214',
    targetBranch: 'main',
    author: { username: 'pat', name: 'Pat' },
    reviews: { isApproved: false, required: 1, given: 0, reviewers: [] },
    blockers: { any: false },
    gates: [],
    ...over,
  } as unknown as BoardMRWithReview;
}
const own = (over: Over = {}) =>
  mr({ author: { username: 'me', name: 'Me' }, ...over });
const reviewing = (reviewState: string, over: Over = {}) =>
  mr({
    reviews: {
      isApproved: false,
      required: 1,
      given: 0,
      reviewers: [{ username: 'me', name: 'Me', reviewState }],
    },
    ...over,
  });
const need = (m: BoardMRWithReview) => needOf(m, ME, NOW, NONE);

const orphan = {
  agentId: 'ag-1',
  repo: null,
  subject: 'agent:ag-1',
  surface: 'herdr',
  sessionId: 'sess-1',
  paneRef: null,
  state: 'gone',
  since: NOW - 60_000,
  openGateIds: [],
};
const gate = (status: string, over: Over = {}) => ({
  gateId: 'g1',
  subject: 'mr:u',
  kind: 'review-post',
  label: 'review',
  status,
  openedAt: NOW - 60_000,
  questions: [{ id: 'q', label: 'Post which findings?', options: ['a'] }],
  ...over,
});

describe("needOf: hot rows are the seat's move whoever authored them", () => {
  test('an open gate is a decision', () => {
    expect(need(mr({ gates: [gate('open')] }))).toBe('decide');
  });

  test('a held doctor draft is a decision', () => {
    expect(
      need(mr({ drafts: [{ kind: 'note', body: 'x', createdAt: NOW }] }))
    ).toBe('decide');
  });

  test('stuck delivery, an interrupted lane and a failed lane all need unsticking', () => {
    expect(
      need(
        mr({ gates: [gate('answered', { delivery: { outcome: 'stuck' } })] })
      )
    ).toBe('unstick');
    expect(
      need(mr({ review: { status: 'reviewing', sessionId: 'sess-1' }, orphan }))
    ).toBe('unstick');
    expect(need(mr({ review: { status: 'error' } }))).toBe('unstick');
    expect(need(mr({ doctor: { status: 'error' } }))).toBe('unstick');
  });

  test('a peer asking for a re-review is a re-review', () => {
    expect(need(mr({ nudges: [{ from: 'jo', receivedAt: NOW }] }))).toBe(
      're-review'
    );
  });

  test("a working agent has the row: nobody's move, even with threads awaiting the author", () => {
    expect(need(mr({ review: { status: 'reviewing' } }))).toBeNull();
    expect(
      need(
        own({
          respond: { status: 'triaging' },
          threadSummary: { awaiting: 2, replied: 0, resolved: 0 },
        })
      )
    ).toBeNull();
  });
});

describe('needOf: my own MR', () => {
  test('threads awaiting me, or changes requested, need a response', () => {
    expect(
      need(own({ threadSummary: { awaiting: 2, replied: 0, resolved: 0 } }))
    ).toBe('respond');
    expect(
      need(
        own({
          reviews: {
            isApproved: false,
            required: 1,
            given: 0,
            reviewers: [{ username: 'jo', reviewState: 'REQUESTED_CHANGES' }],
          },
        })
      )
    ).toBe('respond');
  });

  test('conflicts or a failing pipeline need a fix', () => {
    expect(need(own({ blockers: { any: true, hasConflicts: true } }))).toBe(
      'fix'
    );
    expect(need(own({ blockers: { any: true, pipelineFailing: true } }))).toBe(
      'fix'
    );
  });

  test('approved and unblocked is a merge; merely waiting on reviewers is nothing', () => {
    expect(
      need(
        own({
          reviews: { isApproved: true, required: 1, given: 1, reviewers: [] },
        })
      )
    ).toBe('merge');
    expect(need(own())).toBeNull();
  });
});

describe("needOf: someone else's MR", () => {
  test('nothing unless I am an assigned reviewer', () => {
    expect(need(mr())).toBeNull();
    expect(
      need(mr({ threadSummary: { awaiting: 3, replied: 0, resolved: 0 } }))
    ).toBeNull();
  });

  test('assigned and not started, or started and left, is a review', () => {
    expect(need(reviewing('UNREVIEWED'))).toBe('review');
    expect(need(reviewing('REVIEW_STARTED'))).toBe('review');
  });

  test('an approval reset by a new push is a re-review', () => {
    expect(need(reviewing('UNAPPROVED'))).toBe('re-review');
  });

  test('my threads answered or resolved is a re-review; still awaiting the author is nothing', () => {
    expect(
      need(
        reviewing('REVIEWED', {
          myThreads: { awaiting: 0, replied: 1, resolved: 1 },
        })
      )
    ).toBe('re-review');
    expect(
      need(
        reviewing('REVIEWED', {
          myThreads: { awaiting: 1, replied: 0, resolved: 0 },
        })
      )
    ).toBeNull();
    expect(need(reviewing('REVIEWED'))).toBeNull();
  });

  test('my approval stands: nothing to do', () => {
    expect(
      need(
        reviewing('APPROVED', {
          myThreads: { awaiting: 0, replied: 2, resolved: 0 },
        })
      )
    ).toBeNull();
  });
});
