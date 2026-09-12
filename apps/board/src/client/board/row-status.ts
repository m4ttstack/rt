import { hasChangesRequested } from '../../data.ts';
import { respondOutcome, type RespondStatus } from '../../respond-outcome.ts';
import type { BoardMRWithReview, DraftInfo, ReviewStatus } from '../types.ts';
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
  | 'launch-respond'
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

const CLAUSE_CAP = 44;
const CLAUSE_MIN = CLAUSE_CAP / 2;
const CLAUSE_BOUNDARY = /;|\. |\s\(/g;

/** The status line's detail slot fits one clause; agent messages arrive as
    whole sentences. Cut a long message at its first natural boundary (a
    semicolon, a sentence stop, an opening parenthesis) in the cap's second
    half, else at the last word inside the cap, and hand the full text back
    for a tooltip. A boundary in the first half would keep a label and drop
    the fact ("STACKED MR: !1234"), so the word cut wins there. `full` is
    null when nothing was cut. */
export function clauseOf(detail: string): {
  text: string;
  full: string | null;
} {
  if (detail.length <= CLAUSE_CAP) return { text: detail, full: null };
  for (const m of detail.matchAll(CLAUSE_BOUNDARY)) {
    const at = m.index ?? 0;
    if (at < CLAUSE_MIN) continue;
    if (at > CLAUSE_CAP) break;
    return { text: detail.slice(0, at).trimEnd(), full: detail };
  }
  const head = detail.slice(0, CLAUSE_CAP - 1);
  const endsOnWord = detail.charAt(CLAUSE_CAP - 1) === ' ';
  const space = head.lastIndexOf(' ');
  const cut = endsOnWord || space <= CLAUSE_MIN ? head : head.slice(0, space);
  return { text: `${cut.trimEnd()}…`, full: detail };
}

const TONE_RANK: Record<Tone, number> = {
  bad: 0,
  warn: 1,
  work: 2,
  go: 3,
  quiet: 4,
  clear: 5,
};

const RESPOND_WORKING: Partial<Record<RespondStatus, string>> = {
  triaging: 'triaging…',
  implementing: 'implementing…',
  drafting: 'drafting replies…',
};

const REVIEW_IN_FLIGHT = new Set<ReviewStatus>(['queued', 'reviewing']);
const RESPOND_IN_FLIGHT = new Set<RespondStatus>([
  'queued',
  'triaging',
  'implementing',
  'drafting',
]);

const DOCTOR_WORKING = new Set([
  'diagnosing',
  'rebasing',
  'fixing',
  'watching',
]);

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

type Lane = 'review' | 'respond';

/** The in-flight lane a gone orphan cut down, resolved once and shared by
    the orphan line and both lane lines. Only work still under way can be
    interrupted: a finished lane, a doctor-only row or a row with no lane
    yields null, and the orphan then reads as a lane-neutral closed pane.
    Review is checked first because a queued lane carries no sessionId and
    `laneInterrupted` matches it on the gone state alone. */
function interruptedLane(mr: BoardMRWithReview): Lane | null {
  const orphan = mr.orphan;
  if (orphan?.state !== 'gone') return null;
  if (
    mr.review &&
    REVIEW_IN_FLIGHT.has(mr.review.status) &&
    laneInterrupted(orphan, mr.review)
  )
    return 'review';
  if (
    mr.respond &&
    RESPOND_IN_FLIGHT.has(mr.respond.status) &&
    laneInterrupted(orphan, mr.respond)
  )
    return 'respond';
  return null;
}

function runningLane(mr: BoardMRWithReview): Lane {
  if (mr.review && REVIEW_IN_FLIGHT.has(mr.review.status)) return 'review';
  if (mr.respond && RESPOND_IN_FLIGHT.has(mr.respond.status)) return 'respond';
  return 'review';
}

function orphanLine(
  mr: BoardMRWithReview,
  now: number,
  interrupted: Lane | null
): StatusLine | null {
  const orphan = mr.orphan;
  if (!orphan) return null;
  if (orphan.state === 'hidden') {
    return {
      tone: 'quiet',
      word: 'off-screen',
      detail: 'pane hidden, still running',
      verbs: [{ kind: 'focus', label: 'focus', domain: runningLane(mr) }],
    };
  }
  if (orphan.state !== 'gone') return null;
  const closed = `pane closed ${agoMs(orphan.since, now) ?? 'just now'}`;
  const clear: Verb = {
    kind: 'clear',
    label: 'clear',
    agentId: orphan.agentId,
  };
  if (!interrupted) {
    return { tone: 'quiet', word: 'pane gone', detail: closed, verbs: [clear] };
  }
  return {
    tone: 'warn',
    word: `${interrupted === 'respond' ? 'response' : 'review'} interrupted`,
    detail: closed,
    verbs: [
      { kind: 'relaunch', label: 'relaunch', domain: interrupted },
      clear,
    ],
  };
}

function reviewLine(
  mr: BoardMRWithReview,
  now: number,
  interrupted: Lane | null
): StatusLine | null {
  const r = mr.review;
  if (!r || interrupted === 'review') return null;
  switch (r.status) {
    case 'queued':
      return { tone: 'quiet', word: 'review queued', verbs: [] };
    case 'reviewing':
      return {
        tone: 'work',
        word: 'review running…',
        spin: true,
        detail:
          r.message ||
          (r.startedAt ? `started ${agoMs(r.startedAt, now)}` : undefined),
        verbs: [{ kind: 'focus', label: 'focus', domain: 'review' }],
      };
    case 'done': {
      const outcome = r.outcome;
      return {
        tone: 'go',
        word: 'review ready',
        detail:
          outcome === 'approve'
            ? 'approved'
            : outcome === 'comment'
              ? 'commented'
              : undefined,
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

function respondLine(
  mr: BoardMRWithReview,
  interrupted: Lane | null
): StatusLine | null {
  const r = mr.respond;
  if (!r || interrupted === 'respond') return null;
  if (r.status === 'queued')
    return { tone: 'quiet', word: 'response queued', verbs: [] };
  const working = RESPOND_WORKING[r.status];
  if (working) {
    return {
      tone: 'work',
      word: working,
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
        detail:
          threads - posted === 1
            ? 'one thread waiting'
            : `${threads - posted} threads waiting`,
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
  if (d.status === 'queued')
    return { tone: 'quiet', word: DOCTOR_LABEL[d.status], verbs: [] };
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
    return {
      tone: 'go',
      word: DOCTOR_LABEL[d.status],
      detail: d.message || undefined,
      verbs: [],
    };
  }
  return {
    tone: 'bad',
    word: DOCTOR_LABEL[d.status],
    detail: d.message || undefined,
    verbs: [{ kind: 'call-doctor', label: 'call again' }],
  };
}

function socialLines(
  mr: BoardMRWithReview,
  now: number,
  resolved: Resolved
): StatusLine[] {
  const out: StatusLine[] = [];
  const nudges = [...(mr.nudges ?? [])].sort(
    (a, b) => a.receivedAt - b.receivedAt
  );
  for (const n of nudges) {
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
        tone: 'quiet',
        word: `nudge to ${sent.reviewer} went unanswered`,
        detail: 'right-click to ask again',
        verbs: [],
      });
    } else if (sent.display === 'requested') {
      const at = sent.sentAt;
      out.push({
        tone: 'quiet',
        word: `nudged ${sent.reviewer}`,
        detail: at
          ? `no answer yet, ${ago(new Date(at).toISOString(), now)}`
          : 'no answer yet',
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
        p.outcome === 'approve'
          ? 'approved'
          : p.outcome === 'comment'
            ? 'commented'
            : 'reviewed';
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

const OPEN: Verb = { kind: 'open-mr', label: 'open ↗' };

function approvalsDetail(mr: BoardMRWithReview): string | undefined {
  const { given, required } = mr.reviews;
  return given > 0 && required > 0
    ? `${given} of ${required} approvals`
    : undefined;
}

/** The author's standing state: what the MR needs from them before anyone
    else can move it, in the order they would fix it. */
function authorLine(mr: BoardMRWithReview): StatusLine {
  const b = mr.blockers;
  const rebase = !!(b?.hasConflicts || b?.needsRebase);
  const ci = !!b?.pipelineFailing;
  if (rebase || ci) {
    const needs =
      rebase && ci ? 'a rebase and a ci fix' : rebase ? 'a rebase' : 'a ci fix';
    return {
      tone: 'quiet',
      word: `needs ${needs}`,
      verbs: [{ kind: 'call-doctor', label: 'call doctor' }],
    };
  }
  const respond: Verb = { kind: 'launch-respond', label: 'respond' };
  if (hasChangesRequested(mr))
    return { tone: 'quiet', word: 'changes requested', verbs: [respond] };
  const awaiting = mr.threadSummary?.awaiting ?? 0;
  if (awaiting > 0) {
    return {
      tone: 'quiet',
      word:
        awaiting === 1
          ? 'a thread awaits you'
          : `${awaiting} threads await you`,
      verbs: [respond],
    };
  }
  if (mr.isDraft)
    return { tone: 'quiet', word: 'draft, not marked ready', verbs: [OPEN] };
  if (b?.pipelineRunning)
    return { tone: 'work', word: 'ci running…', spin: true, verbs: [OPEN] };
  if (!mr.reviews.isApproved) {
    return {
      tone: 'quiet',
      word: 'waiting on reviewers',
      detail: approvalsDetail(mr),
      verbs: [OPEN],
    };
  }
  if (b?.hasUnresolvedDiscussions)
    return { tone: 'quiet', word: 'threads to resolve', verbs: [OPEN] };
  if (b?.hasMergeError) {
    return {
      tone: 'quiet',
      word: 'merge error',
      detail: b.mergeError ?? undefined,
      verbs: [OPEN],
    };
  }
  if (b?.any) return { tone: 'quiet', word: 'blocked', verbs: [OPEN] };
  return { tone: 'go', word: 'ready to merge', verbs: [OPEN] };
}

/** A reviewer's standing state on someone else's MR: whether the next move
    is theirs (review) or the author's (everything else). Only an approved,
    unblocked MR with nothing awaiting anyone earns the sun. */
function reviewerLine(mr: BoardMRWithReview): StatusLine {
  const b = mr.blockers;
  const awaiting = mr.threadSummary?.awaiting ?? 0;
  if (hasChangesRequested(mr))
    return { tone: 'quiet', word: 'changes requested', verbs: [OPEN] };
  if (awaiting > 0)
    return { tone: 'quiet', word: 'waiting on the author', verbs: [OPEN] };
  if (!mr.reviews.isApproved) {
    return {
      tone: 'quiet',
      word: 'awaiting review',
      detail: approvalsDetail(mr),
      verbs: [{ kind: 'launch-review', label: 'review' }],
    };
  }
  if (b?.pipelineRunning)
    return { tone: 'work', word: 'ci running…', spin: true, verbs: [OPEN] };
  if (b?.any) {
    const why =
      b.hasConflicts || b.needsRebase
        ? 'for a rebase'
        : b.pipelineFailing
          ? 'for a ci fix'
          : b.hasUnresolvedDiscussions
            ? 'to resolve threads'
            : undefined;
    return {
      tone: 'quiet',
      word: 'waiting on the author',
      detail: why,
      verbs: [OPEN],
    };
  }
  return {
    tone: 'clear',
    word: 'all clear',
    detail: 'enjoy the sunshine',
    verbs: [OPEN],
  };
}

export function candidateLines(
  mr: BoardMRWithReview,
  now: number,
  draftResolved: Resolved,
  self: string | null
): StatusLine[] {
  const interrupted = interruptedLane(mr);
  const lines: StatusLine[] = [
    ...gateLines(mr),
    orphanLine(mr, now, interrupted),
    reviewLine(mr, now, interrupted),
    respondLine(mr, interrupted),
    doctorLine(mr),
    ...socialLines(mr, now, draftResolved),
  ].filter((l): l is StatusLine => l !== null);
  if (lines.length > 0) return lines;
  const mine = self !== null && mr.author.username === self;
  return [mine ? authorLine(mr) : reviewerLine(mr)];
}

/** The single status line a row shows: the hottest candidate, with ties
    settled by source order (gates before lanes before social), so a decision
    always outranks the lane it came from. With no candidate at all the row
    falls back to its standing GitLab state, worded for whoever `self` is. */
export function rowStatus(
  mr: BoardMRWithReview,
  now: number,
  draftResolved: Resolved,
  self: string | null
): RowStatus {
  const lines = candidateLines(mr, now, draftResolved, self);
  const ranked = lines
    .map((line, index) => ({ line, index }))
    .sort(
      (a, b) =>
        TONE_RANK[a.line.tone] - TONE_RANK[b.line.tone] || a.index - b.index
    );
  const [first, ...rest] = ranked;
  const line = first!.line;
  return {
    line,
    more: rest.map(r => r.line),
    bar: line.tone === 'bad' || line.tone === 'warn' ? line.tone : null,
  };
}
