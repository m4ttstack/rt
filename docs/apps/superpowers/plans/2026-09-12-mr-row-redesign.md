# MR Row Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the board's chips-on-chips MR row with the approved fixed-height, one-status-line row from `docs/design/mr-row`.

**Architecture:** A pure derivation module (`row-status.ts`) turns a `BoardMRWithReview` into exactly one status line (tone, word, detail, verbs) plus an edge-bar tone; two more pure modules derive the Slack ladder and thread newness. `RowView.tsx` becomes a thin renderer of those derivations with a fixed three-line anatomy, and every per-feature badge/chip/strip component the row used to compose is deleted. CSS pins the row to 92px and separates junctions by contrast instead of glyphs. The existing capture harness (`bun run capture:baseline` / `capture:compare`) re-records the board baselines, and a Fast Browser parity pass compares the served fixture board against `docs/design/mr-row/baseline/*.png`.

**Tech Stack:** React 18 + TypeScript in `apps/board` (bun), `@mattstack/tui-kit` recipes (`Chip`, `SelectBox`, `StatusDot`), happy-dom DOM tests under `bun test`, Playwright capture harness (`apps/board/tests/capture.ts`), Fast Browser for the parity pass.

**Spec:** `docs/design/mr-row/README.md` (the laws, the anatomy, the parity gate) with `docs/design/mr-row/build.mjs` as the pixel source and `docs/design/mr-row/baseline/*.png` as the approved renders.

## Global Constraints

- Every row is the same fixed height: `92px` (comfortable scale). Three lines: identity, facts, status. Nothing on a row may add a fourth line.
- Exactly ONE status line per row. The hottest candidate wins; the rest are counted as `+N active` (title attribute lists them).
- Tone rank, hottest first: `bad`, `warn`, `work`, `go`, `quiet`, `clear`. Within a tone, source order wins: gates, orphan, review, respond, doctor, inbound nudges, held drafts, sent nudge, peer reviews, live human reviewers.
- Color is a verb: `bad` = red, `warn` = amber, `work` = purple, `go` = green, `quiet` = muted, `clear` = green mixed 40% into muted. The row's edge bar is `bad` or `warn` only, from the chosen line's tone.
- Verbs: the first verb of the chosen line renders at rest (accent when the tone is `bad`/`warn`, muted otherwise); remaining verbs render only on row hover.
- No separator glyphs (`·`, `|`) on the row. Every junction steps in size, weight, or color.
- No emoji on the row. Icons are inline SVG, fill style, `14px`, `currentColor` except the brand-colored Slack logo.
- Slack ladder: the color Slack logo appears beside the state pill only once `slack.posted` is true; the furthest reaction stage (`looking` < `commented` < `approved`) appears as a mono mark left of the logo.
- The decision queue is the gate seat: a gate's `answer` verb calls `ctx.onOpenGate(gateId)`; the row never mounts a form.
- Fixture data is invented (acme / ACME-1234 / gitlab.example.com); `bash scripts/repo-purity.sh` must pass. Never paste anything from a real board.
- House style: no em dashes or en dashes anywhere (code, comments, commit messages, tests); comments state constraints only, never narrate or cite process; commit messages end with the `Co-Authored-By` trailer the session carries.
- Gates before every commit that touches `apps/board`: `bun run tui-kit:build` once per session, then `bun run board:typecheck`, `bun run board:test`, `bun run format:check` (fix with `bunx prettier --write <files>`), `bash scripts/repo-purity.sh`, all from the repo root.

---

## File structure

| file | responsibility |
| --- | --- |
| `apps/board/src/client/board/row-status.ts` (new) | pure: `candidateLines`, `rowStatus`, verb types, the two gate wording constants |
| `apps/board/src/client/board/slack-ladder.ts` (new) | pure: `slackLadder(slack, marks)` |
| `apps/board/src/client/board/threads-seen.ts` (new) | pure `threadNewness` plus the localStorage accessors |
| `apps/board/src/client/board/icons.tsx` (new) | the fill icon set: `SlackLogo`, `Eyes`, `Bubble`, `DiscCheck`, `Sun` |
| `apps/board/src/client/board/StatusLine.tsx` (new) | renders one `RowStatus` with verbs mapped onto `RowContext` |
| `apps/board/src/client/board/RowView.tsx` (rewrite) | the three-line row; imports the modules above |
| `apps/board/src/client/types.ts` (modify) | `RowContext` gains `onLaunch`, `onReReview`, `onRespond`, `onDoctor`; `ReviewInfo`/`RespondInfo`/`DoctorInfo` gain `startedAt?: number` |
| `apps/board/src/client/board/Board.tsx` (modify) | passes the four handlers into `rowCtx` |
| `apps/board/src/client/board/DecisionQueueModal.tsx` (modify) | imports the gate wording constants from `row-status.ts` |
| `apps/board/src/style.css` (modify) | the row block rewritten; dead rules removed |
| deleted | `BoardBadges.tsx`, `GateRowChips.tsx`, `GateRowChips.stories.tsx`, the badge components in `chips.tsx` (keep any export with a surviving consumer), `hasBoardBadges` in `format.ts` |
| tests | `src/client/board/__tests__/row-status.test.ts` (new), `slack-ladder.test.ts` (new), `threads-seen.test.ts` (new), `row-view-dom.test.tsx` (new, replaces `orphan-strip-dom.test.tsx`, `gate-row-chips.test.tsx`, `interrupted-badge-dom.test.tsx`); selector updates in `decision-queue-dom.test.tsx`, `gate-deep-link-dom.test.tsx`, `attention-card-dom.test.tsx` |
| `apps/board/tests/fixture/data.json` (modify) | rows carrying every state the design draws |
| `apps/board/tests/baselines/*.png` (re-recorded) | via `bun run capture:baseline` |

---

### Task 1: `row-status.ts`, the single status line derivation

**Files:**
- Create: `apps/board/src/client/board/row-status.ts`
- Test: `apps/board/src/client/board/__tests__/row-status.test.ts`
- Modify: `apps/board/src/client/types.ts` (add `startedAt?: number` to `ReviewInfo`, `RespondInfo`, `DoctorInfo`)

**Interfaces:**
- Consumes: `BoardMRWithReview`, `GateRow`, `DraftInfo` from `../types.ts`; `laneInterrupted`, `activeReviewers`, `DOCTOR_LABEL`, `RESPOND_LABEL`, `NUDGE_RETRYABLE`, `draftKey` from `./format.ts`; `respondOutcome` from `../../respond-outcome.ts`.
- Produces (later tasks rely on these exact names):

```ts
export type Tone = 'bad' | 'warn' | 'work' | 'go' | 'quiet' | 'clear';
export type VerbKind =
  | 'relaunch' | 'clear' | 'answer' | 'read-review' | 'read-respond'
  | 'resume-respond' | 'focus' | 'launch-review' | 'restart-respond'
  | 'call-doctor' | 're-review' | 'read-note' | 'view-peer' | 'open-mr';
export interface Verb {
  kind: VerbKind;
  label: string;
  gateId?: string;
  domain?: 'review' | 'respond' | 'doctor';
  agentId?: string;
  draft?: DraftInfo;
}
export interface StatusLine {
  tone: Tone;
  word: string;
  detail?: string;
  spin?: boolean;
  verbs: Verb[];
}
export interface RowStatus {
  line: StatusLine;
  more: StatusLine[];
  bar: 'bad' | 'warn' | null;
}
export const DELIVERY_STUCK_MESSAGE = "pane didn't pick up the answer";
export const EXECUTION_UNASSIGNED_MESSAGE = 'answered, no pane to execute';
export function candidateLines(mr: BoardMRWithReview, now: number, draftResolved: ReadonlyMap<string, 'posted' | 'dismissed'>): StatusLine[];
export function rowStatus(mr: BoardMRWithReview, now: number, draftResolved: ReadonlyMap<string, 'posted' | 'dismissed'>): RowStatus;
```

- [ ] **Step 1: Add the optional timestamps to the lane info types**

In `apps/board/src/client/types.ts`, add `startedAt?: number;` to `ReviewInfo`, `RespondInfo`, and `DoctorInfo` (the server already serializes it; the client type just never declared it).

- [ ] **Step 2: Write the failing tests**

Create `apps/board/src/client/board/__tests__/row-status.test.ts`:

```ts
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
    { id: 'tiers', label: 'Post which findings?', multi: true, options: ['Minor'] },
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
    const [line] = candidateLines(mr({ review: { status: 'queued' } }), NOW, NONE);
    expect(line).toMatchObject({ tone: 'quiet', word: 'review queued', verbs: [] });
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
    expect(line!.verbs).toEqual([{ kind: 'focus', label: 'focus', domain: 'review' }]);
  });

  test('done with a report is a go line whose verb opens the review', () => {
    const [line] = candidateLines(
      mr({ review: { status: 'done', reportReady: true, outcome: 'approve' } as never }),
      NOW,
      NONE
    );
    expect(line).toMatchObject({ tone: 'go', word: 'review ready', detail: 'approved' });
    expect(line!.verbs[0]).toEqual({ kind: 'read-review', label: 'read ↗' });
  });

  test('error is a bad line with the launch-again verb and a red bar', () => {
    const s = rowStatus(
      mr({ review: { status: 'error', message: 'pane closed... cleared from the board' } }),
      NOW,
      NONE
    );
    expect(s.line).toMatchObject({
      tone: 'bad',
      word: 'review failed',
      detail: 'pane closed... cleared from the board',
    });
    expect(s.line.verbs[0]).toEqual({ kind: 'launch-review', label: 'launch again' });
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
    expect(s.line.verbs[0]).toEqual({ kind: 'relaunch', label: 'relaunch', domain: 'respond' });
  });

  test('a hidden orphan is a quiet off-screen line with a focus verb', () => {
    const [line] = candidateLines(
      mr({ review: { status: 'reviewing', sessionId: 'sess-1' }, orphan: { ...orphan, state: 'hidden' } }),
      NOW,
      NONE
    );
    expect(line).toMatchObject({ tone: 'quiet', word: 'off-screen', detail: 'pane hidden, still running' });
    expect(line!.verbs[0]).toEqual({ kind: 'focus', label: 'focus', domain: 'review' });
  });
});

describe('rowStatus: gates', () => {
  test('an open gate is the decide line: the first question, lowercased, with answer', () => {
    const s = rowStatus(mr({ gates: [gate()] as never }), NOW, NONE);
    expect(s.line).toMatchObject({ tone: 'warn', word: 'post which findings?' });
    expect(s.line.verbs).toEqual([{ kind: 'answer', label: 'answer', gateId: 'g1' }]);
  });

  test('a parked gate says so in the detail', () => {
    const [line] = candidateLines(mr({ gates: [gate({ status: 'parked' })] as never }), NOW, NONE);
    expect(line!.detail).toBe('parked');
  });

  test('decide beats interrupted: same tone, gates come first', () => {
    const s = rowStatus(
      mr({
        gates: [gate()] as never,
        review: { status: 'reviewing', sessionId: 'sess-1' },
        orphan: {
          agentId: 'ag-1', repo: null, subject: 'agent:ag-1', surface: 'herdr',
          sessionId: 'sess-1', paneRef: null, state: 'gone', since: NOW, openGateIds: [],
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
      mr({ gates: [gate({ status: 'answered', answers: { tiers: [] }, delivery: { outcome: 'stuck', at: NOW } })] as never }),
      NOW,
      NONE
    );
    expect(s.line).toMatchObject({ tone: 'bad', word: DELIVERY_STUCK_MESSAGE });
    expect(s.line.verbs).toEqual([{ kind: 'answer', label: 'retry', gateId: 'g1' }]);
  });

  test('an unassigned execution is a bad line whose relaunch opens the queue', () => {
    const s = rowStatus(
      mr({ gates: [gate({ status: 'answered', answers: { tiers: [] }, execution: 'unassigned' })] as never }),
      NOW,
      NONE
    );
    expect(s.line).toMatchObject({ tone: 'bad', word: EXECUTION_UNASSIGNED_MESSAGE });
    expect(s.line.verbs).toEqual([{ kind: 'answer', label: 'relaunch', gateId: 'g1' }]);
  });

  test('a plainly answered gate is a quiet answered line with the answers as detail', () => {
    const [line] = candidateLines(
      mr({ gates: [gate({ status: 'answered', answers: { tiers: ['Minor'], outcome: 'comment' } })] as never }),
      NOW,
      NONE
    );
    expect(line).toMatchObject({ tone: 'quiet', word: 'answered', detail: 'Minor, comment', verbs: [] });
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
      expect(line!.verbs[0]).toEqual({ kind: 'focus', label: 'focus', domain: 'respond' });
    }
  });

  test('done and fully posted is go with the read verb', () => {
    const [line] = candidateLines(
      mr({ respond: { status: 'done', posted: 3, threads: 3, reportReady: true } }),
      NOW,
      NONE
    );
    expect(line).toMatchObject({ tone: 'go', word: 'replies posted', detail: '3 of 3' });
    expect(line!.verbs[0]).toEqual({ kind: 'read-respond', label: 'read ↗' });
  });

  test('partially posted is warn with the resume verb', () => {
    const [line] = candidateLines(
      mr({ respond: { status: 'done', posted: 2, threads: 3, sessionId: 's' } }),
      NOW,
      NONE
    );
    expect(line).toMatchObject({ tone: 'warn', word: '2 of 3 posted', detail: 'one thread waiting' });
    expect(line!.verbs[0]).toEqual({ kind: 'resume-respond', label: 'resume ↗' });
  });

  test('drafted but not posted is warn with resume', () => {
    const [line] = candidateLines(
      mr({ respond: { status: 'done', posted: 0, threads: 2, sessionId: 's' } }),
      NOW,
      NONE
    );
    expect(line).toMatchObject({ tone: 'warn', word: 'drafted, not posted' });
  });

  test('error is bad with restart', () => {
    const [line] = candidateLines(mr({ respond: { status: 'error' } }), NOW, NONE);
    expect(line).toMatchObject({ tone: 'bad', word: 'response failed' });
    expect(line!.verbs[0]).toEqual({ kind: 'restart-respond', label: 'restart' });
  });
});

describe('rowStatus: doctor lane', () => {
  test('an auto doctor watching CI is a working line with the auto detail', () => {
    const [line] = candidateLines(
      mr({ doctor: { status: 'watching', origin: 'auto' } }),
      NOW,
      NONE
    );
    expect(line).toMatchObject({ tone: 'work', word: 'watching CI…', detail: 'auto', spin: true });
  });

  test('stuck is bad with call again', () => {
    const [line] = candidateLines(mr({ doctor: { status: 'error' } }), NOW, NONE);
    expect(line).toMatchObject({ tone: 'bad', word: 'doctor stuck' });
    expect(line!.verbs[0]).toEqual({ kind: 'call-doctor', label: 'call again' });
  });
});

describe('rowStatus: social lanes', () => {
  test('an inbound nudge is warn with the re-review verb and the age', () => {
    const [line] = candidateLines(
      mr({ nudges: [{ from: 'jo', receivedAt: NOW - 30 * 60_000 }] }),
      NOW,
      NONE
    );
    expect(line).toMatchObject({ tone: 'warn', word: 'jo asked for a re-review', detail: '30m ago' });
    expect(line!.verbs[0]).toEqual({ kind: 're-review', label: 're-review' });
  });

  test('a held draft is warn with the read verb carrying the draft; a resolved one is skipped', () => {
    const draft = { kind: 'verification note', body: 'x', createdAt: NOW };
    const url = 'https://gitlab.example.com/acme/webapp/-/merge_requests/1418';
    const [line] = candidateLines(mr({ drafts: [draft] }), NOW, NONE);
    expect(line).toMatchObject({ tone: 'warn', word: 'held: verification note', detail: 'doctor draft' });
    expect(line!.verbs[0]).toMatchObject({ kind: 'read-note', label: 'read', draft });
    const resolved = new Map([[`${url} verification note`, 'posted' as const]]);
    expect(candidateLines(mr({ drafts: [draft] }), NOW, resolved)).toEqual([
      expect.objectContaining({ tone: 'clear' }),
    ]);
  });

  test('a live peer review is a working line with the view verb', () => {
    const [line] = candidateLines(
      mr({ peerReviews: [{ mrUrl: 'u', iid: 1, reviewer: 'pat', status: 'reviewing', updatedAt: NOW }] }),
      NOW,
      NONE
    );
    expect(line).toMatchObject({ tone: 'work', word: 'pat is reviewing…', spin: true });
    expect(line!.verbs[0]).toEqual({ kind: 'view-peer', label: 'view ↗' });
  });

  test('a finished peer review is a go line naming the outcome', () => {
    const [line] = candidateLines(
      mr({ peerReviews: [{ mrUrl: 'u', iid: 1, reviewer: 'pat', status: 'done', outcome: 'approve', updatedAt: NOW }] }),
      NOW,
      NONE
    );
    expect(line).toMatchObject({ tone: 'go', word: 'pat approved' });
  });

  test('a sent nudge with no answer is quiet; a retryable one is warn', () => {
    const [quiet] = candidateLines(
      mr({ sentNudge: { display: 'requested', reviewer: 'jo', sentAt: NOW - 30 * 60_000 } as never }),
      NOW,
      NONE
    );
    expect(quiet).toMatchObject({ tone: 'quiet', word: 'nudged jo', detail: 'no answer yet, 30m' });
    const [warn] = candidateLines(
      mr({ sentNudge: { display: 'expired', reviewer: 'jo', sentAt: NOW } as never }),
      NOW,
      NONE
    );
    expect(warn).toMatchObject({ tone: 'warn', word: 'nudge to jo went unanswered' });
  });

  test('a human reviewing right now is a quiet line', () => {
    const [line] = candidateLines(
      mr({
        reviews: {
          isApproved: false, required: 1, given: 0,
          reviewers: [{ username: 'kim', name: 'Kim', reviewState: 'REVIEW_STARTED' }],
        },
      } as never),
      NOW,
      NONE
    );
    expect(line).toMatchObject({ tone: 'quiet', word: 'kim is reviewing right now' });
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
          agentId: 'ag-1', repo: null, subject: 'agent:ag-1', surface: 'herdr',
          sessionId: 'sess-1', paneRef: null, state: 'gone', since: NOW, openGateIds: [],
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
```

Notes for the implementer: `draftKey(mrUrl, kind)` in `format.ts` joins with ` `; read it before hard-coding the key. The `reviewState` value the live-reviewer test uses is whatever `activeReviewers` in `format.ts` maps to `reviewing` via `getReviewDisplayState`; open `@mattstack/glance`'s `getReviewDisplayState` and use a value it maps to `'reviewing'`, adjusting the test literal if `REVIEW_STARTED` is not one.

- [ ] **Step 3: Run the tests to verify they fail**

Run from the repo root: `cd apps/board && bun test src/client/board/__tests__/row-status.test.ts`
Expected: FAIL, `Cannot find module '../row-status.ts'`.

- [ ] **Step 4: Implement `row-status.ts`**

Create `apps/board/src/client/board/row-status.ts`:

```ts
import { respondOutcome } from '../../respond-outcome.ts';
import type { BoardMRWithReview, DraftInfo } from '../types.ts';
import {
  activeReviewers,
  ago,
  DOCTOR_LABEL,
  draftKey,
  laneInterrupted,
  NUDGE_RETRYABLE,
} from './format.ts';

export type Tone = 'bad' | 'warn' | 'work' | 'go' | 'quiet' | 'clear';

export type VerbKind =
  | 'relaunch'
  | 'clear'
  | 'answer'
  | 'read-review'
  | 'read-respond'
  | 'resume-respond'
  | 'focus'
  | 'launch-review'
  | 'restart-respond'
  | 'call-doctor'
  | 're-review'
  | 'read-note'
  | 'view-peer'
  | 'open-mr';

export interface Verb {
  kind: VerbKind;
  label: string;
  gateId?: string;
  domain?: 'review' | 'respond' | 'doctor';
  agentId?: string;
  draft?: DraftInfo;
}

export interface StatusLine {
  tone: Tone;
  word: string;
  detail?: string;
  spin?: boolean;
  verbs: Verb[];
}

export interface RowStatus {
  line: StatusLine;
  more: StatusLine[];
  bar: 'bad' | 'warn' | null;
}

/** Shared with the decision queue's stuck/unassigned face so the row and
    the queue card never drift on wording. */
export const DELIVERY_STUCK_MESSAGE = "pane didn't pick up the answer";
export const EXECUTION_UNASSIGNED_MESSAGE = 'answered, no pane to execute';

const TONE_RANK: Record<Tone, number> = {
  bad: 0,
  warn: 1,
  work: 2,
  go: 3,
  quiet: 4,
  clear: 5,
};

const RESPOND_WORKING: Record<string, string> = {
  triaging: 'triaging…',
  implementing: 'implementing…',
  drafting: 'drafting replies…',
};

const DOCTOR_WORKING = new Set(['diagnosing', 'rebasing', 'fixing', 'watching']);

type Resolved = ReadonlyMap<string, 'posted' | 'dismissed'>;

function agoMs(ms: number | undefined, now: number): string | undefined {
  if (!ms) return undefined;
  return `${ago(new Date(ms).toISOString(), now)} ago`;
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function gateLines(mr: BoardMRWithReview): StatusLine[] {
  const out: StatusLine[] = [];
  for (const gate of mr.gates ?? []) {
    if (gate.status === 'open' || gate.status === 'parked') {
      out.push({
        tone: 'warn',
        word: lowerFirst(gate.questions[0]?.label ?? gate.label),
        detail: gate.status === 'parked' ? 'parked' : undefined,
        verbs: [{ kind: 'answer', label: 'answer', gateId: gate.gateId }],
      });
      continue;
    }
    if (gate.status !== 'answered') continue;
    if (gate.delivery?.outcome === 'stuck') {
      out.push({
        tone: 'bad',
        word: DELIVERY_STUCK_MESSAGE,
        verbs: [{ kind: 'answer', label: 'retry', gateId: gate.gateId }],
      });
      continue;
    }
    if (gate.execution === 'unassigned') {
      out.push({
        tone: 'bad',
        word: EXECUTION_UNASSIGNED_MESSAGE,
        verbs: [{ kind: 'answer', label: 'relaunch', gateId: gate.gateId }],
      });
      continue;
    }
    const summary = Object.values(gate.answers ?? {})
      .flatMap(v => (Array.isArray(v) ? v : [v]))
      .map(String)
      .join(', ');
    out.push({
      tone: 'quiet',
      word: 'answered',
      detail: summary || undefined,
      verbs: [],
    });
  }
  return out;
}

function orphanLine(mr: BoardMRWithReview, now: number): StatusLine | null {
  const orphan = mr.orphan;
  if (!orphan) return null;
  const domain = laneInterrupted(orphan, mr.review)
    ? 'review'
    : laneInterrupted(orphan, mr.respond)
      ? 'respond'
      : mr.review?.status === 'queued' || mr.review?.status === 'reviewing'
        ? 'review'
        : mr.respond && mr.respond.status !== 'done' && mr.respond.status !== 'error'
          ? 'respond'
          : 'review';
  if (orphan.state === 'hidden') {
    return {
      tone: 'quiet',
      word: 'off-screen',
      detail: 'pane hidden, still running',
      verbs: [{ kind: 'focus', label: 'focus', domain }],
    };
  }
  if (orphan.state !== 'gone') return null;
  const lane = domain === 'respond' ? 'response' : 'review';
  return {
    tone: 'warn',
    word: `${lane} interrupted`,
    detail: `pane closed ${agoMs(orphan.since, now) ?? 'just now'}`,
    verbs: [
      { kind: 'relaunch', label: 'relaunch', domain },
      { kind: 'clear', label: 'clear', agentId: orphan.agentId },
    ],
  };
}

function reviewLine(mr: BoardMRWithReview, now: number): StatusLine | null {
  const r = mr.review;
  if (!r) return null;
  if (mr.orphan?.state === 'gone' && laneInterrupted(mr.orphan, r)) return null;
  switch (r.status) {
    case 'queued':
      return { tone: 'quiet', word: 'review queued', verbs: [] };
    case 'reviewing':
      return {
        tone: 'work',
        word: 'review running…',
        spin: true,
        detail: r.message || (r.startedAt ? `started ${agoMs(r.startedAt, now)}` : undefined),
        verbs: [{ kind: 'focus', label: 'focus', domain: 'review' }],
      };
    case 'done': {
      const outcome = (r as { outcome?: string }).outcome;
      return {
        tone: 'go',
        word: 'review ready',
        detail: outcome === 'approve' ? 'approved' : outcome === 'comment' ? 'commented' : undefined,
        verbs: r.reportReady ? [{ kind: 'read-review', label: 'read ↗' }] : [],
      };
    }
    case 'error':
      return {
        tone: 'bad',
        word: 'review failed',
        detail: r.message || undefined,
        verbs: [{ kind: 'launch-review', label: 'launch again' }],
      };
  }
}

function respondLine(mr: BoardMRWithReview): StatusLine | null {
  const r = mr.respond;
  if (!r) return null;
  if (mr.orphan?.state === 'gone' && laneInterrupted(mr.orphan, r)) return null;
  if (r.status === 'queued') return { tone: 'quiet', word: 'response queued', verbs: [] };
  if (r.status in RESPOND_WORKING) {
    return {
      tone: 'work',
      word: RESPOND_WORKING[r.status]!,
      spin: true,
      detail: r.message || undefined,
      verbs: [{ kind: 'focus', label: 'focus', domain: 'respond' }],
    };
  }
  if (r.status === 'error') {
    return {
      tone: 'bad',
      word: 'response failed',
      detail: r.message || undefined,
      verbs: [{ kind: 'restart-respond', label: 'restart' }],
    };
  }
  const outcome = respondOutcome(r.posted, r.threads);
  const posted = Math.min(r.posted ?? 0, r.threads ?? 0);
  const threads = r.threads ?? 0;
  switch (outcome) {
    case 'posted':
      return {
        tone: 'go',
        word: 'replies posted',
        detail: `${threads} of ${threads}`,
        verbs: r.reportReady ? [{ kind: 'read-respond', label: 'read ↗' }] : [],
      };
    case 'partial':
      return {
        tone: 'warn',
        word: `${posted} of ${threads} posted`,
        detail: threads - posted === 1 ? 'one thread waiting' : `${threads - posted} threads waiting`,
        verbs: [{ kind: 'resume-respond', label: 'resume ↗' }],
      };
    case 'drafted':
      return {
        tone: 'warn',
        word: 'drafted, not posted',
        verbs: [{ kind: 'resume-respond', label: 'resume ↗' }],
      };
    case 'none':
      return { tone: 'go', word: 'no replies needed', verbs: [] };
    default:
      return { tone: 'quiet', word: 'response done', verbs: [] };
  }
}

function doctorLine(mr: BoardMRWithReview): StatusLine | null {
  const d = mr.doctor;
  if (!d) return null;
  if (d.status === 'queued') return { tone: 'quiet', word: 'doctor queued', verbs: [] };
  if (DOCTOR_WORKING.has(d.status)) {
    return {
      tone: 'work',
      word: DOCTOR_LABEL[d.status],
      spin: true,
      detail: d.origin === 'auto' ? 'auto' : d.message || undefined,
      verbs: [{ kind: 'focus', label: 'focus', domain: 'doctor' }],
    };
  }
  if (d.status === 'done') {
    return { tone: 'go', word: 'diagnosed', detail: d.message || undefined, verbs: [] };
  }
  return {
    tone: 'bad',
    word: 'doctor stuck',
    detail: d.message || undefined,
    verbs: [{ kind: 'call-doctor', label: 'call again' }],
  };
}

function socialLines(mr: BoardMRWithReview, now: number, resolved: Resolved): StatusLine[] {
  const out: StatusLine[] = [];
  for (const n of mr.nudges ?? []) {
    out.push({
      tone: 'warn',
      word: `${n.from} asked for a re-review`,
      detail: agoMs(n.receivedAt, now),
      verbs: [{ kind: 're-review', label: 're-review' }],
    });
  }
  for (const draft of mr.drafts ?? []) {
    if (resolved.get(draftKey(mr.webUrl ?? '', draft.kind))) continue;
    out.push({
      tone: 'warn',
      word: `held: ${draft.kind}`,
      detail: 'doctor draft',
      verbs: [{ kind: 'read-note', label: 'read', draft }],
    });
  }
  const sent = mr.sentNudge;
  if (sent) {
    if (NUDGE_RETRYABLE.has(sent.display)) {
      out.push({
        tone: 'warn',
        word: `nudge to ${sent.reviewer} went unanswered`,
        detail: (sent as { reason?: string }).reason,
        verbs: [],
      });
    } else if (sent.display === 'requested') {
      const at = (sent as { sentAt?: number }).sentAt;
      out.push({
        tone: 'quiet',
        word: `nudged ${sent.reviewer}`,
        detail: at ? `no answer yet, ${ago(new Date(at).toISOString(), now)}` : 'no answer yet',
        verbs: [],
      });
    } else {
      out.push({
        tone: 'work',
        word: `${sent.reviewer} re-reviewing…`,
        spin: true,
        verbs: [],
      });
    }
  }
  for (const p of mr.peerReviews ?? []) {
    if (p.status === 'queued' || p.status === 'reviewing') {
      out.push({
        tone: 'work',
        word: `${p.reviewer} is reviewing…`,
        spin: true,
        verbs: [{ kind: 'view-peer', label: 'view ↗' }],
      });
    } else if (p.status === 'done') {
      const verdict =
        p.outcome === 'approve' ? 'approved' : p.outcome === 'comment' ? 'commented' : 'reviewed';
      out.push({
        tone: 'go',
        word: `${p.reviewer} ${verdict}`,
        verbs: [{ kind: 'view-peer', label: 'view ↗' }],
      });
    }
  }
  const humans = activeReviewers(mr);
  if (humans.length) {
    out.push({
      tone: 'quiet',
      word: `${humans.join(', ')} ${humans.length === 1 ? 'is' : 'are'} reviewing right now`,
      verbs: [],
    });
  }
  return out;
}

export function candidateLines(
  mr: BoardMRWithReview,
  now: number,
  draftResolved: Resolved
): StatusLine[] {
  const lines: StatusLine[] = [
    ...gateLines(mr),
    orphanLine(mr, now),
    reviewLine(mr, now),
    respondLine(mr),
    doctorLine(mr),
    ...socialLines(mr, now, draftResolved),
  ].filter((l): l is StatusLine => l !== null);
  if (lines.length === 0) {
    return [
      {
        tone: 'clear',
        word: 'all clear',
        detail: 'enjoy the sunshine',
        verbs: [{ kind: 'open-mr', label: 'open ↗' }],
      },
    ];
  }
  return lines;
}

/** The single status line a row shows: the hottest candidate, with ties
    settled by source order (gates before lanes before social), so a decision
    always outranks the lane it came from. */
export function rowStatus(
  mr: BoardMRWithReview,
  now: number,
  draftResolved: Resolved
): RowStatus {
  const lines = candidateLines(mr, now, draftResolved);
  const ranked = lines
    .map((line, index) => ({ line, index }))
    .sort((a, b) => TONE_RANK[a.line.tone] - TONE_RANK[b.line.tone] || a.index - b.index);
  const [first, ...rest] = ranked;
  const line = first!.line;
  return {
    line,
    more: rest.map(r => r.line),
    bar: line.tone === 'bad' || line.tone === 'warn' ? line.tone : null,
  };
}
```

Check `DOCTOR_LABEL` in `format.ts` for the exact working words (`diagnosing…`, `rebasing…`, `fixing…`, `watching CI…`) and `NUDGE_RETRYABLE` for the retryable displays; both are imported, not restated.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd apps/board && bun test src/client/board/__tests__/row-status.test.ts`
Expected: PASS. If the live-reviewer test fails on the `reviewState` literal, fix the literal in the test to one `getReviewDisplayState` maps to `'reviewing'`; the derivation is not at fault.

- [ ] **Step 6: Gates and commit**

From the repo root: `bun run board:typecheck && bunx prettier --write apps/board/src/client/board/row-status.ts apps/board/src/client/board/__tests__/row-status.test.ts && bun run format:check && bash scripts/repo-purity.sh`

```bash
git add apps/board/src/client/board/row-status.ts apps/board/src/client/board/__tests__/row-status.test.ts apps/board/src/client/types.ts
git commit -m "board: row-status derives the single status line per row"
```

---

### Task 2: `slack-ladder.ts` and `threads-seen.ts`

**Files:**
- Create: `apps/board/src/client/board/slack-ladder.ts`
- Create: `apps/board/src/client/board/threads-seen.ts`
- Test: `apps/board/src/client/board/__tests__/slack-ladder.test.ts`
- Test: `apps/board/src/client/board/__tests__/threads-seen.test.ts`

**Interfaces:**
- Consumes: `SlackInfo` from `../types.ts`; `SlackMark` shape from `format.ts` (`{ emoji, glyph, label, title }`, in the fixed order looking, commented, approved).
- Produces:

```ts
// slack-ladder.ts
export type SlackStage = 'looking' | 'commented' | 'approved';
export interface SlackLadder { posted: boolean; stage: SlackStage | null }
export function slackLadder(slack: SlackInfo | undefined, marks: ReadonlyArray<{ emoji: string }>): SlackLadder;

// threads-seen.ts
export function threadNewness(seen: number | null, count: number): { fresh: boolean; record: number | null };
export function seenCount(webUrl: string): number | null;
export function markSeen(webUrl: string, count: number): void;
```

- [ ] **Step 1: Write the failing tests**

`apps/board/src/client/board/__tests__/slack-ladder.test.ts`:

```ts
import { expect, test } from 'bun:test';

import { slackLadder } from '../slack-ladder.ts';

const MARKS = [{ emoji: 'eyes' }, { emoji: 'speech_balloon' }, { emoji: 'white_check_mark' }];

test('no slack info: not posted, no stage', () => {
  expect(slackLadder(undefined, MARKS)).toEqual({ posted: false, stage: null });
});

test('posted with no reactions: the logo alone', () => {
  expect(slackLadder({ status: 'found', reactions: [], posted: true }, MARKS)).toEqual({
    posted: true,
    stage: null,
  });
});

test('the furthest reaction wins the stage', () => {
  expect(
    slackLadder({ status: 'found', reactions: ['eyes'], posted: true }, MARKS).stage
  ).toBe('looking');
  expect(
    slackLadder({ status: 'found', reactions: ['eyes', 'speech_balloon'], posted: true }, MARKS)
      .stage
  ).toBe('commented');
  expect(
    slackLadder({ status: 'found', reactions: ['white_check_mark', 'eyes'], posted: true }, MARKS)
      .stage
  ).toBe('approved');
});

test('reactions on an unposted message count for nothing', () => {
  expect(
    slackLadder({ status: 'found', reactions: ['white_check_mark'], posted: false }, MARKS)
  ).toEqual({ posted: false, stage: null });
});

test('unknown reactions are ignored', () => {
  expect(
    slackLadder({ status: 'found', reactions: ['tada'], posted: true }, MARKS).stage
  ).toBeNull();
});
```

`apps/board/src/client/board/__tests__/threads-seen.test.ts`:

```ts
import { expect, test } from 'bun:test';

import { threadNewness } from '../threads-seen.ts';

test('a first sighting is never new; it records the baseline', () => {
  expect(threadNewness(null, 5)).toEqual({ fresh: false, record: 5 });
});

test('growth past the baseline is new and records nothing', () => {
  expect(threadNewness(3, 5)).toEqual({ fresh: true, record: null });
});

test('no growth is not new', () => {
  expect(threadNewness(5, 5)).toEqual({ fresh: false, record: null });
  expect(threadNewness(7, 5)).toEqual({ fresh: false, record: null });
});

test('zero threads on a first sighting records zero', () => {
  expect(threadNewness(null, 0)).toEqual({ fresh: false, record: 0 });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/board && bun test src/client/board/__tests__/slack-ladder.test.ts src/client/board/__tests__/threads-seen.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement both modules**

`apps/board/src/client/board/slack-ladder.ts`:

```ts
import type { SlackInfo } from '../types.ts';

export type SlackStage = 'looking' | 'commented' | 'approved';

export interface SlackLadder {
  posted: boolean;
  stage: SlackStage | null;
}

const STAGES: SlackStage[] = ['looking', 'commented', 'approved'];

/** The furthest review-signal reaction on the posted message, in the
    marks' fixed order (looking, commented, approved). Reactions on an
    unposted message are noise from another thread and count for nothing. */
export function slackLadder(
  slack: SlackInfo | undefined,
  marks: ReadonlyArray<{ emoji: string }>
): SlackLadder {
  if (!slack?.posted) return { posted: false, stage: null };
  let stage: SlackStage | null = null;
  marks.forEach((mark, i) => {
    if (slack.reactions.includes(mark.emoji)) stage = STAGES[i] ?? stage;
  });
  return { posted: true, stage };
}
```

`apps/board/src/client/board/threads-seen.ts`:

```ts
const KEY_PREFIX = 'board.threads.seen:';

/** Whether a thread count has grown since the board last recorded it. A
    missing record is a first sighting: not new, and the count becomes the
    baseline (otherwise every threaded row lights up on a fresh browser). */
export function threadNewness(
  seen: number | null,
  count: number
): { fresh: boolean; record: number | null } {
  if (seen === null) return { fresh: false, record: count };
  return { fresh: count > seen, record: null };
}

export function seenCount(webUrl: string): number | null {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + webUrl);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function markSeen(webUrl: string, count: number): void {
  try {
    localStorage.setItem(KEY_PREFIX + webUrl, String(count));
  } catch {
    // Storage can be unavailable (private mode, quota); the row simply
    // never lights up, which is the safe direction.
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/board && bun test src/client/board/__tests__/slack-ladder.test.ts src/client/board/__tests__/threads-seen.test.ts`
Expected: PASS.

- [ ] **Step 5: Gates and commit**

`bun run board:typecheck && bunx prettier --write apps/board/src/client/board/slack-ladder.ts apps/board/src/client/board/threads-seen.ts apps/board/src/client/board/__tests__/slack-ladder.test.ts apps/board/src/client/board/__tests__/threads-seen.test.ts && bun run format:check && bash scripts/repo-purity.sh`

```bash
git add apps/board/src/client/board/slack-ladder.ts apps/board/src/client/board/threads-seen.ts apps/board/src/client/board/__tests__/slack-ladder.test.ts apps/board/src/client/board/__tests__/threads-seen.test.ts
git commit -m "board: slack ladder and thread newness derivations"
```

---

### Task 3: `icons.tsx` and `StatusLine.tsx`

**Files:**
- Create: `apps/board/src/client/board/icons.tsx`
- Create: `apps/board/src/client/board/StatusLine.tsx`
- Modify: `apps/board/src/client/types.ts` (`RowContext` gains four handlers)
- Modify: `apps/board/src/client/board/Board.tsx` (`rowCtx` passes them)
- Test: `apps/board/src/client/board/__tests__/status-line-dom.test.tsx`

**Interfaces:**
- Consumes: `RowStatus`, `Verb` from `./row-status.ts` (Task 1).
- Produces:

```tsx
// icons.tsx: every icon is 14px, fill style, currentColor, vertical-align -2.5px
export function SlackLogo(): JSX.Element;   // brand colors, the one colored icon
export function Eyes(): JSX.Element;
export function Bubble(): JSX.Element;
export function DiscCheck(): JSX.Element;
export function Sun(): JSX.Element;

// StatusLine.tsx
export function StatusLine({ mr, status, ctx }: { mr: BoardMRWithReview; status: RowStatus; ctx: RowContext }): JSX.Element;
```

`RowContext` additions (in `types.ts`):

```ts
  onLaunch: (mr: BoardMR, note?: string, intent?: 'launch' | 'focus') => void;
  onReReview: (mr: BoardMR, note?: string) => void;
  onRespond: (mr: BoardMR, note?: string, intent?: 'launch' | 'focus') => void;
  onDoctor: (mr: BoardMR, note?: string, intent?: 'launch' | 'focus') => void;
```

- [ ] **Step 1: Extend `RowContext` and `rowCtx`**

In `types.ts`, add the four fields above to `RowContext` (after `onFocusPane`). In `Board.tsx`, inside the `rowCtx` literal, add `onLaunch: handleLaunch, onReReview: handleReReview, onRespond: handleRespond, onDoctor: handleDoctor,`. Run `bun run board:typecheck`; it must pass before moving on (any other `RowContext` literal in tests will fail to compile and must gain the same four fields as `() => {}` stubs).

- [ ] **Step 2: Write the failing DOM test**

`apps/board/src/client/board/__tests__/status-line-dom.test.tsx`:

```tsx
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'bun:test';

GlobalRegistrator.register({ url: 'http://localhost/' });

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let React: typeof import('react');
let createRoot: typeof import('react-dom/client').createRoot;
let StatusLine: typeof import('../StatusLine.tsx').StatusLine;
type RowContext = import('../../types.ts').RowContext;
type BoardMRWithReview = import('../../types.ts').BoardMRWithReview;
type RowStatus = import('../row-status.ts').RowStatus;

beforeAll(async () => {
  React = await import('react');
  ({ createRoot } = await import('react-dom/client'));
  ({ StatusLine } = await import('../StatusLine.tsx'));
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

const MR = {
  iid: 1418,
  webUrl: 'https://gitlab.example.com/acme/webapp/-/merge_requests/1418',
  gates: [],
} as unknown as BoardMRWithReview;

function ctx(over: Partial<RowContext> = {}): RowContext {
  const noop = () => {};
  return {
    local: true,
    slackTemplates: { single: '', multiHeader: '', multiItem: '' },
    slackEnabled: false,
    onContext: noop,
    onOpenReview: noop,
    onOpenRespond: noop,
    onOpenDraft: noop,
    draftResolved: new Map(),
    onResumeRespond: noop,
    onFocusPane: noop,
    onOpenGate: noop,
    selected: new Set(),
    onToggleSelect: noop,
    queueExtras: [],
    onResumeOrphan: noop,
    onClearOrphan: noop,
    onLaunch: noop,
    onReReview: noop,
    onRespond: noop,
    onDoctor: noop,
    ...over,
  } as RowContext;
}

let container: HTMLElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await React.act(async () => root.unmount());
  container.remove();
});

async function render(status: RowStatus, c: RowContext) {
  await React.act(async () => {
    root.render(<StatusLine mr={MR} status={status} ctx={c} />);
  });
}

test('a hot line renders its word, detail, and the primary verb; the secondary verb is marked hover-only', async () => {
  const calls: string[] = [];
  await render(
    {
      line: {
        tone: 'warn',
        word: 'review interrupted',
        detail: 'pane closed 12m ago',
        verbs: [
          { kind: 'relaunch', label: 'relaunch', domain: 'review' },
          { kind: 'clear', label: 'clear', agentId: 'ag-1' },
        ],
      },
      more: [],
      bar: 'warn',
    },
    ctx({
      onFocusPane: (_mr, domain) => calls.push(`focus:${domain}`),
      onClearOrphan: id => calls.push(`clear:${id}`),
    })
  );
  const line = container.querySelector('.tui-status')!;
  expect(line.getAttribute('data-tone')).toBe('warn');
  expect(line.querySelector('.tui-status-word')!.textContent).toBe('review interrupted');
  expect(line.querySelector('.tui-status-detail')!.textContent).toBe('pane closed 12m ago');
  const verbs = [...line.querySelectorAll<HTMLButtonElement>('button[data-verb]')];
  expect(verbs.map(v => v.dataset.verb)).toEqual(['relaunch', 'clear']);
  expect(verbs[0]!.dataset.secondary).toBeUndefined();
  expect(verbs[1]!.dataset.secondary).toBe('true');
  await React.act(async () => verbs[0]!.click());
  await React.act(async () => verbs[1]!.click());
  expect(calls).toEqual(['focus:review', 'clear:ag-1']);
});

test('a working line renders the spinner ring, not a dot', async () => {
  await render(
    { line: { tone: 'work', word: 'review running…', spin: true, verbs: [] }, more: [], bar: null },
    ctx()
  );
  expect(container.querySelector('.tui-status-ring')).not.toBeNull();
});

test('an answer verb opens the queue on its gate', async () => {
  const opened: string[] = [];
  await render(
    {
      line: { tone: 'warn', word: 'post which findings?', verbs: [{ kind: 'answer', label: 'answer', gateId: 'g1' }] },
      more: [],
      bar: 'warn',
    },
    ctx({ onOpenGate: id => opened.push(id) })
  );
  await React.act(async () => container.querySelector<HTMLButtonElement>('button[data-verb="answer"]')!.click());
  expect(opened).toEqual(['g1']);
});

test('the all-clear line carries the sun and an open verb', async () => {
  await render(
    {
      line: { tone: 'clear', word: 'all clear', detail: 'enjoy the sunshine', verbs: [{ kind: 'open-mr', label: 'open ↗' }] },
      more: [],
      bar: null,
    },
    ctx()
  );
  expect(container.querySelector('.tui-status[data-tone="clear"] svg')).not.toBeNull();
  expect(container.querySelector('button[data-verb="open-mr"]')!.textContent).toBe('open ↗');
});

test('suppressed candidates render as +N active with their words in the title', async () => {
  await render(
    {
      line: { tone: 'warn', word: 'post which findings?', verbs: [] },
      more: [
        { tone: 'work', word: 'implementing…', verbs: [] },
        { tone: 'work', word: 'watching CI…', verbs: [] },
      ],
      bar: 'warn',
    },
    ctx()
  );
  const more = container.querySelector('.tui-status-more')!;
  expect(more.textContent).toBe('+2 active');
  expect(more.getAttribute('title')).toBe('implementing…, watching CI…');
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd apps/board && bun test src/client/board/__tests__/status-line-dom.test.tsx`
Expected: FAIL, `StatusLine.tsx` not found.

- [ ] **Step 4: Implement `icons.tsx`**

```tsx
const ICON = {
  width: 14,
  height: 14,
  viewBox: '0 0 16 16',
  'aria-hidden': true,
  style: { verticalAlign: '-2.5px', flexShrink: 0 } as const,
};

export function SlackLogo() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" aria-hidden style={ICON.style}>
      <path fill="#E01E5A" d="M5 15a2 2 0 1 1-2-2h2v2Zm1 0a2 2 0 0 1 4 0v5a2 2 0 1 1-4 0v-5Z" />
      <path fill="#36C5F0" d="M9 5a2 2 0 1 1 2-2v2H9Zm0 1a2 2 0 0 1 0 4H4a2 2 0 1 1 0-4h5Z" />
      <path fill="#2EB67D" d="M19 9a2 2 0 1 1 2 2h-2V9Zm-1 0a2 2 0 0 1-4 0V4a2 2 0 1 1 4 0v5Z" />
      <path fill="#ECB22E" d="M15 19a2 2 0 1 1-2 2v-2h2Zm0-1a2 2 0 0 1 0-4h5a2 2 0 1 1 0 4h-5Z" />
    </svg>
  );
}

export function Eyes() {
  return (
    <svg {...ICON} fill="currentColor">
      <ellipse cx="4.6" cy="8" rx="3.1" ry="5.2" />
      <ellipse cx="11.4" cy="8" rx="3.1" ry="5.2" />
      <circle cx="4" cy="9" r="1.4" fill="var(--bg)" />
      <circle cx="10.8" cy="9" r="1.4" fill="var(--bg)" />
    </svg>
  );
}

export function Bubble() {
  return (
    <svg {...ICON} fill="currentColor">
      <path d="M2.5 2.5h11a1.2 1.2 0 0 1 1.2 1.2v6.6a1.2 1.2 0 0 1-1.2 1.2H8.4L5 14.5v-3H2.5a1.2 1.2 0 0 1-1.2-1.2V3.7a1.2 1.2 0 0 1 1.2-1.2z" />
      <circle cx="5.6" cy="7" r="1.05" fill="var(--bg)" />
      <circle cx="10.4" cy="7" r="1.05" fill="var(--bg)" />
    </svg>
  );
}

export function DiscCheck() {
  return (
    <svg {...ICON} fill="currentColor">
      <circle cx="8" cy="8" r="6.6" />
      <path d="M5.1 8.3l1.9 1.9 3.9-4.5" fill="none" stroke="var(--bg)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Sun() {
  return (
    <svg {...ICON} fill="currentColor" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="8" cy="8" r="3.3" stroke="none" />
      <path d="M8 1.2v2.2M8 12.6v2.2M1.2 8h2.2M12.6 8h2.2M3.2 3.2l1.6 1.6M11.2 11.2l1.6 1.6M12.8 3.2l-1.6 1.6M4.8 11.2l-1.6 1.6" />
    </svg>
  );
}
```

- [ ] **Step 5: Implement `StatusLine.tsx`**

```tsx
import type { BoardMRWithReview, RowContext } from '../types.ts';
import { Sun } from './icons.tsx';
import type { RowStatus, Verb } from './row-status.ts';

function runVerb(verb: Verb, mr: BoardMRWithReview, ctx: RowContext): void {
  switch (verb.kind) {
    case 'relaunch':
    case 'focus':
      ctx.onFocusPane(mr, verb.domain ?? 'review');
      return;
    case 'clear':
      if (verb.agentId) ctx.onClearOrphan(verb.agentId);
      return;
    case 'answer':
      if (verb.gateId) ctx.onOpenGate(verb.gateId);
      return;
    case 'read-review':
      ctx.onOpenReview(mr);
      return;
    case 'read-respond':
      ctx.onOpenRespond(mr);
      return;
    case 'resume-respond':
      ctx.onResumeRespond(mr);
      return;
    case 'launch-review':
      ctx.onLaunch(mr);
      return;
    case 'restart-respond':
      ctx.onRespond(mr);
      return;
    case 'call-doctor':
      ctx.onDoctor(mr);
      return;
    case 're-review':
      ctx.onReReview(mr);
      return;
    case 'read-note':
      if (verb.draft) ctx.onOpenDraft(mr, verb.draft);
      return;
    case 'view-peer':
    case 'open-mr':
      if (mr.webUrl) window.open(mr.webUrl, '_blank', 'noopener');
      return;
  }
}

/** The row's one status line. Verbs are buttons so the row's own click
    (open in GitLab) ignores them; the first verb shows at rest, the rest
    only under the pointer (style.css keys on `data-secondary`). */
export function StatusLine({
  mr,
  status,
  ctx,
}: {
  mr: BoardMRWithReview;
  status: RowStatus;
  ctx: RowContext;
}) {
  const { line, more } = status;
  const hot = line.tone === 'bad' || line.tone === 'warn';
  return (
    <div className="tui-status" data-tone={line.tone}>
      <span className="tui-status-word">
        {line.tone === 'clear' && <Sun />}
        {line.word}
      </span>
      {line.spin && <span className="tui-status-ring" aria-hidden />}
      {line.detail && <span className="tui-status-detail">{line.detail}</span>}
      {more.length > 0 && (
        <span className="tui-status-more" title={more.map(l => l.word).join(', ')}>
          +{more.length} active
        </span>
      )}
      {line.verbs.length > 0 && (
        <span className="tui-status-verbs">
          {line.verbs.map((verb, i) => (
            <button
              key={verb.kind + i}
              type="button"
              className="tui-status-verb"
              data-verb={verb.kind}
              data-hot={hot && i === 0 ? 'true' : undefined}
              data-secondary={i > 0 ? 'true' : undefined}
              onClick={e => {
                e.stopPropagation();
                runVerb(verb, mr, ctx);
              }}
            >
              {verb.label}
            </button>
          ))}
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd apps/board && bun test src/client/board/__tests__/status-line-dom.test.tsx`
Expected: PASS. Then `bun run board:typecheck` from the root; fix any `RowContext` literal in existing tests that now lacks the four handlers.

- [ ] **Step 7: Gates and commit**

`bunx prettier --write apps/board/src/client/board/icons.tsx apps/board/src/client/board/StatusLine.tsx apps/board/src/client/board/__tests__/status-line-dom.test.tsx apps/board/src/client/types.ts apps/board/src/client/board/Board.tsx && bun run board:typecheck && bun run board:test && bun run format:check && bash scripts/repo-purity.sh`

```bash
git add apps/board/src/client/board/icons.tsx apps/board/src/client/board/StatusLine.tsx apps/board/src/client/board/__tests__/status-line-dom.test.tsx apps/board/src/client/types.ts apps/board/src/client/board/Board.tsx
git commit -m "board: StatusLine renders the row status with verbs mapped onto RowContext"
```

---

### Task 4: rewrite `RowView.tsx` on the new anatomy

**Files:**
- Rewrite: `apps/board/src/client/board/RowView.tsx`
- Modify: `apps/board/src/client/board/CommentsDrawer.tsx` (add `ThreadsLink`; keep `CommentsDrawer`, `CommentsTrigger`; delete `CommentsButton`, `CommentsToken` once nothing imports them)
- Modify: `apps/board/src/client/board/DecisionQueueModal.tsx` (import the two message constants from `./row-status.ts`)
- Delete: `apps/board/src/client/board/BoardBadges.tsx`, `apps/board/src/client/board/GateRowChips.tsx`, `apps/board/src/client/board/GateRowChips.stories.tsx`
- Modify: `apps/board/src/client/board/chips.tsx` (delete `ReviewBadge`, `RespondBadge`, `DoctorBadge`, `PeerBadge`, `NudgeChip`, `NudgedByMarker`, `DraftBadge`, `SlackReactionChips`, `SlackPostedChip`, `BADGE_ICON`, the intent maps only they used; keep `SLACK_ICON`, `SlackPostedMark`, `PEER_GLYPH` if `grep -rn` finds another consumer)
- Modify: `apps/board/src/client/board/format.ts` (delete `hasBoardBadges`; keep everything else)
- Modify: `apps/board/src/client/board/GateForm.tsx` (the doc comment naming `GateRowChips` now names `DecisionQueueModal`)
- Delete tests: `orphan-strip-dom.test.tsx`, `gate-row-chips.test.tsx`, `interrupted-badge-dom.test.tsx`
- Create test: `apps/board/src/client/board/__tests__/row-view-dom.test.tsx`
- Modify tests: `decision-queue-dom.test.tsx`, `gate-deep-link-dom.test.tsx`, `attention-card-dom.test.tsx` (selectors)

**Interfaces:**
- Consumes: `rowStatus` (Task 1), `slackLadder` (Task 2), `threadNewness`/`seenCount`/`markSeen` (Task 2), `StatusLine` and icons (Task 3), `getSlackMarks`, `statusFlags`, `statusPhrase`, `behindToken`, `commentCount`, `cleanTitle`, `mrLine`, `ago`, `nestStacks`, `flattenStack` from their current homes.
- Produces: the DOM contract style.css (Task 5) and the tests key on:

```
.tui-row[data-tone=bad|warn]        the row; tone set only when a bar shows
  .tui-row-bar                      the 3px edge bar (present only when bar != null)
  .tui-row-pick                     gutter: StatusDot + SelectBox
  .tui-row-body
    .tui-row-1                      [draft chip] .tui-title [ticket] [copy] .tui-row-marks .tui-phrase [flags]
      .tui-row-marks                [stage icon][SlackLogo]  (data-slack-stage on the stage icon's span)
    .tui-row-2                      [author] .tui-mr-iid .tui-branch .tui-diff | .tui-facts: .tui-threads[data-new] .tui-age
    .tui-status                     from StatusLine
.tui-rows[data-selecting]           set when ctx.selected.size > 0
```

- [ ] **Step 1: Write the failing DOM test**

`apps/board/src/client/board/__tests__/row-view-dom.test.tsx`:

```tsx
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'bun:test';

GlobalRegistrator.register({ url: 'http://localhost/' });
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let React: typeof import('react');
let createRoot: typeof import('react-dom/client').createRoot;
let RowView: typeof import('../RowView.tsx').RowView;
type RowContext = import('../../types.ts').RowContext;
type BoardMRWithReview = import('../../types.ts').BoardMRWithReview;

beforeAll(async () => {
  React = await import('react');
  ({ createRoot } = await import('react-dom/client'));
  ({ RowView } = await import('../RowView.tsx'));
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

const NOW = Date.parse('2026-09-12T12:00:00Z');
const URL = 'https://gitlab.example.com/acme/webapp/-/merge_requests/1418';

function mr(over: Partial<BoardMRWithReview> = {}): BoardMRWithReview {
  return {
    iid: 1418,
    title: 'ACME-2214 Port the v2 quiet-mode flows',
    webUrl: URL,
    sourceBranch: 'feature/acme-2214',
    targetBranch: 'main',
    author: { username: 'pat', name: 'Pat' },
    reviews: { isApproved: false, required: 1, given: 0, reviewers: [] },
    reviewerComments: 0,
    diff: { additions: 1455, deletions: 13, filesChanged: 4 },
    updatedAt: new Date(NOW - 32 * 3600_000).toISOString(),
    threadSummary: { awaiting: 1, replied: 0, resolved: 0 },
    generalComments: 0,
    blockers: { any: false },
    mergeButton: { visible: false, disabled: false, loading: false },
    rebaseButton: { visible: false, loading: false },
    autoMergeButton: { visible: false, isActive: false },
    behindTarget: null,
    isDraft: false,
    codeownerSections: [],
    gates: [],
    ...over,
  } as unknown as BoardMRWithReview;
}

function ctx(over: Partial<RowContext> = {}): RowContext {
  const noop = () => {};
  return {
    local: true,
    slackTemplates: { single: '{title}', multiHeader: '', multiItem: '' },
    slackEnabled: true,
    onContext: noop,
    onOpenReview: noop,
    onOpenRespond: noop,
    onOpenDraft: noop,
    draftResolved: new Map(),
    onResumeRespond: noop,
    onFocusPane: noop,
    onOpenGate: noop,
    selected: new Set(),
    onToggleSelect: noop,
    queueExtras: [],
    onResumeOrphan: noop,
    onClearOrphan: noop,
    onLaunch: noop,
    onReReview: noop,
    onRespond: noop,
    onDoctor: noop,
    ...over,
  } as RowContext;
}

let container: HTMLElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await React.act(async () => root.unmount());
  container.remove();
});

async function render(rows: BoardMRWithReview[], c = ctx()) {
  await React.act(async () => {
    root.render(<RowView mrs={rows} now={NOW} showAuthor={false} ctx={c} />);
  });
}

test('a quiet row: three lines, no bar, no separator glyphs, all-clear status', async () => {
  await render([mr()]);
  const row = container.querySelector('.tui-row')!;
  expect(row.querySelector('.tui-row-bar')).toBeNull();
  expect(row.getAttribute('data-tone')).toBeNull();
  expect(row.querySelector('.tui-mr-iid')!.textContent).toBe('!1418');
  expect(row.querySelector('.tui-branch')!.textContent).toBe('feature/acme-2214');
  expect(row.querySelector('.tui-diff')!.textContent).toBe('+1455 −13');
  expect(row.querySelector('.tui-threads')!.textContent).toBe('1 thread');
  expect(row.querySelector('.tui-age')!.textContent).toBe('32h');
  expect(row.querySelector('.tui-status')!.getAttribute('data-tone')).toBe('clear');
  expect(row.textContent).not.toContain('·');
  expect(row.textContent).not.toContain('|');
  expect(row.querySelector('.tui-row-sep')).toBeNull();
});

test('an interrupted review paints the warn bar and tone on the row', async () => {
  await render([
    mr({
      review: { status: 'reviewing', sessionId: 'sess-1' },
      orphan: {
        agentId: 'ag-1', repo: null, subject: 'agent:ag-1', surface: 'herdr',
        sessionId: 'sess-1', paneRef: null, state: 'gone', since: NOW - 60_000, openGateIds: [],
      },
    }),
  ]);
  const row = container.querySelector('.tui-row')!;
  expect(row.getAttribute('data-tone')).toBe('warn');
  expect(row.querySelector('.tui-row-bar')!.getAttribute('data-tone')).toBe('warn');
  expect(row.querySelector('.tui-status-word')!.textContent).toBe('review interrupted');
  expect(row.querySelector('button[data-verb="relaunch"]')).not.toBeNull();
  // The old chips-on-chips surfaces are gone for good.
  expect(row.querySelector('.tui-orphan-strip')).toBeNull();
  expect(row.querySelector('.tui-row-board')).toBeNull();
  expect(row.querySelector('.tui-executor-dot')).toBeNull();
});

test('the slack ladder: logo only once posted, stage mark for the furthest reaction', async () => {
  await render([mr({ slack: { status: 'found', reactions: [], posted: false } })]);
  expect(container.querySelector('.tui-row-marks svg')).toBeNull();
  await render([
    mr({ slack: { status: 'found', reactions: ['eyes', 'white_check_mark'], posted: true } }),
  ]);
  const marks = container.querySelector('.tui-row-marks')!;
  expect(marks.querySelector('[data-slack-stage]')!.getAttribute('data-slack-stage')).toBe('approved');
  expect(marks.querySelector('[data-slack-logo]')).not.toBeNull();
});

test('thread newness: the first sighting records a baseline, growth lights the link, opening the drawer clears it', async () => {
  await render([mr({ threadSummary: { awaiting: 3, replied: 0, resolved: 0 } })]);
  expect(container.querySelector('.tui-threads')!.getAttribute('data-new')).toBeNull();
  expect(localStorage.getItem(`board.threads.seen:${URL}`)).toBe('3');

  await render([mr({ threadSummary: { awaiting: 5, replied: 0, resolved: 0 } })]);
  const link = container.querySelector<HTMLButtonElement>('.tui-threads')!;
  expect(link.getAttribute('data-new')).toBe('true');
  expect(link.getAttribute('title')).toBe('2 new since you last looked');

  await React.act(async () => link.click());
  expect(localStorage.getItem(`board.threads.seen:${URL}`)).toBe('5');
  expect(container.querySelector('.tui-cd, .tui-comments-drawer, [data-part="drawer"]')).not.toBeNull();
});

test('mechanical flags render inline on line 1, never as their own line', async () => {
  await render([
    mr({ blockers: { any: true, hasConflicts: true, pipelineFailing: false } } as never),
  ]);
  const row = container.querySelector('.tui-row')!;
  expect(row.querySelector('.tui-row-review')).toBeNull();
  expect(row.querySelector('.tui-row-1 [data-flag]')).not.toBeNull();
});

test('selection mode marks the list so the gutter checkboxes show at rest', async () => {
  await render([mr()], ctx({ selected: new Set([URL]) }));
  expect(container.querySelector('.tui-rows')!.getAttribute('data-selecting')).toBe('true');
});
```

Read `CommentsDrawer.tsx` before writing the drawer assertion in the newness test: the selector must match the drawer's actual root class (`grep -n "className=" apps/board/src/client/board/CommentsDrawer.tsx | sed -n '1,40p'`); replace the three-way selector with the real one.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/board && bun test src/client/board/__tests__/row-view-dom.test.tsx`
Expected: FAIL (the current row renders `.tui-row-sep`, `.tui-row-board`, no `.tui-status`).

- [ ] **Step 3: Add `ThreadsLink` to `CommentsDrawer.tsx`**

Beside `CommentsTrigger`, add and export:

```tsx
/** The thread count on the facts line: the row's one entry into the
    comments drawer. `fresh` lights it (style.css keys on `data-new`);
    opening the drawer is what records the count as seen. */
function ThreadsLink({
  mr,
  count,
  fresh,
  onOpen,
}: {
  mr: BoardMR;
  count: number;
  fresh: boolean;
  onOpen: () => void;
}) {
  const [open, setOpen] = useState(false);
  const title = fresh ? undefined : 'open the comments drawer';
  return (
    <>
      <button
        type="button"
        className="tui-threads"
        data-new={fresh ? 'true' : undefined}
        title={title}
        onClick={e => {
          e.stopPropagation();
          onOpen();
          setOpen(true);
        }}
      >
        {count} thread{count === 1 ? '' : 's'}
      </button>
      {open && <CommentsDrawer mr={mr} onClose={() => setOpen(false)} />}
    </>
  );
}
```

(The caller sets the "N new since you last looked" title; see Step 4. Simplest: accept a `title` prop instead of computing it here. Do that: `title: string`.)

Delete `CommentsButton` and `CommentsToken` and their exports. `grep -rn "CommentsButton\|CommentsToken" apps/board/src` must return nothing but this file afterwards.

- [ ] **Step 4: Rewrite `RowView.tsx`**

```tsx
import { Invadr } from 'invadrs/react';

import { Chip, CopyButton, SelectBox } from '@mattstack/tui-kit';
import type { BoardMR } from '../../data.ts';
import { extractTicketId, ticketUrl } from '../../ticket.ts';
import {
  behindToken,
  nestStacks,
  statusFlags,
  type FlagClass,
} from '../../view.ts';
import type { BoardMRWithReview, RowContext } from '../types.ts';
import { ThreadsLink } from './CommentsDrawer.tsx';
import {
  ago,
  cleanTitle,
  commentCount,
  flattenStack,
  getSlackMarks,
  mrLine,
  statusPhrase,
} from './format.ts';
import { Bubble, DiscCheck, Eyes, SlackLogo } from './icons.tsx';
import { rowStatus } from './row-status.ts';
import { slackLadder, type SlackStage } from './slack-ladder.ts';
import { StatusDot } from './StatusDot.tsx';
import { StatusLine } from './StatusLine.tsx';
import { markSeen, seenCount, threadNewness } from './threads-seen.ts';

/** Plain click opens the MR in GitLab; right-click opens the row action menu
    (wired separately). Clicks on inner links/buttons are left to those. */
function onRowClick(e: React.MouseEvent, mr: BoardMR) {
  if ((e.target as HTMLElement).closest('a, button')) return;
  if (mr.webUrl) {
    markSeen(mr.webUrl, commentCount(mr));
    window.open(mr.webUrl, '_blank', 'noopener');
  }
}

const FLAG_INTENT: Record<FlagClass, 'ok' | 'bad' | 'warn' | 'cyan'> = {
  't-ok': 'ok',
  't-bad': 'bad',
  't-warn': 'warn',
  't-cyan': 'cyan',
};

function StatusFlags({ mr, nested = false }: { mr: BoardMR; nested?: boolean }) {
  return (
    <>
      {statusFlags(mr, { nested }).map(f => (
        <Chip key={f.text} intent={FLAG_INTENT[f.cls]} data-flag="">
          {f.text}
        </Chip>
      ))}
    </>
  );
}

function StatusPhrase({ mr }: { mr: BoardMR }) {
  const { text, cls } = statusPhrase(mr);
  return <span className={`tui-phrase ${cls}`}>{text}</span>;
}

const STAGE_ICON: Record<SlackStage, () => JSX.Element> = {
  looking: Eyes,
  commented: Bubble,
  approved: DiscCheck,
};
const STAGE_TITLE: Record<SlackStage, string> = {
  looking: 'someone is looking at this',
  commented: 'commented in slack',
  approved: 'approved in slack',
};

/** Line 1's Slack ladder: the furthest reaction as a mono mark, then the
    brand-colored logo once the MR is posted. Nothing renders before that. */
function SlackMarks({ mr }: { mr: BoardMRWithReview }) {
  const ladder = slackLadder(mr.slack, getSlackMarks());
  if (!ladder.posted) return null;
  const Stage = ladder.stage ? STAGE_ICON[ladder.stage] : null;
  return (
    <span className="tui-row-marks">
      {Stage && ladder.stage && (
        <span
          className="tui-mark"
          data-slack-stage={ladder.stage}
          title={STAGE_TITLE[ladder.stage]}
        >
          <Stage />
        </span>
      )}
      <span className="tui-mark" data-slack-logo="" title="posted in slack">
        <SlackLogo />
      </span>
    </span>
  );
}

function TicketLink({ ticket }: { ticket: string }) {
  return (
    <a
      className="tui-ticket"
      href={ticketUrl(ticket)}
      target="_blank"
      rel="noopener noreferrer"
      title={`open ${ticket} in Linear`}
      aria-label={`open ${ticket} in Linear`}
      onClick={e => e.stopPropagation()}
    >
      <svg viewBox="0 0 100 100" width="13" height="13" fill="currentColor" aria-hidden>
        <path d="M1.22541 61.5228c-.2225-.9485.90748-1.5459 1.59638-.857L39.3342 97.1783c.6889.6889.0915 1.8189-.857 1.5964C20.0515 94.4522 5.54779 79.9485 1.22541 61.5228ZM.00189135 46.8891c-.01764375.2833.08887215.5599.28957165.7606L52.3503 99.7085c.2007.2007.4773.3072.7606.2896 2.3692-.1476 4.6938-.46 6.9624-.9259.7645-.157 1.0301-1.0963.4782-1.6481L2.57595 39.4485c-.55186-.5519-1.49117-.2863-1.648174.4782-.465915 2.2686-.77832 4.5932-.92588465 6.9624ZM4.21093 29.7054c-.16649.3738-.08169.8106.20765 1.1l64.77602 64.776c.2894.2894.7262.3742 1.1.2077 1.7861-.7956 3.5171-1.6927 5.1855-2.684.5521-.328.6373-1.0867.1832-1.5407L8.43566 24.3367c-.45409-.4541-1.21271-.3689-1.54074.1832-.99128 1.6684-1.88843 3.3994-2.68399 5.1855ZM12.6587 18.074c-.3701-.3701-.393-.9637-.0443-1.3541C21.7795 6.45931 35.1114 0 49.9519 0 77.5927 0 100 22.4073 100 50.0481c0 14.8405-6.4593 28.1724-16.7199 37.3375-.3904.3487-.984.3258-1.3541-.0443L12.6587 18.074Z" />
      </svg>
    </a>
  );
}

/** The facts line's right rail: the thread count (the drawer's entry) and
    the age as the corner anchor. Newness is measured against the count the
    board last recorded for this MR; a first sighting sets that baseline. */
function Facts({ mr, now }: { mr: BoardMR; now: number }) {
  const count = commentCount(mr);
  const seen = mr.webUrl ? seenCount(mr.webUrl) : null;
  const newness = threadNewness(seen, count);
  if (newness.record !== null && mr.webUrl) markSeen(mr.webUrl, newness.record);
  const grew = seen === null ? 0 : count - seen;
  return (
    <span className="tui-facts">
      {count > 0 && (
        <ThreadsLink
          mr={mr}
          count={count}
          fresh={newness.fresh}
          title={newness.fresh ? `${grew} new since you last looked` : 'open the comments drawer'}
          onOpen={() => mr.webUrl && markSeen(mr.webUrl, count)}
        />
      )}
      <span className="tui-age" title="last updated">
        {ago(mr.updatedAt, now)}
      </span>
    </span>
  );
}

function AuthorTag({ mr }: { mr: BoardMR }) {
  const name = mr.author.name || mr.author.username;
  return (
    <span className="tui-author-tag" title={name}>
      <Invadr id={mr.author.username} palette="css-vars" className="tui-avatar" /> {name}
    </span>
  );
}

function RowView({
  mrs,
  now,
  showAuthor,
  ctx,
}: {
  mrs: BoardMR[];
  now: number;
  showAuthor: boolean;
  ctx: RowContext;
}) {
  const renderRow = (mr: BoardMR, depth: number) => {
    const mrx = mr as BoardMRWithReview;
    const ticket = extractTicketId(mr.sourceBranch, mr.title);
    const nested = depth > 0;
    const status = rowStatus(mrx, now, ctx.draftResolved);
    const behind = behindToken(mr);
    return (
      <div
        key={mr.iid}
        className={nested ? 'tui-row tui-row-nested' : 'tui-row'}
        data-mr-iid={mr.iid}
        data-tone={status.bar ?? undefined}
        data-local={ctx.local ? '1' : undefined}
        title={ctx.local ? 'right-click for actions' : undefined}
        onClick={e => onRowClick(e, mr)}
        onContextMenu={e => ctx.onContext(e, mr)}
      >
        {status.bar && <span className="tui-row-bar" data-tone={status.bar} aria-hidden />}
        <div className="tui-row-pick">
          <StatusDot mr={mr} />
          {mr.webUrl && (
            <SelectBox
              checked={ctx.selected.has(mr.webUrl)}
              onToggle={() => ctx.onToggleSelect(mr.webUrl!)}
            />
          )}
        </div>
        <div className="tui-row-body">
          <div className="tui-row-1">
            {mr.isDraft && (
              <Chip intent="muted" variant="subtle" uppercase data-draft="" title="draft, right-click to mark ready">
                draft
              </Chip>
            )}
            <span className="tui-title">{cleanTitle(mr.title)}</span>
            {ticket && <TicketLink ticket={ticket} />}
            <CopyButton
              text={mrLine(mr, ctx.slackTemplates)}
              className="tui-copy-inline"
              title="copy this MR for Slack"
            />
            <SlackMarks mr={mrx} />
            <StatusPhrase mr={mr} />
            <StatusFlags mr={mr} nested={nested} />
          </div>
          <div className="tui-row-2">
            {showAuthor && <AuthorTag mr={mr} />}
            <span className="tui-mr-iid">!{mr.iid}</span>
            <span className="tui-branch">{mr.sourceBranch}</span>
            {mr.diff && (
              <span className="tui-diff" title={`${mr.diff.filesChanged} files changed`}>
                <span className="tui-adds">+{mr.diff.additions}</span>{' '}
                <span className="tui-dels">−{mr.diff.deletions}</span>
              </span>
            )}
            {behind && (
              <span className="tui-behind" title={behind.title}>
                {behind.text}
              </span>
            )}
            <Facts mr={mr} now={now} />
          </div>
          <StatusLine mr={mrx} status={status} ctx={ctx} />
        </div>
      </div>
    );
  };
  return (
    <div className="tui-rows" data-selecting={ctx.selected.size > 0 ? 'true' : undefined}>
      {nestStacks(mrs).map(node =>
        node.children.length === 0 ? (
          renderRow(node.mr, 0)
        ) : (
          <div key={node.mr.iid} className="tui-stack-rows">
            {renderRow(node.mr, 0)}
            <div className="tui-stack-children">
              {flattenStack(node)
                .slice(1)
                .map(({ mr, depth }) => renderRow(mr, depth))}
            </div>
          </div>
        )
      )}
    </div>
  );
}

export { onRowClick, StatusFlags, StatusPhrase, TicketLink, AuthorTag, RowView };
```

`ThreadsLink` takes a `title: string` prop (adjust Step 3 accordingly). `markSeen` inside `Facts` runs during render and is idempotent (writes the same baseline); that is deliberate and bounded: it only fires when no record exists.

- [ ] **Step 5: Delete the retired components and repoint imports**

- Delete `BoardBadges.tsx`, `GateRowChips.tsx`, `GateRowChips.stories.tsx`.
- Delete the three test files named in the task header.
- In `DecisionQueueModal.tsx` change the import of `DELIVERY_STUCK_MESSAGE`/`EXECUTION_UNASSIGNED_MESSAGE` to `./row-status.ts`.
- In `chips.tsx` delete the badge components and their private maps. Before deleting each remaining export (`SLACK_ICON`, `SlackPostedMark`, `PEER_GLYPH`), run `grep -rn "<name>" apps/board/src --include=*.tsx --include=*.ts` and keep any with a consumer outside `chips.tsx`.
- In `format.ts` delete `hasBoardBadges` (and its export). If `REVIEW_LABEL`/`RESPOND_LABEL`/`RESPOND_ACTIVE`/`DOCTOR_ACTIVE`/`PEER_PHRASE`/`peerState`/`nudgeChipText`/`CHIP_CELL_WORDS` lose their last consumer, leave them (they are covered by `client-format.test.ts` and `optimistic.ts`); only `hasBoardBadges` goes.
- In `GateForm.tsx`'s doc comment, replace the `GateRowChips` mention with `DecisionQueueModal`.
- Update selectors in `decision-queue-dom.test.tsx`, `gate-deep-link-dom.test.tsx`, `attention-card-dom.test.tsx`: `.tui-orphan-strip` assertions become `.tui-status[data-tone]`/`button[data-verb="relaunch"]`; `[data-orphan-action="resume"]` becomes `button[data-verb="relaunch"]`; `[data-orphan-action="clear"]` becomes `button[data-verb="clear"]`; `.tui-executor-dot` assertions become `.tui-row-bar`; `[data-gate-delivery="stuck"]` / `[data-gate-execution="unassigned"]` on a row become `button[data-verb="answer"]` with the word checked via `.tui-status-word`. Read each test's intent before editing; the behavior under test stays, only the surface moved.

- [ ] **Step 6: Run the tests to verify they pass**

Run from the root: `bun run board:typecheck && bun run board:test`
Expected: PASS across the board suite. Then `grep -rn "hasBoardBadges\|BoardBadges\|GateRowChips\|CommentsToken\|CommentsButton\|OrphanStrip\|ExecutorDot\|tui-orphan\|tui-row-board\|tui-gate-row-face" apps/board/src` must print nothing (style.css hits are Task 5's).

- [ ] **Step 7: Gates and commit**

`bunx prettier --write $(git diff --name-only --diff-filter=AM | grep -E '\.(ts|tsx)$') && bun run format:check && bash scripts/repo-purity.sh`

```bash
git add -A apps/board/src
git commit -m "board: RowView on the fixed three-line anatomy with one status line"
```

---

### Task 5: `style.css`, the row block

**Files:**
- Modify: `apps/board/src/style.css` (the row block around lines 298-520, the orphan strip block around 775-800, `.tui-row-board` around 1424, `.tui-gate-row-face`/`.tui-gate-chip` around 1730, `.tui-executor-dot`, `.tui-comment-token`, `.tui-watching`, the stack-rail block around 1338-1390)

**Interfaces:**
- Consumes: the DOM contract from Task 4 and the token names already in the file (`--fg`, `--muted-text`, `--border-soft`, `--accent`, `--accent-text`, `--green`, `--red`, `--red-text`, `--amber`, `--purple`, `--card`, `--bg`, `--stack-rail`, `--type-body`, `--type-meta`).
- Produces: nothing programmatic; the capture harness in Task 6 records the result.

No unit test covers CSS; the verification is Task 6's captures plus a manual look at the fixture board. Still do the work in small commits.

- [ ] **Step 1: Delete the dead rules**

Remove every rule whose selector contains: `.tui-orphan-strip`, `.tui-orphan-reason`, `.tui-executor-dot`, `.tui-row-board`, `.tui-gate-row-face`, `.tui-gate-chip`, `.tui-watching`, `.tui-comment-token`, `.tui-comment-token-icon`, `.tui-row-sep`, `.tui-row-review`, `.tui-slack-reactions`, `.tui-slack-reaction`, `.tui-slack-posted` (keep `.tui-slack-posted` only if `SlackPostedMark` survived Task 4 with a header consumer), `[data-review]`, `[data-respond]`, `[data-doctor]`, `[data-peer]`, `[data-nudge]`, `[data-held-draft]`. Also delete the comment blocks that only explain those rules. Run `bun run board:test` (the `state-purity`/CSS contract tests, if any key on `CHIP_CELL_WORDS` selectors, will tell you if a selector was still expected).

- [ ] **Step 2: Rewrite the row block**

Replace the `.tui-row` through `.tui-meta` rules with:

```css
/* ── the row ─────────────────────────────────────────────────────────
   Fixed height, three lines, one content edge. The gutter holds the status
   dot (and the checkbox on hover / in select mode); the attention bar is
   flush to the row's left edge. Nothing on a row may grow it. */
.tui-rows {
  --row-h: 92px;
}
.tui-row {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr);
  align-items: start;
  height: var(--row-h);
  box-sizing: border-box;
  padding: 12px 16px 12px 0;
  cursor: pointer;
  position: relative;
  overflow: hidden;
}
.tui-row + .tui-row {
  border-top: 1px solid var(--border-soft);
}
.tui-row:hover {
  background: color-mix(in srgb, var(--accent) 6%, transparent);
}
.tui-row-bar {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  border-radius: 0 2px 2px 0;
}
.tui-row-bar[data-tone='warn'] {
  background: var(--amber);
}
.tui-row-bar[data-tone='bad'] {
  background: var(--red);
}
/* Gutter: the dot at rest, the checkbox under the pointer or while a
   selection exists. Both stay in the flow (opacity, not display) so the
   stack rail's pseudo-elements keep their anchor. */
.tui-row-pick {
  position: relative;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.tui-row-pick > [data-part='statusdot'] {
  position: absolute;
  transition: opacity 0.12s;
}
.tui-row-pick > [data-part='selectbox'],
.tui-row-pick > label,
.tui-row-pick > input {
  position: absolute;
  opacity: 0;
  transition: opacity 0.12s;
}
.tui-row:hover .tui-row-pick > [data-part='statusdot'],
.tui-rows[data-selecting] .tui-row-pick > [data-part='statusdot'] {
  opacity: 0;
}
.tui-row:hover .tui-row-pick > [data-part='selectbox'],
.tui-row:hover .tui-row-pick > label,
.tui-row:hover .tui-row-pick > input,
.tui-rows[data-selecting] .tui-row-pick > [data-part='selectbox'],
.tui-rows[data-selecting] .tui-row-pick > label,
.tui-rows[data-selecting] .tui-row-pick > input {
  opacity: 1;
}
.tui-row-body {
  min-width: 0;
}
.tui-row [data-part='statusdot-dot'] {
  font-size: 10px;
}

/* Line 1: identity. */
.tui-row-1 {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  height: 20px;
}
.tui-title {
  font-weight: 500;
  font-size: var(--type-body);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tui-row-marks {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.tui-mark {
  display: inline-flex;
  color: var(--muted-text);
  opacity: 0.7;
}
.tui-mark[data-slack-logo] {
  opacity: 1;
}

/* Line 2: facts. Junctions step in weight or color; no glyphs. */
.tui-row-2 {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--muted-text);
  font-size: var(--type-meta);
  line-height: 16px;
  margin-top: 4px;
  min-width: 0;
}
.tui-mr-iid {
  color: color-mix(in srgb, var(--fg) 70%, var(--muted-text));
  font-weight: 500;
  flex-shrink: 0;
}
.tui-branch {
  min-width: 0;
  max-width: 34ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tui-diff {
  flex-shrink: 0;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.tui-adds {
  color: color-mix(in srgb, var(--green) 70%, var(--muted-text));
}
.tui-dels {
  color: color-mix(in srgb, var(--red) 70%, var(--muted-text));
}
.tui-behind {
  color: var(--amber);
  flex-shrink: 0;
}
.tui-facts {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}
.tui-threads {
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  cursor: pointer;
  color: color-mix(in srgb, var(--accent) 35%, var(--muted-text));
}
.tui-threads[data-new] {
  color: var(--accent-text);
  font-weight: 700;
}
.tui-threads:hover {
  text-decoration: underline;
}
.tui-age {
  font-size: 0.7rem;
  color: color-mix(in srgb, var(--muted-text) 75%, transparent);
}

/* Line 3: the status line. */
.tui-status {
  display: flex;
  align-items: baseline;
  margin-top: 8px;
  font-size: var(--type-meta);
  line-height: 20px;
  color: var(--muted-text);
  min-width: 0;
}
.tui-status-word {
  font-weight: 600;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.tui-status[data-tone='bad'] .tui-status-word {
  color: var(--red-text);
}
.tui-status[data-tone='warn'] .tui-status-word {
  color: var(--amber);
}
.tui-status[data-tone='work'] .tui-status-word,
.tui-status[data-tone='work'] .tui-status-ring {
  color: var(--purple);
}
.tui-status[data-tone='go'] .tui-status-word {
  color: var(--green);
}
.tui-status[data-tone='quiet'] .tui-status-word {
  font-weight: 500;
}
.tui-status[data-tone='clear'] .tui-status-word {
  font-weight: 500;
  color: color-mix(in srgb, var(--green) 40%, var(--muted-text));
}
.tui-status-detail {
  margin-left: 10px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tui-status[data-tone='warn'] .tui-status-detail,
.tui-status[data-tone='bad'] .tui-status-detail {
  color: color-mix(in srgb, var(--fg) 75%, var(--muted-text));
}
.tui-status-ring {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  border: 1.5px solid color-mix(in srgb, currentColor 35%, transparent);
  border-top-color: currentColor;
  margin-left: 8px;
  align-self: center;
  animation: tui-status-rot 1s linear infinite;
}
@keyframes tui-status-rot {
  to {
    transform: rotate(360deg);
  }
}
.tui-status-more {
  margin-left: 8px;
  flex-shrink: 0;
  font-size: 0.7rem;
  color: color-mix(in srgb, var(--muted-text) 70%, transparent);
}
.tui-status-verbs {
  margin-left: auto;
  padding-left: 16px;
  display: inline-flex;
  gap: 14px;
  flex-shrink: 0;
}
.tui-status-verb {
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  font-size: 0.72rem;
  font-weight: 500;
  color: var(--muted-text);
  cursor: pointer;
}
.tui-status-verb[data-hot] {
  color: var(--accent-text);
  font-weight: 600;
}
.tui-status-verb:hover {
  text-decoration: underline;
}
.tui-status-verb[data-secondary] {
  display: none;
}
.tui-row:hover .tui-status-verb[data-secondary] {
  display: inline;
}
```

Keep the existing `.tui-row:hover::before` chevron rule and the `.tui-row-flash`, `.tui-phrase`, `.tui-author-tag`, `.tui-ticket`, `.tui-copy-inline` rules as they are. Delete `.tui-meta`, `.t-dim`, and `.tui-arrow` if nothing else uses them (`grep -rn` first).

The `SelectBox` recipe's root selector: check `packages/tui-kit/src/recipes/SelectBox/SelectBox.tsx` for its `data-part` value and target that instead of the `label`/`input` guesses above, keeping one selector.

- [ ] **Step 3: Re-anchor the stack rail**

The rail block anchored segments at `50%` of the pick column because the checkbox was vertically centered. The gutter is now 20px tall at the top of the row. Change:

- `.tui-stack-rows > .tui-row > .tui-row-pick::after`: `top: 24px; bottom: calc(-1 * (var(--row-h) - 20px - 12px));` and keep `left: calc(50% - 1px)`.
- `.tui-row-nested .tui-row-pick::before`: `top: -12px; bottom: calc(-1 * (var(--row-h) - 20px - 12px));`.
- `.tui-row-nested:last-child .tui-row-pick::before`: `bottom: auto; height: calc(12px + 10px);`.
- The arm rule (the `::after` on nested rows, read it in place): keep its `top` at the gutter's center, `10px`.

Then run the fixture board (`cd apps/board && BOARD_FIXTURE=$(pwd)/tests/fixture bun run src/server.ts`, port 7941) and look at the stacked MR with Fast Browser (`browser_navigate` to `http://127.0.0.1:7941/`, `browser_take_screenshot` with `scale: "device"`): the rail must start under the parent's dot and join each child's dot with the arm. Adjust the four numbers until it does; record the final values in the commit message.

- [ ] **Step 4: Mobile**

The `mobile-*` captures render at a phone width. Add, inside the existing narrow-width media query in `style.css` (find it with `grep -n "@media (max-width" apps/board/src/style.css`): `.tui-branch { max-width: 16ch; }` and `.tui-status-detail { display: none; }`. Nothing else changes at phone width; the row stays 92px.

- [ ] **Step 5: Gates and commit**

`bun run board:test && bun run format:check && bash scripts/repo-purity.sh`

```bash
git add apps/board/src/style.css
git commit -m "board: row css for the fixed three-line anatomy"
```

---

### Task 6: fixture states, baselines, and the parity pass

**Files:**
- Modify: `apps/board/tests/fixture/data.json`
- Modify: `apps/board/tests/fixture/README.md` (the state list)
- Re-record: `apps/board/tests/baselines/*.png`
- Modify: `apps/board/tests/capture.ts` only if the `focus`/`selection` shots key on a selector that moved (read it first)

**Interfaces:**
- Consumes: the served fixture board; `docs/design/mr-row/baseline/main.light.png` and `main.dark.png`.

- [ ] **Step 1: Carry the design's states in the fixture**

Edit `apps/board/tests/fixture/data.json` so the eight MRs between them carry, with invented names only:

1. a review `reviewing` with `sessionId: "sess-a"` and an `orphan` `{ agentId: "ag-a", repo: null, subject: "agent:ag-a", surface: "herdr", sessionId: "sess-a", paneRef: null, state: "gone", since: <meta.now minus 12 minutes>, openGateIds: [] }` (the interrupted row);
2. a review `reviewing` with `startedAt: <meta.now minus 4 minutes>` and no orphan (the running row);
3. an open `review-post` gate whose first question is `"Post which findings?"` (the decide row) on an approved MR;
4. an own MR (author is `config.json`'s default member) with `slack: { status: "found", reactions: ["eyes"], posted: true }`, `threadSummary` totaling 5, and `peerReviews: [{ mrUrl, iid, reviewer: "pat", status: "reviewing", updatedAt }]`;
5. an approved MR with `slack: { ..., reactions: ["white_check_mark"], posted: true }` and nothing else (the all-clear row);
6. the existing draft, stacked, conflicts, and failing-CI MRs keep their states; give the failing-CI one `doctor: { status: "watching", origin: "auto" }`.

`meta.json`'s `now` is the frozen clock; compute the timestamps from it. Update the README's state list to match.

- [ ] **Step 2: Re-record the baselines**

```bash
cd apps/board && bun run capture:baseline && bun run capture && bun run capture:compare
```

Expected: `capture:compare` reports every shot matching (22/22, zero pixels). If `capture.ts` waits on a selector that no longer exists (`grep -n "waitForSelector\|locator(" tests/capture.ts`), update that selector to the new contract (`.tui-status`, `button[data-verb]`) before recording.

- [ ] **Step 3: The parity pass against the design baselines**

Start the fixture board (`BOARD_FIXTURE=$(pwd)/tests/fixture bun run src/server.ts` from `apps/board`; port 7941). With Fast Browser:

1. `browser_navigate` to `http://127.0.0.1:7941/`, `browser_resize` to 800 x 900.
2. `browser_take_screenshot` with `scale: "device"`, `fullPage: true`, into `/Users/matt/.fast-browser/output/parity-light.png`.
3. `browser_evaluate`: `() => { document.documentElement.classList.add('dark'); }` (check how the board toggles theme: `grep -n "classList\|data-theme\|\.dark" apps/board/src/client/main.tsx apps/board/src/client/board/Board.tsx | head` and use that mechanism), then screenshot `parity-dark.png`.
4. Read both PNGs and both `docs/design/mr-row/baseline/main.{light,dark}.png` and compare, row by row: row height (must be identical across rows), the x of the title / iid / status word (one content edge), the right rail (threads then age, age at the corner), the marks beside the pill, the status word colors per tone, the verb at the status line's right end, the spinner ring on running rows, no separator glyphs anywhere.
5. Fix every deviation in `style.css` or `RowView.tsx`, re-record the baselines (Step 2), and re-shoot until the served board matches the design in everything but font rasterization. Write the list of deviations found and fixed into the report file.

- [ ] **Step 4: Gates and commit**

`bun run board:typecheck && bun run board:test && bun run format:check && bash scripts/repo-purity.sh`

```bash
git add apps/board/tests/fixture apps/board/tests/baselines apps/board/tests/capture.ts apps/board/src
git commit -m "board: fixture carries the redesign states; baselines re-recorded; parity against the design"
```

---

### Task 7: build, deploy prep, and docs

**Files:**
- Modify: `docs/design/mr-row/README.md` (a short "Implemented" section naming the modules)
- Build: `apps/board/dist` via `bun run board:build`

- [ ] **Step 1: Build the served client**

From the root: `bun run board:build`. Expected: `client bundle written to dist/client/` and `compile dist/board`.

- [ ] **Step 2: Document the implementation**

Append to `docs/design/mr-row/README.md`:

```markdown
## Implemented

`apps/board/src/client/board/row-status.ts` derives the status line,
`slack-ladder.ts` the marks, `threads-seen.ts` the thread newness,
`StatusLine.tsx` renders the line, `RowView.tsx` the row. The fixture board
(`apps/board/tests/fixture`) carries every state drawn here, and
`bun run capture:compare` holds the recorded baselines.
```

- [ ] **Step 3: Gates and commit**

`bun run format:check && bash scripts/repo-purity.sh`

```bash
git add docs/design/mr-row/README.md
git commit -m "docs: mr-row implemented"
```

---

## Self-review

**Spec coverage.** Laws 1-5: the tone rank and rest/hover verb split (Task 1, Task 3, Task 5); fixed 92px rows (Task 5); one status line with `+N active` (Task 1, Task 3); edge bar from the chosen line (Task 1, Task 4, Task 5); no glyph separators (Task 4 test, Task 5); the Slack ladder with the color logo (Task 2, Task 4); thread link newness (Task 2, Task 4); the all-clear line with the sun (Task 1, Task 3); mechanical flags inline on line 1 (Task 4); queue as gate seat (Task 1's `answer` verb, Task 3's `runVerb`); the parity gate (Task 6). Density variant (compact) is not in this plan by design; the README notes it as a later toggle.

**Placeholders.** None: every step carries its code or its exact command.

**Type consistency.** `RowStatus`, `StatusLine`, `Verb`, `VerbKind`, `Tone` are defined in Task 1 and consumed by name in Tasks 3 and 4; `slackLadder`/`SlackStage` (Task 2) in Task 4; `threadNewness`/`seenCount`/`markSeen` (Task 2) in Task 4; `RowContext`'s four new handlers (Task 3) in Task 3's `runVerb` and both DOM tests' `ctx()` helpers; `ThreadsLink` takes `title: string` (Task 4 Step 3 as amended by Step 4).
