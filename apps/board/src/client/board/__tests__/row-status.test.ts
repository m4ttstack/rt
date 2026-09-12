import { describe, expect, test } from 'bun:test';

import type { BoardMRWithReview } from '../../types.ts';
import {
  candidateLines,
  DELIVERY_STUCK_MESSAGE,
  EXECUTION_UNASSIGNED_MESSAGE,
  rowStatus,
} from '../row-status.ts';

const NOW = Date.parse('2026-09-12T12:00:00Z');
const NONE: ReadonlyMap<string, 'posted' | 'dismissed'> = new Map();

function mr(over: Partial<BoardMRWithReview> = {}): BoardMRWithReview {
  return {
    iid: 1418,
    title: 'ACME-2214 Port the v2 quiet-mode flows',
    webUrl: 'https://gitlab.example.com/acme/webapp/-/merge_requests/1418',
    sourceBranch: 'feature/acme-2214',
    targetBranch: 'main',
    author: { username: 'pat', name: 'Pat' },
    reviews: { isApproved: false, required: 1, given: 0, reviewers: [] },
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

describe('rowStatus: the quiet row', () => {
  test('no activity yields the all-clear line with the open verb and no bar', () => {
    const s = rowStatus(mr(), NOW, NONE);
    expect(s.line.tone).toBe('clear');
    expect(s.line.word).toBe('all clear');
    expect(s.line.detail).toBe('enjoy the sunshine');
    expect(s.line.verbs.map(v => v.kind)).toEqual(['open-mr']);
    expect(s.more).toEqual([]);
    expect(s.bar).toBeNull();
  });
});

describe('rowStatus: review lane', () => {
  test('queued is quiet with the lane prefix', () => {
    const [line] = candidateLines(
      mr({ review: { status: 'queued' } }),
      NOW,
      NONE
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
      NONE
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

  test('done with a report is a go line whose verb opens the review', () => {
    const [line] = candidateLines(
      mr({
        review: {
          status: 'done',
          reportReady: true,
          outcome: 'approve',
        },
      }),
      NOW,
      NONE
    );
    expect(line).toMatchObject({
      tone: 'go',
      word: 'review ready',
      detail: 'approved',
    });
    expect(line!.verbs[0]).toEqual({ kind: 'read-review', label: 'read ↗' });
  });

  test('error is a bad line with the launch-again verb and a red bar', () => {
    const s = rowStatus(
      mr({
        review: {
          status: 'error',
          message: 'pane closed... cleared from the board',
        },
      }),
      NOW,
      NONE
    );
    expect(s.line).toMatchObject({
      tone: 'bad',
      word: 'review failed',
      detail: 'pane closed... cleared from the board',
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
      NONE
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
      NONE
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
      NONE
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
  });

  test('a queued review (no session yet) is interrupted by a gone orphan', () => {
    const s = rowStatus(
      mr({ review: { status: 'queued' }, orphan }),
      NOW,
      NONE
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
      NONE
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
      NONE
    );
    expect(s.line).toMatchObject({ tone: 'work', word: 'fixing…' });
    expect(s.more.map(l => l.word)).toEqual(['pane gone']);
    expect(s.bar).toBeNull();
  });

  test('no lane at all with a gone orphan is the quiet pane-gone line with clear only', () => {
    const s = rowStatus(mr({ orphan }), NOW, NONE);
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
      NONE
    );
    expect(s.line.word).toBe('review running…');
    expect(s.more.map(l => l.word)).toEqual(['pane gone']);
  });
});

describe('rowStatus: gates', () => {
  test('an open gate is the decide line: the first question, lowercased, with answer', () => {
    const s = rowStatus(mr({ gates: [gate()] as never }), NOW, NONE);
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
      NONE
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
      NONE
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
      NONE
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
      NONE
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
      NONE
    );
    expect(line).toMatchObject({
      tone: 'quiet',
      word: 'answered',
      detail: 'Minor, comment',
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
      const [line] = candidateLines(mr({ respond: { status } }), NOW, NONE);
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
      NONE
    );
    expect(line).toMatchObject({
      tone: 'go',
      word: 'replies posted',
      detail: '3 of 3',
    });
    expect(line!.verbs[0]).toEqual({ kind: 'read-respond', label: 'read ↗' });
  });

  test('partially posted is warn with the resume verb', () => {
    const [line] = candidateLines(
      mr({
        respond: { status: 'done', posted: 2, threads: 3, sessionId: 's' },
      }),
      NOW,
      NONE
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

  test('drafted but not posted is warn with resume', () => {
    const [line] = candidateLines(
      mr({
        respond: { status: 'done', posted: 0, threads: 2, sessionId: 's' },
      }),
      NOW,
      NONE
    );
    expect(line).toMatchObject({ tone: 'warn', word: 'drafted, not posted' });
  });

  test('error is bad with restart', () => {
    const [line] = candidateLines(
      mr({ respond: { status: 'error' } }),
      NOW,
      NONE
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
      NONE
    );
    expect(line).toMatchObject({ tone: 'quiet', word: 'response done' });
  });
});

describe('rowStatus: doctor lane', () => {
  test('an auto doctor watching CI is a working line with the auto detail', () => {
    const [line] = candidateLines(
      mr({ doctor: { status: 'watching', origin: 'auto' } }),
      NOW,
      NONE
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
      NONE
    );
    expect(line).toMatchObject({ tone: 'bad', word: 'doctor stuck' });
    expect(line!.verbs[0]).toEqual({
      kind: 'call-doctor',
      label: 'call again',
    });
  });

  test('done is a go line naming the diagnosis, with the message as detail', () => {
    const [line] = candidateLines(
      mr({ doctor: { status: 'done', message: 'rebased on target' } }),
      NOW,
      NONE
    );
    expect(line).toMatchObject({
      tone: 'go',
      word: 'diagnosed',
      detail: 'rebased on target',
    });
  });
});

describe('rowStatus: social lanes', () => {
  test('an inbound nudge is warn with the re-review verb and the age', () => {
    const [line] = candidateLines(
      mr({ nudges: [{ from: 'jo', receivedAt: NOW - 30 * 60_000 }] }),
      NOW,
      NONE
    );
    expect(line).toMatchObject({
      tone: 'warn',
      word: 'jo asked for a re-review',
      detail: '30m ago',
    });
    expect(line!.verbs[0]).toEqual({ kind: 're-review', label: 're-review' });
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
      NONE
    );
    expect(s.line.word).toBe('jo asked for a re-review');
    expect(s.more.map(l => l.word)).toEqual(['kim asked for a re-review']);
  });

  test('a held draft is warn with the read verb carrying the draft; a resolved one is skipped', () => {
    const draft = { kind: 'verification note', body: 'x', createdAt: NOW };
    const url = 'https://gitlab.example.com/acme/webapp/-/merge_requests/1418';
    const [line] = candidateLines(mr({ drafts: [draft] }), NOW, NONE);
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
    expect(candidateLines(mr({ drafts: [draft] }), NOW, resolved)).toEqual([
      expect.objectContaining({ tone: 'clear' }),
    ]);
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
      NONE
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
      NONE
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
      NONE
    );
    expect(quiet).toMatchObject({
      tone: 'quiet',
      word: 'nudged jo',
      detail: 'no answer yet, 30m',
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
      NONE
    );
    expect(retry).toMatchObject({
      tone: 'quiet',
      word: 'nudge to jo went unanswered',
      detail: 'right-click to ask again',
      verbs: [],
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
      NONE
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
      NONE
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
      NONE
    );
    expect(s.line.word).toBe('post which findings?');
    expect(s.more).toHaveLength(3);
    expect(s.bar).toBe('warn');
  });
});
