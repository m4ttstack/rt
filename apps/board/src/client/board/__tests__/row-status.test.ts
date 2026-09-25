import { describe, expect, test } from 'bun:test';

import type { BoardMRWithReview } from '../../types.ts';
import {
  candidateLines,
  DELIVERY_STUCK_MESSAGE,
  EXECUTION_UNASSIGNED_MESSAGE,
  rowStatus,
  statusPhrase,
  statusReasons,
} from '../row-status.ts';

const NOW = Date.parse('2026-09-12T12:00:00Z');
const NONE: ReadonlyMap<string, 'posted' | 'dismissed'> = new Map();
const ME = 'me';

function mr(over: Partial<BoardMRWithReview> = {}): BoardMRWithReview {
  return {
    iid: 1418,
    title: 'ACME-2214 Port the v2 quiet-mode flows',
    webUrl: 'https://gitlab.example.com/acme/webapp/-/merge_requests/1418',
    sourceBranch: 'feature/acme-2214',
    targetBranch: 'main',
    author: { username: 'pat', name: 'Pat' },
    reviews: {
      isApproved: false,
      required: 1,
      given: 0,
      remaining: 1,
      reviewers: [],
    },
    blockers: { any: false },
    mergeButton: { visible: false, disabled: false, loading: false },
    gates: [],
    ...over,
  } as unknown as BoardMRWithReview;
}

const gate = (over: Record<string, unknown> = {}) => ({
  gateId: 'g1',
  subject: 'mr:https://gitlab.example.com/acme/webapp/-/merge_requests/1418',
  kind: 'review-post',
  label: 'review',
  status: 'open',
  openedAt: NOW - 60_000,
  questions: [
    {
      id: 'tiers',
      label: 'Post which findings?',
      multi: true,
      options: ['Minor'],
    },
  ],
  ...over,
});

type Over = Record<string, unknown>;
const own = (over: Over = {}) =>
  mr({ author: { username: 'me', name: 'Me' }, ...over } as never);
const settled = (over: Over = {}) =>
  mr({
    reviews: { isApproved: true, required: 1, given: 1, reviewers: [] },
    blockers: { any: false },
    threadSummary: { awaiting: 0, replied: 0, resolved: 2 },
    ...over,
  } as never);
const unapproved = (given: number, required: number) => ({
  reviews: {
    isApproved: false,
    required,
    given,
    remaining: required - given,
    reviewers: [],
  },
});
const blockedBy = (flags: Over) => ({ blockers: { any: true, ...flags } });
const MERGEABLE = {
  mergeButton: { visible: true, disabled: false, loading: false },
};

describe('rowStatus: the quiet row', () => {
  test("someone else's settled MR earns the sun: all clear, open verb, no bar", () => {
    const s = rowStatus(settled(), NOW, NONE, ME);
    expect(s.line.tone).toBe('clear');
    expect(s.line.word).toBe('all clear');
    expect(s.line.detail).toBeUndefined();
    expect(s.line.verbs.map(v => v.kind)).toEqual(['open-mr']);
    expect(s.more).toEqual([]);
    expect(s.bar).toBeNull();
  });

  test("someone else's unapproved MR: the review verb, and who has approved so far (the pill already says needs review)", () => {
    const [line] = candidateLines(mr(), NOW, NONE, ME);
    expect(line).toMatchObject({
      tone: 'quiet',
      word: 'no approvals yet',
      verbs: [{ kind: 'launch-review', label: 'review' }],
    });
    expect(line!.detail).toBeUndefined();
    const [tally] = candidateLines(
      mr(unapproved(1, 2) as never),
      NOW,
      NONE,
      ME
    );
    expect(tally!.word).toBe('1 of 2 approvals');
    const [named] = candidateLines(
      mr({
        reviews: {
          isApproved: false,
          required: 2,
          given: 1,
          reviewers: [
            { username: 'tom', name: 'Tom', reviewState: 'APPROVED' },
            { username: 'bea', name: 'Bea', reviewState: 'UNREVIEWED' },
          ],
        },
      } as never),
      NOW,
      NONE,
      ME
    );
    expect(named!.word).toBe('Tom approved');
    expect(named!.detail).toBeUndefined();
    const [noRule] = candidateLines(
      mr(unapproved(0, 0) as never),
      NOW,
      NONE,
      ME
    );
    expect(noRule!.word).toBe('no review yet');
  });

  test("conflicts on someone else's unapproved MR do not change whose move it is", () => {
    const [line] = candidateLines(
      mr(blockedBy({ hasConflicts: true, pipelineFailing: true }) as never),
      NOW,
      NONE,
      ME
    );
    expect(line!.word).toBe('no approvals yet');
    expect(line!.verbs[0]!.kind).toBe('launch-review');
  });

  test('threads awaiting the author, or an approved MR still blocked, wait on the author', () => {
    const [threads] = candidateLines(
      mr({ threadSummary: { awaiting: 2, replied: 0, resolved: 0 } }),
      NOW,
      NONE,
      ME
    );
    expect(threads).toMatchObject({
      tone: 'quiet',
      word: 'waiting on the author',
      verbs: [{ kind: 'open-mr' }],
    });
    const [rebase] = candidateLines(
      settled(blockedBy({ hasConflicts: true })),
      NOW,
      NONE,
      ME
    );
    expect(rebase).toMatchObject({
      word: 'waiting on the author',
      detail: 'for a rebase',
    });
  });

  test('my own MR: a settled one is ready to merge (go), never the sun', () => {
    const [line] = candidateLines(
      settled({ author: { username: 'me', name: 'Me' } }),
      NOW,
      NONE,
      ME
    );
    expect(line).toMatchObject({
      tone: 'go',
      word: 'ready to merge',
      verbs: [{ kind: 'open-mr' }],
    });
  });

  test('my own MR: repair first, worded by what the doctor would do', () => {
    const [both] = candidateLines(
      own(blockedBy({ hasConflicts: true, pipelineFailing: true })),
      NOW,
      NONE,
      ME
    );
    expect(both).toMatchObject({
      tone: 'quiet',
      word: 'needs a rebase and a ci fix',
      verbs: [{ kind: 'call-doctor', label: 'call doctor' }],
    });
    const [ci] = candidateLines(
      own(blockedBy({ pipelineFailing: true })),
      NOW,
      NONE,
      ME
    );
    expect(ci!.word).toBe('needs a ci fix');
    const [rebase] = candidateLines(
      own(blockedBy({ needsRebase: true })),
      NOW,
      NONE,
      ME
    );
    expect(rebase!.word).toBe('needs a rebase');
  });

  test('my own MR: threads awaiting me carry the respond verb; otherwise I wait on reviewers', () => {
    const [one] = candidateLines(
      own({ threadSummary: { awaiting: 1, replied: 0, resolved: 0 } }),
      NOW,
      NONE,
      ME
    );
    expect(one).toMatchObject({
      word: 'a thread awaits you',
      verbs: [{ kind: 'launch-respond', label: 'respond' }],
    });
    const [three] = candidateLines(
      own({ threadSummary: { awaiting: 3, replied: 1, resolved: 0 } }),
      NOW,
      NONE,
      ME
    );
    expect(three!.word).toBe('3 threads await you');
    const [waiting] = candidateLines(own(unapproved(1, 2)), NOW, NONE, ME);
    expect(waiting).toMatchObject({
      tone: 'quiet',
      word: 'waiting on reviewers',
      detail: '1 of 2 approvals',
      verbs: [{ kind: 'open-mr' }],
    });
  });

  test('a running pipeline is a working line for either seat', () => {
    const [theirs] = candidateLines(
      settled(blockedBy({ pipelineRunning: true })),
      NOW,
      NONE,
      ME
    );
    expect(theirs).toMatchObject({
      tone: 'work',
      word: 'ci running…',
      spin: true,
    });
    const [mine] = candidateLines(
      own(blockedBy({ pipelineRunning: true })),
      NOW,
      NONE,
      ME
    );
    expect(mine!.word).toBe('ci running…');
  });

  test('as an assigned reviewer: the author answering my threads, or a push resetting my approval, is my move again', () => {
    const asMe = (reviewState: string, over: Over = {}) =>
      mr({
        reviews: {
          isApproved: true,
          required: 1,
          given: 1,
          reviewers: [{ username: 'me', name: 'Me', reviewState }],
        },
        blockers: { any: false },
        threadSummary: { awaiting: 0, replied: 2, resolved: 1 },
        ...over,
      } as never);
    const [answered] = candidateLines(
      asMe('REVIEWED', { myThreads: { awaiting: 0, replied: 2, resolved: 0 } }),
      NOW,
      NONE,
      ME
    );
    expect(answered).toMatchObject({
      tone: 'quiet',
      word: 'author answered you',
      detail: '2 threads',
      verbs: [{ kind: 'open-mr' }],
    });
    const [reset] = candidateLines(asMe('UNAPPROVED'), NOW, NONE, ME);
    expect(reset).toMatchObject({
      word: 'your approval was reset',
      verbs: [{ kind: 'launch-review', label: 'review' }],
    });
    const [stillMine] = candidateLines(
      asMe('REVIEWED', {
        threadSummary: { awaiting: 1, replied: 1, resolved: 0 },
        myThreads: { awaiting: 1, replied: 1, resolved: 0 },
      }),
      NOW,
      NONE,
      ME
    );
    expect(stillMine!.word).toBe('waiting on the author');
    const [approved] = candidateLines(
      asMe('APPROVED', { myThreads: { awaiting: 0, replied: 2, resolved: 0 } }),
      NOW,
      NONE,
      ME
    );
    expect(approved!.word).toBe('all clear');
  });

  test('with no self, every row reads from the reviewer seat', () => {
    const [line] = candidateLines(
      settled({ author: { username: 'me', name: 'Me' } }),
      NOW,
      NONE,
      null
    );
    expect(line!.word).toBe('all clear');
  });
});

describe('rowStatus: review lane', () => {
  test('queued is quiet with the lane prefix', () => {
    const [line] = candidateLines(
      mr({ review: { status: 'queued' } }),
      NOW,
      NONE,
      ME
    );
    expect(line).toMatchObject({
      tone: 'quiet',
      word: 'review queued',
      verbs: [],
    });
  });

  test('reviewing is a working line with a spinner, the started-ago detail and a muted focus verb', () => {
    const [line] = candidateLines(
      mr({ review: { status: 'reviewing', startedAt: NOW - 4 * 60_000 } }),
      NOW,
      NONE,
      ME
    );
    expect(line).toMatchObject({
      tone: 'work',
      word: 'review running…',
      spin: true,
      detail: 'started 4m ago',
    });
    expect(line!.verbs).toEqual([
      { kind: 'focus', label: 'focus', domain: 'review' },
    ]);
  });

  test('done with a report is a go line whose verb opens the review; the outcome stays off the line once the pill shows the approval', () => {
    const review = {
      status: 'done',
      reportReady: true,
      outcome: 'approve',
    } as const;
    const [line] = candidateLines(mr({ review }), NOW, NONE, ME);
    expect(line).toMatchObject({
      tone: 'go',
      word: 'review ready',
      detail: 'approved',
    });
    expect(line!.verbs[0]).toEqual({ kind: 'read-review', label: 'read ↗' });
    const [posted] = candidateLines(
      mr({ review, ...settled() } as never),
      NOW,
      NONE,
      ME
    );
    expect(posted!.word).toBe('review ready');
    expect(posted!.detail).toBeUndefined();
    const [commented] = candidateLines(
      mr({ review: { ...review, outcome: 'comment' }, ...settled() } as never),
      NOW,
      NONE,
      ME
    );
    expect(commented!.detail).toBe('commented');
  });

  test('error is a bad line with the launch-again verb and a red bar', () => {
    const s = rowStatus(
      mr({
        review: {
          status: 'error',
          message: 'pane closed',
        },
      }),
      NOW,
      NONE,
      ME
    );
    expect(s.line).toMatchObject({
      tone: 'bad',
      word: 'review failed',
      detail: 'pane closed',
    });
    expect(s.line.verbs[0]).toEqual({
      kind: 'launch-review',
      label: 'launch again',
    });
    expect(s.bar).toBe('bad');
  });
});

describe('rowStatus: interrupted executor', () => {
  const orphan = {
    agentId: 'ag-1',
    repo: 'acme/webapp',
    subject: 'agent:ag-1',
    surface: 'herdr',
    sessionId: 'sess-1',
    paneRef: null,
    state: 'gone' as const,
    since: NOW - 12 * 60_000,
    openGateIds: [],
  };

  test('a gone orphan on a running review is the warn line with relaunch then clear', () => {
    const s = rowStatus(
      mr({ review: { status: 'reviewing', sessionId: 'sess-1' }, orphan }),
      NOW,
      NONE,
      ME
    );
    expect(s.line).toMatchObject({
      tone: 'warn',
      word: 'review interrupted',
      detail: 'pane closed 12m ago',
    });
    expect(s.line.verbs).toEqual([
      { kind: 'relaunch', label: 'relaunch', domain: 'review' },
      { kind: 'clear', label: 'clear', agentId: 'ag-1' },
    ]);
    expect(s.bar).toBe('warn');
    // The review lane itself must not also emit a running line.
    expect(s.more).toEqual([]);
  });

  test('a gone orphan on a running response names the response lane', () => {
    const s = rowStatus(
      mr({ respond: { status: 'implementing', sessionId: 'sess-1' }, orphan }),
      NOW,
      NONE,
      ME
    );
    expect(s.line.word).toBe('response interrupted');
    expect(s.line.verbs[0]).toEqual({
      kind: 'relaunch',
      label: 'relaunch',
      domain: 'respond',
    });
  });

  test('a hidden orphan is a quiet off-screen line with a focus verb', () => {
    const [line] = candidateLines(
      mr({
        review: { status: 'reviewing', sessionId: 'sess-1' },
        orphan: { ...orphan, state: 'hidden' },
      }),
      NOW,
      NONE,
      ME
    );
    expect(line).toMatchObject({
      tone: 'quiet',
      word: 'off-screen',
      detail: 'pane hidden, still running',
    });
    expect(line!.verbs[0]).toEqual({
      kind: 'focus',
      label: 'focus',
      domain: 'review',
    });
    const [idle] = candidateLines(
      mr({ orphan: { ...orphan, state: 'hidden' } }),
      NOW,
      NONE,
      ME
    );
    expect(idle!.verbs).toEqual([]);
  });

  test('a queued review (no session yet) is interrupted by a gone orphan', () => {
    const s = rowStatus(
      mr({ review: { status: 'queued' }, orphan }),
      NOW,
      NONE,
      ME
    );
    expect(s.line).toMatchObject({ tone: 'warn', word: 'review interrupted' });
    expect(s.line.verbs.map(v => v.kind)).toEqual(['relaunch', 'clear']);
    expect(s.more).toEqual([]);
    expect(s.bar).toBe('warn');
  });

  test('a done review keeps its ready line; the gone orphan is a quiet pane-gone line', () => {
    const s = rowStatus(
      mr({
        review: {
          status: 'done',
          reportReady: true,
          outcome: 'approve',
          sessionId: 'sess-1',
        },
        orphan,
      }),
      NOW,
      NONE,
      ME
    );
    expect(s.line).toMatchObject({ tone: 'go', word: 'review ready' });
    expect(s.line.verbs).toEqual([{ kind: 'read-review', label: 'read ↗' }]);
    expect(s.more).toEqual([
      {
        tone: 'quiet',
        word: 'pane gone',
        detail: 'pane closed 12m ago',
        verbs: [{ kind: 'clear', label: 'clear', agentId: 'ag-1' }],
      },
    ]);
    expect(s.bar).toBeNull();
  });

  test('a doctor-only row with a gone orphan keeps the doctor line and counts the pane', () => {
    const s = rowStatus(
      mr({ doctor: { status: 'fixing', origin: 'manual' }, orphan }),
      NOW,
      NONE,
      ME
    );
    expect(s.line).toMatchObject({ tone: 'work', word: 'fixing…' });
    expect(s.more.map(l => l.word)).toEqual(['pane gone']);
    expect(s.bar).toBeNull();
  });

  test('no lane at all with a gone orphan is the quiet pane-gone line with clear only', () => {
    const s = rowStatus(mr({ orphan }), NOW, NONE, ME);
    expect(s.line).toMatchObject({
      tone: 'quiet',
      word: 'pane gone',
      detail: 'pane closed 12m ago',
    });
    expect(s.line.verbs).toEqual([
      { kind: 'clear', label: 'clear', agentId: 'ag-1' },
    ]);
    expect(s.more).toEqual([]);
    expect(s.bar).toBeNull();
  });

  test('a lane relaunched on a fresh session is not interrupted by the old pane', () => {
    const s = rowStatus(
      mr({ review: { status: 'reviewing', sessionId: 'sess-2' }, orphan }),
      NOW,
      NONE,
      ME
    );
    expect(s.line.word).toBe('review running…');
    expect(s.more.map(l => l.word)).toEqual(['pane gone']);
  });
});

describe('rowStatus: gates', () => {
  test('an open gate is the decide line: the first question, lowercased, with answer', () => {
    const s = rowStatus(mr({ gates: [gate()] as never }), NOW, NONE, ME);
    expect(s.line).toMatchObject({
      tone: 'warn',
      word: 'post which findings?',
    });
    expect(s.line.verbs).toEqual([
      { kind: 'answer', label: 'answer', gateId: 'g1' },
    ]);
  });

  test('a parked gate says so in the detail', () => {
    const [line] = candidateLines(
      mr({ gates: [gate({ status: 'parked' })] as never }),
      NOW,
      NONE,
      ME
    );
    expect(line!.detail).toBe('parked');
  });

  test('decide beats interrupted: same tone, gates come first', () => {
    const s = rowStatus(
      mr({
        gates: [gate()] as never,
        review: { status: 'reviewing', sessionId: 'sess-1' },
        orphan: {
          agentId: 'ag-1',
          repo: null,
          subject: 'agent:ag-1',
          surface: 'herdr',
          sessionId: 'sess-1',
          paneRef: null,
          state: 'gone',
          since: NOW,
          openGateIds: [],
        },
      }),
      NOW,
      NONE,
      ME
    );
    expect(s.line.word).toBe('post which findings?');
    expect(s.more.map(l => l.word)).toEqual(['review interrupted']);
  });

  test('a stuck delivery is a bad line whose retry opens the queue', () => {
    const s = rowStatus(
      mr({
        gates: [
          gate({
            status: 'answered',
            answers: { tiers: [] },
            delivery: { outcome: 'stuck', at: NOW },
          }),
        ] as never,
      }),
      NOW,
      NONE,
      ME
    );
    expect(s.line).toMatchObject({ tone: 'bad', word: DELIVERY_STUCK_MESSAGE });
    expect(s.line.verbs).toEqual([
      { kind: 'answer', label: 'retry', gateId: 'g1' },
    ]);
  });

  test('an unassigned execution is a bad line whose relaunch opens the queue', () => {
    const s = rowStatus(
      mr({
        gates: [
          gate({
            status: 'answered',
            answers: { tiers: [] },
            execution: 'unassigned',
          }),
        ] as never,
      }),
      NOW,
      NONE,
      ME
    );
    expect(s.line).toMatchObject({
      tone: 'bad',
      word: EXECUTION_UNASSIGNED_MESSAGE,
    });
    expect(s.line.verbs).toEqual([
      { kind: 'answer', label: 'relaunch', gateId: 'g1' },
    ]);
  });

  test('a plainly answered gate is a quiet answered line with the answers as detail', () => {
    const [line] = candidateLines(
      mr({
        gates: [
          gate({
            status: 'answered',
            answers: { tiers: ['Minor'], outcome: 'comment' },
          }),
        ] as never,
      }),
      NOW,
      NONE,
      ME
    );
    expect(line).toMatchObject({
      tone: 'quiet',
      word: 'answered',
      detail: 'Minor, comment',
      verbs: [],
    });
  });

  test('an answer wrapped with a note unwraps to its value, not [object Object]', () => {
    const [line] = candidateLines(
      mr({
        gates: [
          gate({
            status: 'answered',
            answers: {
              tiers: { value: 'Minor', note: 'small nit' },
              outcome: 'leave-parent',
            },
          }),
        ] as never,
      }),
      NOW,
      NONE,
      ME
    );
    expect(line).toMatchObject({
      tone: 'quiet',
      word: 'answered',
      detail: 'Minor, leave-parent',
      verbs: [],
    });
  });
});

describe('rowStatus: respond lane', () => {
  test('in-flight statuses are working lines with spinners', () => {
    for (const [status, word] of [
      ['triaging', 'triaging…'],
      ['implementing', 'implementing…'],
      ['drafting', 'drafting replies…'],
    ] as const) {
      const [line] = candidateLines(mr({ respond: { status } }), NOW, NONE, ME);
      expect(line).toMatchObject({ tone: 'work', word, spin: true });
      expect(line!.verbs[0]).toEqual({
        kind: 'focus',
        label: 'focus',
        domain: 'respond',
      });
    }
  });

  test('done and fully posted is go with the read verb', () => {
    const [line] = candidateLines(
      mr({
        respond: { status: 'done', posted: 3, threads: 3, reportReady: true },
      }),
      NOW,
      NONE,
      ME
    );
    expect(line).toMatchObject({
      tone: 'go',
      word: 'replies posted',
      detail: '3 of 3',
    });
    expect(line!.verbs[0]).toEqual({ kind: 'read-respond', label: 'read ↗' });
  });

  test('posted but the reviewer came back: warn with respond again leading', () => {
    const [line] = candidateLines(
      mr({
        respond: { status: 'done', posted: 3, threads: 3, reportReady: true },
        threadSummary: { awaiting: 2, replied: 1, resolved: 0 },
      } as never),
      NOW,
      NONE,
      ME
    );
    expect(line).toMatchObject({
      tone: 'warn',
      word: 'replies posted',
      detail: 'reviewer came back',
    });
    expect(line!.verbs).toEqual([
      { kind: 'restart-respond', label: 'respond again' },
      { kind: 'read-respond', label: 'read ↗' },
    ]);
  });

  test('the changes-requested badge alone does not reopen a posted line', () => {
    const [line] = candidateLines(
      mr({
        respond: { status: 'done', posted: 3, threads: 3, reportReady: true },
        threadSummary: { awaiting: 0, replied: 3, resolved: 0 },
        reviews: {
          isApproved: false,
          required: 1,
          given: 0,
          reviewers: [{ username: 'pat', reviewState: 'REQUESTED_CHANGES' }],
        },
      } as never),
      NOW,
      NONE,
      ME
    );
    expect(line).toMatchObject({
      tone: 'go',
      word: 'replies posted',
      detail: '3 of 3',
    });
    expect(line!.verbs).toEqual([{ kind: 'read-respond', label: 'read ↗' }]);
  });

  test('partially posted is warn with the resume verb', () => {
    const [line] = candidateLines(
      mr({
        respond: { status: 'done', posted: 2, threads: 3, sessionId: 's' },
      }),
      NOW,
      NONE,
      ME
    );
    expect(line).toMatchObject({
      tone: 'warn',
      word: '2 of 3 posted',
      detail: 'one thread waiting',
    });
    expect(line!.verbs[0]).toEqual({
      kind: 'resume-respond',
      label: 'resume ↗',
    });
  });

  test('a held reply finishes the run: go tone, no resume', () => {
    const [line] = candidateLines(
      mr({
        respond: {
          status: 'done',
          posted: 1,
          threads: 2,
          held: 1,
          reportReady: true,
        },
      }),
      NOW,
      NONE,
      ME
    );
    expect(line).toMatchObject({
      tone: 'go',
      word: 'replies posted',
      detail: '1 posted, 1 held',
    });
    expect(line!.verbs[0]).toEqual({ kind: 'read-respond', label: 'read ↗' });
  });

  test('a held thread still awaiting on GitLab is not the reviewer coming back', () => {
    const [line] = candidateLines(
      mr({
        respond: { status: 'done', posted: 1, threads: 2, held: 1 },
        threadSummary: { awaiting: 1, replied: 1, resolved: 0 },
      } as never),
      NOW,
      NONE,
      ME
    );
    expect(line).toMatchObject({ tone: 'go', word: 'replies posted' });
  });

  test('awaiting beyond the held threads is the reviewer coming back', () => {
    const [line] = candidateLines(
      mr({
        respond: { status: 'done', posted: 1, threads: 2, held: 1 },
        threadSummary: { awaiting: 2, replied: 1, resolved: 0 },
      } as never),
      NOW,
      NONE,
      ME
    );
    expect(line).toMatchObject({
      tone: 'warn',
      word: 'replies posted',
      detail: 'reviewer came back',
    });
  });

  test('every reply held per gate is a clean finish, not a drafted nag', () => {
    const [line] = candidateLines(
      mr({
        respond: { status: 'done', posted: 0, threads: 2, held: 2 },
      }),
      NOW,
      NONE,
      ME
    );
    expect(line).toMatchObject({
      tone: 'go',
      word: 'replies held',
      detail: '2 of 2 held',
    });
    expect(line!.verbs.some(v => v.kind === 'resume-respond')).toBe(false);
  });

  test('a held thread shrinks the waiting count on a partial finish', () => {
    const [line] = candidateLines(
      mr({
        respond: {
          status: 'done',
          posted: 1,
          threads: 4,
          held: 1,
          sessionId: 's',
        },
      }),
      NOW,
      NONE,
      ME
    );
    expect(line).toMatchObject({
      tone: 'warn',
      word: '1 of 4 posted',
      detail: '2 threads waiting',
    });
  });

  test('drafted but not posted is warn with resume', () => {
    const [line] = candidateLines(
      mr({
        respond: { status: 'done', posted: 0, threads: 2, sessionId: 's' },
      }),
      NOW,
      NONE,
      ME
    );
    expect(line).toMatchObject({ tone: 'warn', word: 'drafted, not posted' });
  });

  test('error is bad with restart', () => {
    const [line] = candidateLines(
      mr({ respond: { status: 'error' } }),
      NOW,
      NONE,
      ME
    );
    expect(line).toMatchObject({ tone: 'bad', word: 'response failed' });
    expect(line!.verbs[0]).toEqual({
      kind: 'restart-respond',
      label: 'restart',
    });
  });

  test('done with no posted/threads counts is a quiet response-done line', () => {
    const [line] = candidateLines(
      mr({ respond: { status: 'done' } }),
      NOW,
      NONE,
      ME
    );
    expect(line).toMatchObject({ tone: 'quiet', word: 'response done' });
  });
});

describe('rowStatus: doctor lane', () => {
  test('an auto doctor watching CI is a working line with the auto detail', () => {
    const [line] = candidateLines(
      mr({ doctor: { status: 'watching', origin: 'auto' } }),
      NOW,
      NONE,
      ME
    );
    expect(line).toMatchObject({
      tone: 'work',
      word: 'watching CI…',
      detail: 'auto',
      spin: true,
    });
  });

  test('stuck is bad with call again', () => {
    const [line] = candidateLines(
      mr({ doctor: { status: 'error' } }),
      NOW,
      NONE,
      ME
    );
    expect(line).toMatchObject({ tone: 'bad', word: 'doctor stuck' });
    expect(line!.verbs).toEqual([
      { kind: 'call-doctor', label: 'call again' },
      { kind: 'dismiss', label: 'dismiss', domain: 'doctor' },
    ]);
  });

  test('stood down outranks a stuck doctor and never expires like a finished run does', () => {
    const [line] = candidateLines(
      mr({
        standDown: true,
        doctor: { status: 'error', message: 'registry push flake' },
      }),
      NOW,
      NONE,
      ME
    );
    expect(line).toMatchObject({ tone: 'quiet', word: 'auto-doctor off' });
    expect(line!.verbs).toEqual([]);
  });

  test('stood down with no doctor row at all still shows the mute', () => {
    const [line] = candidateLines(mr({ standDown: true }), NOW, NONE, ME);
    expect(line).toMatchObject({ tone: 'quiet', word: 'auto-doctor off' });
  });

  test('a dismissed lane says nothing: the row falls through to its next line', () => {
    const [line] = candidateLines(
      mr({ doctor: { status: 'error', dismissedAt: 100 } }),
      NOW,
      NONE,
      ME
    );
    expect(line!.word).not.toBe('doctor stuck');
    // The state layer drops the stamp on any other write, so a relaunched
    // lane arrives here without one and speaks again.
    const [back] = candidateLines(
      mr({ doctor: { status: 'error' } }),
      NOW,
      NONE,
      ME
    );
    expect(back!.word).toBe('doctor stuck');
  });

  test('review and response failures carry the same dismiss secondary', () => {
    const [review] = candidateLines(
      mr({ review: { status: 'error' } }),
      NOW,
      NONE,
      ME
    );
    expect(review!.verbs[1]).toEqual({
      kind: 'dismiss',
      label: 'dismiss',
      domain: 'review',
    });
    const [respond] = candidateLines(
      mr({ respond: { status: 'error' } }),
      NOW,
      NONE,
      ME
    );
    expect(respond!.verbs[1]).toEqual({
      kind: 'dismiss',
      label: 'dismiss',
      domain: 'respond',
    });
  });

  test('a fresh done run is a quiet note with the message and a dismiss', () => {
    const [line] = candidateLines(
      mr({
        doctor: {
          status: 'done',
          message: 'rebased on target',
          updatedAt: NOW - 20 * 60_000,
        },
      }),
      NOW,
      NONE,
      ME
    );
    expect(line).toMatchObject({
      tone: 'quiet',
      word: 'diagnosed',
      detail: 'rebased on target',
    });
    expect(line!.verbs.map(v => v.kind)).toEqual(['dismiss']);
  });

  // Yesterday's run was standing in front of what the MR needs: a finished
  // doctor stops being a candidate once it is stale.
  test('a stale done run stops speaking and the standing state takes the line', () => {
    const stale = mr({
      doctor: {
        status: 'done',
        message: 'rebased on target',
        updatedAt: NOW - 25 * 3600_000,
      },
    } as never);
    expect(
      candidateLines(stale, NOW, NONE, ME).some(l => l.word === 'diagnosed')
    ).toBe(false);
    expect(rowStatus(stale, NOW, NONE, ME).line.tone).toBe('quiet');
  });
});

describe('rowStatus: social lanes', () => {
  test('an inbound nudge is warn with the re-review verb and the age', () => {
    const [line] = candidateLines(
      mr({ nudges: [{ from: 'jo', receivedAt: NOW - 30 * 60_000 }] }),
      NOW,
      NONE,
      ME
    );
    expect(line).toMatchObject({
      tone: 'warn',
      word: 'jo asked for a re-review',
      detail: '30m ago',
    });
    expect(line!.verbs[0]).toEqual({ kind: 're-review', label: 're-review' });
  });

  test('an inbound first-look ask words a review and verbs a plain launch', () => {
    const [line] = candidateLines(
      mr({
        nudges: [{ from: 'jo', receivedAt: NOW - 30 * 60_000, kind: 'review' }],
      }),
      NOW,
      NONE,
      ME
    );
    expect(line).toMatchObject({
      tone: 'warn',
      word: 'jo asked for a review',
      detail: '30m ago',
    });
    expect(line!.verbs[0]).toEqual({ kind: 'launch-review', label: 'review' });
  });

  test('a sent first-look ask words review in every phase', () => {
    const [asked] = candidateLines(
      mr({
        sentNudge: {
          display: 'requested',
          reviewer: 'jo',
          sentAt: NOW - 30 * 60_000,
          kind: 'review',
        } as never,
      }),
      NOW,
      NONE,
      ME
    );
    expect(asked).toMatchObject({
      tone: 'quiet',
      word: 'asked jo for a review',
      detail: 'no answer yet, 30m ago',
    });
    const [retry] = candidateLines(
      mr({
        sentNudge: {
          display: 'expired',
          reviewer: 'jo',
          sentAt: NOW,
          kind: 'review',
        } as never,
      }),
      NOW,
      NONE,
      ME
    );
    expect(retry).toMatchObject({
      tone: 'quiet',
      word: 'review ask to jo went unanswered',
      detail: 'right-click to ask again',
    });
    const [working] = candidateLines(
      mr({
        sentNudge: {
          display: 'confirmed',
          reviewer: 'jo',
          kind: 'review',
        } as never,
      }),
      NOW,
      NONE,
      ME
    );
    expect(working).toMatchObject({
      tone: 'work',
      word: 'jo reviewing…',
      spin: true,
    });
  });

  test('an inbound respond ask words a response and verbs a respond launch', () => {
    const [line] = candidateLines(
      mr({
        nudges: [
          { from: 'jo', receivedAt: NOW - 10 * 60_000, kind: 'respond' },
        ],
      }),
      NOW,
      NONE,
      ME
    );
    expect(line).toMatchObject({
      tone: 'warn',
      word: 'jo asked for a response',
      detail: '10m ago',
    });
    expect(line!.verbs[0]).toEqual({
      kind: 'launch-respond',
      label: 'respond',
    });
  });

  test('a sent respond ask words respond in every phase', () => {
    const [asked] = candidateLines(
      mr({
        sentNudge: {
          display: 'requested',
          reviewer: 'pat',
          sentAt: NOW - 30 * 60_000,
          kind: 'respond',
        } as never,
      }),
      NOW,
      NONE,
      ME
    );
    expect(asked).toMatchObject({
      tone: 'quiet',
      word: 'asked pat to respond',
    });
    const [retry] = candidateLines(
      mr({
        sentNudge: {
          display: 'no-response',
          reviewer: 'pat',
          sentAt: NOW,
          kind: 'respond',
        } as never,
      }),
      NOW,
      NONE,
      ME
    );
    expect(retry).toMatchObject({
      word: 'respond ask to pat went unanswered',
    });
    const [working] = candidateLines(
      mr({
        sentNudge: {
          display: 'launched',
          reviewer: 'pat',
          kind: 'respond',
        } as never,
      }),
      NOW,
      NONE,
      ME
    );
    expect(working).toMatchObject({
      tone: 'work',
      word: 'pat responding…',
      spin: true,
    });
  });

  test('the longest-waiting inbound nudge wins the line', () => {
    const s = rowStatus(
      mr({
        nudges: [
          { from: 'kim', receivedAt: NOW - 5 * 60_000 },
          { from: 'jo', receivedAt: NOW - 30 * 60_000 },
        ],
      }),
      NOW,
      NONE,
      ME
    );
    expect(s.line.word).toBe('jo asked for a re-review');
    expect(s.more.map(l => l.word)).toEqual(['kim asked for a re-review']);
  });

  test('a held draft is warn with the read verb carrying the draft; a resolved one is skipped', () => {
    const draft = { kind: 'verification note', body: 'x', createdAt: NOW };
    const url = 'https://gitlab.example.com/acme/webapp/-/merge_requests/1418';
    const [line] = candidateLines(mr({ drafts: [draft] }), NOW, NONE, ME);
    expect(line).toMatchObject({
      tone: 'warn',
      word: 'held: verification note',
      detail: 'doctor draft',
    });
    expect(line!.verbs[0]).toMatchObject({
      kind: 'read-note',
      label: 'read',
      draft,
    });
    const resolved: ReadonlyMap<string, 'posted' | 'dismissed'> = new Map([
      [`${url}#${draft.kind}`, 'posted'],
    ]);
    expect(
      candidateLines(settled({ drafts: [draft] }), NOW, resolved, ME)
    ).toEqual([expect.objectContaining({ tone: 'clear' })]);
  });

  test('a live peer review is a working line with the view verb', () => {
    const [line] = candidateLines(
      mr({
        peerReviews: [
          {
            mrUrl: 'u',
            iid: 1,
            reviewer: 'pat',
            status: 'reviewing',
            updatedAt: NOW,
          },
        ],
      }),
      NOW,
      NONE,
      ME
    );
    expect(line).toMatchObject({
      tone: 'work',
      word: 'pat is reviewing…',
      spin: true,
    });
    expect(line!.verbs[0]).toEqual({ kind: 'view-peer', label: 'view ↗' });
  });

  test('a finished peer review is a go line naming the outcome', () => {
    const [line] = candidateLines(
      mr({
        peerReviews: [
          {
            mrUrl: 'u',
            iid: 1,
            reviewer: 'pat',
            status: 'done',
            outcome: 'approve',
            updatedAt: NOW,
          },
        ],
      }),
      NOW,
      NONE,
      ME
    );
    expect(line).toMatchObject({ tone: 'go', word: 'pat approved' });
  });

  test('a sent nudge with no answer is quiet; a retryable one is quiet too, pointing at the menu', () => {
    const [quiet] = candidateLines(
      mr({
        sentNudge: {
          display: 'requested',
          reviewer: 'jo',
          sentAt: NOW - 30 * 60_000,
        } as never,
      }),
      NOW,
      NONE,
      ME
    );
    expect(quiet).toMatchObject({
      tone: 'quiet',
      word: 'nudged jo',
      detail: 'no answer yet, 30m ago',
    });
    const [retry] = candidateLines(
      mr({
        sentNudge: {
          display: 'rejected',
          reviewer: 'jo',
          reason: 'busy',
          sentAt: NOW,
        } as never,
      }),
      NOW,
      NONE,
      ME
    );
    expect(retry).toMatchObject({
      tone: 'quiet',
      word: 'jo declined the nudge',
      detail: 'busy',
      verbs: [],
    });
  });

  test('a declined ask names the reviewer and shows their reason; without one it points at the menu', () => {
    const [reasoned] = candidateLines(
      mr({
        sentNudge: {
          display: 'rejected',
          reviewer: 'jo',
          reason: 'review-in-flight',
          sentAt: NOW,
          kind: 'review',
        } as never,
      }),
      NOW,
      NONE,
      ME
    );
    expect(reasoned).toMatchObject({
      tone: 'quiet',
      word: 'jo declined the review ask',
      detail: 'review-in-flight',
    });
    const [bare] = candidateLines(
      mr({
        sentNudge: {
          display: 'rejected',
          reviewer: 'jo',
          sentAt: NOW,
        } as never,
      }),
      NOW,
      NONE,
      ME
    );
    expect(bare).toMatchObject({
      word: 'jo declined the nudge',
      detail: 'right-click to ask again',
    });
  });

  test('a human reviewing right now is a quiet line', () => {
    const [line] = candidateLines(
      mr({
        reviews: {
          isApproved: false,
          required: 1,
          given: 0,
          reviewers: [
            { username: 'kim', name: 'Kim', reviewState: 'REVIEW_STARTED' },
          ],
        },
      } as never),
      NOW,
      NONE,
      ME
    );
    expect(line).toMatchObject({
      tone: 'quiet',
      word: 'Kim is reviewing right now',
    });
  });

  test('a sent nudge confirmed and re-launching is a working line', () => {
    const [line] = candidateLines(
      mr({ sentNudge: { display: 'confirmed', reviewer: 'jo' } as never }),
      NOW,
      NONE,
      ME
    );
    expect(line).toMatchObject({
      tone: 'work',
      word: 'jo re-reviewing…',
      spin: true,
    });
  });
});

describe('rowStatus: the stress row', () => {
  test('one line wins, the rest are counted, the bar follows the winner', () => {
    const s = rowStatus(
      mr({
        gates: [gate()] as never,
        respond: { status: 'implementing' },
        doctor: { status: 'watching', origin: 'auto' },
        review: { status: 'reviewing', sessionId: 'sess-1' },
        orphan: {
          agentId: 'ag-1',
          repo: null,
          subject: 'agent:ag-1',
          surface: 'herdr',
          sessionId: 'sess-1',
          paneRef: null,
          state: 'gone',
          since: NOW,
          openGateIds: [],
        },
      }),
      NOW,
      NONE,
      ME
    );
    expect(s.line.word).toBe('post which findings?');
    expect(s.more).toHaveLength(3);
    expect(s.bar).toBe('warn');
  });
});

describe('a finished review that left threads for the author', () => {
  const reviewed = (over: Over = {}) =>
    mr({
      author: { username: ME, name: 'Me' },
      review: { status: 'done', outcome: 'comment', reportReady: true },
      threadSummary: { awaiting: 5, replied: 0, resolved: 0 },
      ...over,
    } as never);

  test('respond leads the line, with the report one hover away', () => {
    const s = rowStatus(reviewed(), NOW, NONE, ME);
    expect(s.line.word).toBe('review ready');
    expect(s.line.verbs.map(v => v.kind)).toEqual([
      'launch-respond',
      'read-review',
    ]);
  });

  test("nothing awaiting, or someone else's MR: the report alone", () => {
    const settledThreads = rowStatus(
      reviewed({ threadSummary: { awaiting: 0, replied: 0, resolved: 3 } }),
      NOW,
      NONE,
      ME
    );
    expect(settledThreads.line.verbs.map(v => v.kind)).toEqual(['read-review']);
    const theirs = rowStatus(
      reviewed({ author: { username: 'pat', name: 'Pat' } }),
      NOW,
      NONE,
      ME
    );
    expect(theirs.line.verbs.map(v => v.kind)).toEqual(['read-review']);
  });
});

describe('merge from the row', () => {
  const verbs = (m: BoardMRWithReview) =>
    rowStatus(m, NOW, NONE, ME).line.verbs.map(v => v.kind);
  const mine = (over: Over = {}) =>
    settled({ author: { username: ME, name: 'Me' }, ...MERGEABLE, ...over });
  const reviewDone = {
    review: { status: 'done', outcome: 'approve', reportReady: true },
  };

  test('my approved, mergeable MR with a finished review: merge leads, the report one hover away', () => {
    const s = rowStatus(mine(reviewDone), NOW, NONE, ME);
    expect(s.line.word).toBe('review ready');
    expect(s.line.verbs).toEqual([
      { kind: 'merge', label: 'merge' },
      { kind: 'read-review', label: 'read ↗' },
    ]);
  });

  test('a finished response on my mergeable MR: merge leads, the report one hover away', () => {
    expect(
      verbs(
        mine({
          respond: {
            status: 'done',
            posted: 3,
            threads: 3,
            reportReady: true,
          },
        })
      )
    ).toEqual(['merge', 'read-respond']);
  });

  test('ready to merge: merge leads, open one hover away', () => {
    const [line] = candidateLines(mine(), NOW, NONE, ME);
    expect(line!.word).toBe('ready to merge');
    expect(line!.verbs.map(v => v.kind)).toEqual(['merge', 'open-mr']);
  });

  test("someone else's MR never offers merge", () => {
    expect(
      verbs(mine({ ...reviewDone, author: { username: 'pat', name: 'Pat' } }))
    ).toEqual(['read-review']);
  });

  test('no merge while GitLab would refuse it: conflicts, a disabled button, or no approval', () => {
    const cases: Over[] = [
      {
        ...blockedBy({ hasConflicts: true }),
        mergeButton: { visible: true, disabled: true, loading: false },
      },
      { mergeButton: { visible: true, disabled: true, loading: false } },
      { mergeButton: { visible: false, disabled: false, loading: false } },
      unapproved(0, 1),
    ];
    for (const over of cases)
      expect(verbs(mine({ ...reviewDone, ...over }))).toEqual(['read-review']);
  });

  test('a merge in flight spins in place of every other line, with nothing to click', () => {
    const merging = {
      mergeButton: { visible: true, disabled: true, loading: true },
    };
    for (const m of [
      mine({ ...reviewDone, ...merging }),
      mine(merging),
      settled(merging),
      mine({ ...merging, gates: [gate()] }),
    ]) {
      const s = rowStatus(m, NOW, NONE, ME);
      expect(s.line).toEqual({
        tone: 'work',
        word: 'merging…',
        spin: true,
        verbs: [],
      });
      expect(s.more).toEqual([]);
      expect(s.bar).toBeNull();
    }
  });

  test('threads awaiting me keep respond in the lead', () => {
    expect(
      verbs(
        mine({
          ...reviewDone,
          threadSummary: { awaiting: 2, replied: 0, resolved: 0 },
        })
      )
    ).toEqual(['launch-respond', 'read-review']);
  });
});

describe('statusPhrase: the pill says what the status group says', () => {
  test('changes requested is red', () => {
    const m = settled({
      reviews: {
        isApproved: false,
        required: 2,
        given: 0,
        reviewers: [{ username: 'pat', reviewState: 'REQUESTED_CHANGES' }],
      },
    });
    expect(statusPhrase(m)).toEqual({ text: 'changes requested', hue: 'red' });
  });

  test('approved is green', () => {
    expect(statusPhrase(settled())).toEqual({ text: 'approved', hue: 'green' });
  });

  test('a partial approval count is cyan', () => {
    expect(statusPhrase(settled(unapproved(1, 3)))).toEqual({
      text: '1/3 approved',
      hue: 'cyan',
    });
  });

  test('every assigned reviewer approved but a codeowner rule still open reads partial, not approved', () => {
    const rosterApproved = {
      reviews: {
        isApproved: false,
        required: 2,
        given: 1,
        remaining: 1,
        reviewers: [{ username: 'pat', reviewState: 'APPROVED' }],
      },
    };
    expect(statusPhrase(settled(rosterApproved))).toEqual({
      text: '1/2 approved',
      hue: 'cyan',
    });
    expect(
      statusPhrase(settled({ ...rosterApproved, reviewerComments: 2 }))
    ).toEqual({ text: '1/2 approved', hue: 'cyan' });
  });

  test('the count is rule slots filled, not approvers: one approver can fill many rules', () => {
    const wide = settled({
      reviews: {
        isApproved: false,
        required: 83,
        given: 1,
        remaining: 64,
        reviewers: [{ username: 'pat', reviewState: 'APPROVED' }],
      },
      blockers: { any: true, awaitingApprovals: true },
    });
    expect(statusPhrase(wide)).toEqual({ text: '19/83 approved', hue: 'cyan' });
    expect(statusReasons(wide)).toBe('blocked:\n· awaiting approvals (19/83)');
  });

  test('an untouched MR is amber', () => {
    expect(statusPhrase(settled(unapproved(0, 2)))).toEqual({
      text: 'needs review',
      hue: 'amber',
    });
  });

  // The pill and the "status" grouping read the same bucket, so a row can
  // never sit under a `commented` header wearing a `needs review` badge.
  test('reviewer comments make it commented, in accent', () => {
    expect(
      statusPhrase(settled({ ...unapproved(0, 2), reviewerComments: 3 }))
    ).toEqual({ text: 'commented', hue: 'accent' });
  });

  test('a reviewed MR with every thread resolved is purple', () => {
    expect(
      statusPhrase(
        settled({
          ...unapproved(0, 2),
          reviewerComments: 0,
          threadSummary: { awaiting: 0, replied: 0, resolved: 4 },
        })
      )
    ).toEqual({ text: 'comments resolved', hue: 'purple' });
  });

  test('changes requested and approval still outrank the conversation', () => {
    expect(
      statusPhrase(
        settled({
          reviews: {
            isApproved: false,
            required: 2,
            given: 0,
            reviewers: [{ username: 'pat', reviewState: 'REQUESTED_CHANGES' }],
          },
          reviewerComments: 5,
        })
      )
    ).toEqual({ text: 'changes requested', hue: 'red' });
    expect(statusPhrase(settled({ reviewerComments: 5 }))).toEqual({
      text: 'approved',
      hue: 'green',
    });
  });
});
