import type {
  AskKind,
  NudgeOutcomePayload,
  NudgeResult,
} from '../peer/envelope.ts';
import type { NudgeState } from '../peer/nudges.ts';
import type { ReReviewLaunch } from '../review-launch.ts';
import type { ReviewState } from '../review-state.ts';
import type { AuditEntry } from './audit.ts';
import type { TriageConfig } from './config.ts';
import {
  emptyMrMemory,
  rollDay,
  type DispatchMemory,
  type MrMemory,
} from './memory.ts';

export const NUDGE_FRESH_MS = 48 * 60 * 60_000;

export interface NudgeDecision {
  action: 'dispatch' | 'reject' | 'expire' | 'skip';
  reason: string;
}

export type ReReviewSource = 'nudge' | 'latch';

/** A re-review request from either source, as the decision function sees it.
    `receivedAt` is null for a latch: a latch cannot go stale, because the pass
    consumes it on the tick after it is resolved, so there is no queue to age. */
export interface ReReviewRequest {
  mrUrl: string;
  iid: number;
  source: ReReviewSource;
  receivedAt: number | null;
  handled: boolean;
  /** Absent means re-review; 'review' is a first-look ask (peer nudges only,
      a latch is re-review by construction). */
  kind?: AskKind;
}

/** The whole re-review guardrail, one pure function, shared by both sources.
    Freshness is judged on the relay-stamped receivedAt (never sender-clock
    sentAt) and only when there is one. Reject (vs skip) is terminal: it
    publishes an outcome so the requester's chip resolves, and the requester can
    re-request once the blocker clears. */
export function decideRequest(
  req: ReReviewRequest,
  ownReview: ReviewState | undefined,
  m: MrMemory,
  cfg: TriageConfig,
  now: number,
  ownRespond?: { status: string }
): NudgeDecision {
  if (req.handled) return { action: 'skip', reason: 'already-handled' };
  if (!cfg.enabled) return { action: 'skip', reason: 'disabled' };
  if (req.receivedAt !== null && now - req.receivedAt > NUDGE_FRESH_MS) {
    return { action: 'expire', reason: 'stale' };
  }
  if (req.kind === 'respond') {
    // A respond ask runs on the author's own MR, so the review lane says
    // nothing here; the only lane that can collide is respond itself.
    if (
      ownRespond &&
      ownRespond.status !== 'done' &&
      ownRespond.status !== 'error'
    ) {
      return { action: 'reject', reason: 'respond-in-flight' };
    }
  } else {
    if (
      ownReview &&
      (ownReview.status === 'queued' || ownReview.status === 'reviewing')
    ) {
      return { action: 'reject', reason: 'review-in-flight' };
    }
    // The review-state gate inverts with the ask's kind: a re-review needs a
    // commented review to revisit, a first look must not repeat a finished one.
    if (req.kind === 'review') {
      if (ownReview && ownReview.status === 'done') {
        return { action: 'reject', reason: 'already-reviewed' };
      }
    } else if (
      !ownReview ||
      ownReview.status !== 'done' ||
      ownReview.outcome !== 'comment'
    ) {
      return { action: 'reject', reason: 'no-commented-review' };
    }
  }
  if (m.attemptsToday >= cfg.dailyAttemptBudget)
    return { action: 'reject', reason: 'budget-exhausted' };
  if (
    m.lastDispatchAt !== null &&
    now - m.lastDispatchAt < cfg.cooldownMinutes * 60_000
  ) {
    return { action: 'reject', reason: 'cooldown' };
  }
  return { action: 'dispatch', reason: req.source };
}

/** Adapter for the peer-nudge source, so runNudgePass and its callers keep
    their existing shape. */
export function decideNudge(
  nudge: NudgeState,
  ownReview: ReviewState | undefined,
  m: MrMemory,
  cfg: TriageConfig,
  now: number,
  ownRespond?: { status: string }
): NudgeDecision {
  return decideRequest(
    {
      mrUrl: nudge.mrUrl,
      iid: nudge.iid,
      source: 'nudge',
      receivedAt: nudge.receivedAt,
      handled: !!nudge.handled,
      kind: nudge.kind,
    },
    ownReview,
    m,
    cfg,
    now,
    ownRespond
  );
}

export interface NudgePassDeps {
  readNudges(): NudgeState[];
  markNudgeHandled(id: string, result: NudgeResult, reason?: string): void;
  readReviewStates(): Map<string, ReviewState>;
  /** The respond lane per MR, the one lane a respond ask can collide with. */
  readRespondStates(): Map<string, { status: string }>;
  launchAsk(mrUrl: string, iid: number, kind: AskKind): Promise<ReReviewLaunch>;
  publishOutcome(to: string, payload: NudgeOutcomePayload): void;
  memory: DispatchMemory;
  cfg: TriageConfig;
  appendAudit(entry: AuditEntry): void;
  notify(title: string, message: string): Promise<void>;
  now(): number;
}

export async function runNudgePass(deps: NudgePassDeps): Promise<{
  dispatched: number;
  rejected: number;
  expired: number;
  skipped: number;
}> {
  const result = { dispatched: 0, rejected: 0, expired: 0, skipped: 0 };
  const reviews = deps.readReviewStates();
  const responds = deps.readRespondStates();
  const now = deps.now();
  const dayStamp = new Date(now).toISOString().slice(0, 10);

  for (const nudge of deps.readNudges()) {
    const m = rollDay(
      deps.memory.mrs[nudge.mrUrl] ?? emptyMrMemory(dayStamp),
      dayStamp
    );
    deps.memory.mrs[nudge.mrUrl] = m;
    const decision = decideNudge(
      nudge,
      reviews.get(nudge.mrUrl),
      m,
      deps.cfg,
      now,
      responds.get(nudge.mrUrl)
    );
    // Skips come first and audit nothing: a handled nudge is re-read on every
    // cron run, and auditing it would grow the log forever with a line that
    // records no change.
    if (decision.action === 'skip') {
      result.skipped++;
      continue;
    }
    deps.appendAudit({
      ts: now,
      mrUrl: nudge.mrUrl,
      iid: nudge.iid,
      event: 'nudge',
      decision: decision.action,
      reason: decision.reason,
      attempt: m.attemptsToday + 1,
    });
    if (decision.action === 'expire' || decision.action === 'reject') {
      const outcome: NudgeResult =
        decision.action === 'expire' ? 'expired' : 'rejected';
      deps.markNudgeHandled(nudge.id, outcome, decision.reason);
      deps.publishOutcome(nudge.from, {
        mrUrl: nudge.mrUrl,
        iid: nudge.iid,
        nudgeId: nudge.id,
        result: outcome,
        reason: decision.reason,
      });
      await deps.notify(
        `${nudge.kind ?? 're-review'} nudge ${outcome} on !${nudge.iid}`,
        `${nudge.from} asked; ${decision.reason}`
      );
      result[outcome === 'expired' ? 'expired' : 'rejected']++;
      continue;
    }
    const kind: AskKind = nudge.kind ?? 're-review';
    const launch = await deps.launchAsk(nudge.mrUrl, nudge.iid, kind);
    if (launch.kind === 'error') {
      deps.markNudgeHandled(nudge.id, 'rejected', 'launch-failed');
      deps.publishOutcome(nudge.from, {
        mrUrl: nudge.mrUrl,
        iid: nudge.iid,
        nudgeId: nudge.id,
        result: 'rejected',
        reason: 'launch-failed',
      });
      deps.appendAudit({
        ts: now,
        mrUrl: nudge.mrUrl,
        iid: nudge.iid,
        event: 'nudge',
        action: 'launch-failed',
        outcome: launch.message,
      });
      result.rejected++;
      continue;
    }
    deps.markNudgeHandled(nudge.id, 'launched');
    deps.publishOutcome(nudge.from, {
      mrUrl: nudge.mrUrl,
      iid: nudge.iid,
      nudgeId: nudge.id,
      result: 'launched',
    });
    m.lastDispatchAt = now;
    m.attemptsToday++;
    deps.appendAudit({
      ts: now,
      mrUrl: nudge.mrUrl,
      iid: nudge.iid,
      event: 'nudge',
      action: `${kind}-launched`,
      attempt: m.attemptsToday,
    });
    await deps.notify(
      `${kind} launched on !${nudge.iid}`,
      `requested by ${nudge.from}`
    );
    result.dispatched++;
  }
  return result;
}
