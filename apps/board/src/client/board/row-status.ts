/** The row's state, on two lines. Line 0's pill is GitLab's review axis
    (a noun: needs review, commented, approved). Line 3 is the move: every
    source on the row (gates, the executor, the three lanes, peers, humans)
    offers a candidate, the hottest one becomes the line, the rest fold into
    "+N active", and a row with no candidate at all reads its standing state
    for whoever the board's seat is. The pill and the line may name the same
    fact ("changes requested" twice): one is where the MR is, the other is
    what to do about it. */
import type { BoardMR } from '../../data.ts';
import { hasChangesRequested } from '../../data.ts';
import { respondOutcome } from '../../respond-outcome.ts';
import type {
  BoardMRWithReview,
  DoctorStatus,
  DraftInfo,
  ReviewStatus,
} from '../types.ts';
import {
  activeReviewers,
  ago,
  DOCTOR_LABEL,
  draftKey,
  laneInterrupted,
  NUDGE_RETRYABLE,
  RESPOND_ACTIVE,
} from './format.ts';

type Tone = 'bad' | 'warn' | 'work' | 'go' | 'quiet' | 'clear';

type VerbKind =
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

/** One source's offer for the status line. */
export interface Candidate {
  tone: Tone;
  word: string;
  detail?: string;
  spin?: boolean;
  verbs: Verb[];
}

export interface RowStatus {
  line: Candidate;
  more: Candidate[];
  bar: 'bad' | 'warn' | null;
}

/** Shared with the decision queue's stuck/unassigned face so the row and
    the queue card never drift on wording. */
export const DELIVERY_STUCK_MESSAGE = "pane didn't pick up the answer";
export const EXECUTION_UNASSIGNED_MESSAGE = 'answered, no pane to execute';

// ── line 0: the pill ────────────────────────────────────────────────────────

/** The pill's tooltip: every merge blocker GitLab reports, or the good news. */
export function statusReasons(mr: BoardMR): string {
  const b = mr.blockers;
  if (!b.any) return 'ready to merge';
  const reasons: string[] = [];
  if (b.isDraft) reasons.push('marked as draft');
  if (b.hasConflicts) reasons.push('merge conflicts with target branch');
  if (b.needsRebase) reasons.push('source branch needs a rebase');
  if (b.pipelineFailing) reasons.push('pipeline is failing');
  if (b.pipelineRunning) reasons.push('pipeline still running');
  if (b.awaitingApprovals)
    reasons.push(
      `awaiting approvals (${mr.reviews.given}/${mr.reviews.required})`
    );
  if (b.hasUnresolvedDiscussions)
    reasons.push(`unresolved discussions (${mr.unresolvedThreads})`);
  if (b.hasMergeError)
    reasons.push(`merge error: ${b.mergeError ?? 'unknown'}`);
  return reasons.length
    ? `blocked:\n${reasons.map(r => `· ${r}`).join('\n')}`
    : 'blocked';
}

export type PillHue = 'red' | 'green' | 'cyan' | 'amber';

/** The pill's phrase: the approval axis only. Mechanical blockers are flags
    beside it and the conversation is the facts line's threads token, so the
    pill always shows where the MR is in review. */
export function statusPhrase(mr: BoardMR): { text: string; hue: PillHue } {
  if (hasChangesRequested(mr)) return { text: 'changes requested', hue: 'red' };
  if (mr.reviews.isApproved) return { text: 'approved', hue: 'green' };
  if (mr.reviews.required > 0 && mr.reviews.given > 0)
    return {
      text: `${mr.reviews.given}/${mr.reviews.required} approved`,
      hue: 'cyan',
    };
  return { text: 'needs review', hue: 'amber' };
}

// ── line 3: the candidates ──────────────────────────────────────────────────

const REVIEW_IN_FLIGHT = new Set<ReviewStatus>(['queued', 'reviewing']);
const DOCTOR_WORKING = new Set<DoctorStatus>([
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

function verdictWord(
  outcome: string | undefined,
  fallback?: string
): string | undefined {
  if (outcome === 'approve') return 'approved';
  if (outcome === 'comment') return 'commented';
  return fallback;
}

function gateLines(mr: BoardMRWithReview): Candidate[] {
  const out: Candidate[] = [];
  for (const gate of mr.gates) {
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
    RESPOND_ACTIVE.has(mr.respond.status) &&
    laneInterrupted(orphan, mr.respond)
  )
    return 'respond';
  return null;
}

/** The domain a hidden pane is presumably running, for its focus verb;
    null when nothing on the row is in flight. */
function hiddenLane(mr: BoardMRWithReview): Verb['domain'] | null {
  if (mr.review && REVIEW_IN_FLIGHT.has(mr.review.status)) return 'review';
  if (mr.respond && RESPOND_ACTIVE.has(mr.respond.status)) return 'respond';
  if (mr.doctor && DOCTOR_WORKING.has(mr.doctor.status)) return 'doctor';
  return null;
}

function orphanLine(
  mr: BoardMRWithReview,
  now: number,
  interrupted: Lane | null
): Candidate | null {
  const orphan = mr.orphan;
  if (!orphan) return null;
  if (orphan.state === 'hidden') {
    const domain = hiddenLane(mr);
    return {
      tone: 'quiet',
      word: 'off-screen',
      detail: 'pane hidden, still running',
      verbs: domain ? [{ kind: 'focus', label: 'focus', domain }] : [],
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
): Candidate | null {
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
    case 'done':
      return {
        tone: 'go',
        word: 'review ready',
        detail: verdictWord(r.outcome),
        verbs: r.reportReady ? [{ kind: 'read-review', label: 'read ↗' }] : [],
      };
    case 'error':
      return {
        tone: 'bad',
        word: 'review failed',
        detail: r.message || undefined,
        verbs: [{ kind: 'launch-review', label: 'launch again' }],
      };
  }
}

function respondDoneLine(mr: BoardMRWithReview): Candidate {
  const r = mr.respond!;
  const threads = r.threads ?? 0;
  const posted = Math.min(r.posted ?? 0, threads);
  switch (respondOutcome(r.posted, r.threads)) {
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
    case 'unknown':
      return { tone: 'quiet', word: 'response done', verbs: [] };
  }
}

function respondLine(
  mr: BoardMRWithReview,
  interrupted: Lane | null
): Candidate | null {
  const r = mr.respond;
  if (!r || interrupted === 'respond') return null;
  const working = (word: string): Candidate => ({
    tone: 'work',
    word,
    spin: true,
    detail: r.message || undefined,
    verbs: [{ kind: 'focus', label: 'focus', domain: 'respond' }],
  });
  switch (r.status) {
    case 'queued':
      return { tone: 'quiet', word: 'response queued', verbs: [] };
    case 'triaging':
      return working('triaging…');
    case 'implementing':
      return working('implementing…');
    case 'drafting':
      return working('drafting replies…');
    case 'error':
      return {
        tone: 'bad',
        word: 'response failed',
        detail: r.message || undefined,
        verbs: [{ kind: 'restart-respond', label: 'restart' }],
      };
    case 'done':
      return respondDoneLine(mr);
  }
}

function doctorLine(mr: BoardMRWithReview): Candidate | null {
  const d = mr.doctor;
  if (!d) return null;
  switch (d.status) {
    case 'queued':
      return { tone: 'quiet', word: DOCTOR_LABEL[d.status], verbs: [] };
    case 'diagnosing':
    case 'rebasing':
    case 'fixing':
    case 'watching':
      return {
        tone: 'work',
        word: DOCTOR_LABEL[d.status],
        spin: true,
        detail: d.origin === 'auto' ? 'auto' : d.message || undefined,
        verbs: [{ kind: 'focus', label: 'focus', domain: 'doctor' }],
      };
    case 'done':
      return {
        tone: 'go',
        word: DOCTOR_LABEL[d.status],
        detail: d.message || undefined,
        verbs: [],
      };
    case 'error':
      return {
        tone: 'bad',
        word: DOCTOR_LABEL[d.status],
        detail: d.message || undefined,
        verbs: [{ kind: 'call-doctor', label: 'call again' }],
      };
  }
}

/** Notes the doctor held back for a human to post or dismiss. */
function draftLines(mr: BoardMRWithReview, resolved: Resolved): Candidate[] {
  const out: Candidate[] = [];
  for (const draft of mr.drafts ?? []) {
    if (resolved.get(draftKey(mr.webUrl ?? '', draft.kind))) continue;
    out.push({
      tone: 'warn',
      word: `held: ${draft.kind}`,
      detail: 'doctor draft',
      verbs: [{ kind: 'read-note', label: 'read', draft }],
    });
  }
  return out;
}

/** Peers and humans: re-review asks in both directions, peer boards'
    reviews of this MR, and GitLab reviewers with a review open right now. */
function peerLines(mr: BoardMRWithReview, now: number): Candidate[] {
  const out: Candidate[] = [];
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
      const since = agoMs(sent.sentAt, now);
      out.push({
        tone: 'quiet',
        word: `nudged ${sent.reviewer}`,
        detail: since ? `no answer yet, ${since}` : 'no answer yet',
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
      out.push({
        tone: 'go',
        word: `${p.reviewer} ${verdictWord(p.outcome, 'reviewed')}`,
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

// ── line 3: the standing state ──────────────────────────────────────────────

const OPEN: Verb = { kind: 'open-mr', label: 'open ↗' };
const CI_RUNNING: Candidate = {
  tone: 'work',
  word: 'ci running…',
  spin: true,
  verbs: [OPEN],
};

function approvalsDetail(mr: BoardMRWithReview): string | undefined {
  const { given, required } = mr.reviews;
  return given > 0 && required > 0
    ? `${given} of ${required} approvals`
    : undefined;
}

/** The repair a blocked MR needs from its author, as the doctor would do
    it; null when nothing mechanical is wrong. */
function repairPhrase(b: BoardMR['blockers']): string | null {
  const rebase = b.hasConflicts || b.needsRebase;
  if (rebase && b.pipelineFailing) return 'a rebase and a ci fix';
  if (rebase) return 'a rebase';
  if (b.pipelineFailing) return 'a ci fix';
  return null;
}

/** The author's standing state: what the MR needs from them before anyone
    else can move it, in the order they would fix it. */
function authorLine(mr: BoardMRWithReview): Candidate {
  const b = mr.blockers;
  const repair = repairPhrase(b);
  if (repair) {
    return {
      tone: 'quiet',
      word: `needs ${repair}`,
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
  if (b.pipelineRunning) return CI_RUNNING;
  if (!mr.reviews.isApproved) {
    return {
      tone: 'quiet',
      word: 'waiting on reviewers',
      detail: approvalsDetail(mr),
      verbs: [OPEN],
    };
  }
  if (b.hasUnresolvedDiscussions)
    return { tone: 'quiet', word: 'threads to resolve', verbs: [OPEN] };
  if (b.hasMergeError) {
    return {
      tone: 'quiet',
      word: 'merge error',
      detail: b.mergeError ?? undefined,
      verbs: [OPEN],
    };
  }
  if (b.any) return { tone: 'quiet', word: 'blocked', verbs: [OPEN] };
  return { tone: 'go', word: 'ready to merge', verbs: [OPEN] };
}

/** A reviewer's standing state on someone else's MR: whether the next move
    is theirs (review, or a second look once the author answered their
    threads or a push reset their approval) or the author's (everything
    else). Only an approved, unblocked MR with nothing awaiting anyone earns
    the sun. */
function reviewerLine(mr: BoardMRWithReview, self: string | null): Candidate {
  const b = mr.blockers;
  const awaiting = mr.threadSummary?.awaiting ?? 0;
  if (hasChangesRequested(mr))
    return { tone: 'quiet', word: 'changes requested', verbs: [OPEN] };
  if (awaiting > 0)
    return { tone: 'quiet', word: 'waiting on the author', verbs: [OPEN] };
  const review: Verb = { kind: 'launch-review', label: 'review' };
  const me = self
    ? mr.reviews.reviewers.find(r => r.username === self)
    : undefined;
  if (me && me.reviewState === 'UNAPPROVED')
    return { tone: 'quiet', word: 'your approval was reset', verbs: [review] };
  const mine = mr.myThreads;
  if (me && me.reviewState !== 'APPROVED' && mine && mine.awaiting === 0) {
    const answered = mine.replied + mine.resolved;
    if (answered > 0) {
      return {
        tone: 'quiet',
        word: 'author answered you',
        detail: answered === 1 ? 'one thread' : `${answered} threads`,
        verbs: [OPEN],
      };
    }
  }
  if (!mr.reviews.isApproved) {
    return {
      tone: 'quiet',
      word: 'awaiting review',
      detail: approvalsDetail(mr),
      verbs: [review],
    };
  }
  if (b.pipelineRunning) return CI_RUNNING;
  if (b.any) {
    const repair = repairPhrase(b);
    return {
      tone: 'quiet',
      word: 'waiting on the author',
      detail: repair
        ? `for ${repair}`
        : b.hasUnresolvedDiscussions
          ? 'to resolve threads'
          : undefined,
      verbs: [OPEN],
    };
  }
  return { tone: 'clear', word: 'all clear', verbs: [OPEN] };
}

// ── the line ────────────────────────────────────────────────────────────────

/** Every source's offer, in source order; exported for the tests. */
export function candidateLines(
  mr: BoardMRWithReview,
  now: number,
  draftResolved: Resolved,
  self: string | null
): Candidate[] {
  const interrupted = interruptedLane(mr);
  const lines: Candidate[] = [
    ...gateLines(mr),
    orphanLine(mr, now, interrupted),
    reviewLine(mr, now, interrupted),
    respondLine(mr, interrupted),
    doctorLine(mr),
    ...draftLines(mr, draftResolved),
    ...peerLines(mr, now),
  ].filter((l): l is Candidate => l !== null);
  if (lines.length > 0) return lines;
  const mine = self !== null && mr.author.username === self;
  return [mine ? authorLine(mr) : reviewerLine(mr, self)];
}

const TONE_RANK: Record<Tone, number> = {
  bad: 0,
  warn: 1,
  work: 2,
  go: 3,
  quiet: 4,
  clear: 5,
};

/** The single status line a row shows: the hottest candidate, with ties
    settled by source order (gates before lanes before peers), so a decision
    always outranks the lane it came from. */
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
