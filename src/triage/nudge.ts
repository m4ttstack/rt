import type { ReviewState } from "../review-state.ts";
import type { NudgeState } from "../peer/nudges.ts";
import type { NudgeOutcomePayload, NudgeResult } from "../peer/envelope.ts";
import type { ReReviewLaunch } from "../review-launch.ts";
import type { AuditEntry } from "./audit.ts";
import type { TriageConfig } from "./config.ts";
import { emptyMrMemory, rollDay, type DispatchMemory, type MrMemory } from "./memory.ts";

export const NUDGE_FRESH_MS = 48 * 60 * 60_000;

export interface NudgeDecision {
  action: "dispatch" | "reject" | "expire" | "skip";
  reason: string;
}

/** The whole nudge guardrail, one pure function. Freshness is judged on the
    relay-stamped receivedAt (never sender-clock sentAt). Reject (vs skip) is
    terminal: it publishes an outcome so the requester's chip resolves, and
    the requester can re-nudge once the blocker clears. */
export function decideNudge(nudge: NudgeState, ownReview: ReviewState | undefined, m: MrMemory, cfg: TriageConfig, now: number): NudgeDecision {
  if (nudge.handled) return { action: "skip", reason: "already-handled" };
  if (!cfg.enabled) return { action: "skip", reason: "disabled" };
  if (now - nudge.receivedAt > NUDGE_FRESH_MS) return { action: "expire", reason: "stale" };
  if (ownReview && (ownReview.status === "queued" || ownReview.status === "reviewing")) {
    return { action: "reject", reason: "review-in-flight" };
  }
  if (!ownReview || ownReview.status !== "done" || ownReview.outcome !== "comment") {
    return { action: "reject", reason: "no-commented-review" };
  }
  if (m.attemptsToday >= cfg.dailyAttemptBudget) return { action: "reject", reason: "budget-exhausted" };
  if (m.lastDispatchAt !== null && now - m.lastDispatchAt < cfg.cooldownMinutes * 60_000) {
    return { action: "reject", reason: "cooldown" };
  }
  return { action: "dispatch", reason: "nudge" };
}

export interface NudgePassDeps {
  readNudges(): NudgeState[];
  markNudgeHandled(id: string, result: NudgeResult, reason?: string): void;
  readReviewStates(): Map<string, ReviewState>;
  launchReReview(mrUrl: string, iid: number): Promise<ReReviewLaunch>;
  publishOutcome(to: string, payload: NudgeOutcomePayload): void;
  memory: DispatchMemory;
  cfg: TriageConfig;
  appendAudit(entry: AuditEntry): void;
  notify(title: string, message: string): Promise<void>;
  now(): number;
}

export async function runNudgePass(deps: NudgePassDeps): Promise<{ dispatched: number; rejected: number; expired: number; skipped: number }> {
  const result = { dispatched: 0, rejected: 0, expired: 0, skipped: 0 };
  const reviews = deps.readReviewStates();
  const now = deps.now();
  const dayStamp = new Date(now).toISOString().slice(0, 10);

  for (const nudge of deps.readNudges()) {
    const m = rollDay(deps.memory.mrs[nudge.mrUrl] ?? emptyMrMemory(dayStamp), dayStamp);
    deps.memory.mrs[nudge.mrUrl] = m;
    const decision = decideNudge(nudge, reviews.get(nudge.mrUrl), m, deps.cfg, now);
    deps.appendAudit({
      ts: now, mrUrl: nudge.mrUrl, iid: nudge.iid, event: "nudge",
      decision: decision.action, reason: decision.reason, attempt: m.attemptsToday + 1,
    });
    if (decision.action === "skip") {
      result.skipped++;
      continue;
    }
    if (decision.action === "expire" || decision.action === "reject") {
      const outcome: NudgeResult = decision.action === "expire" ? "expired" : "rejected";
      deps.markNudgeHandled(nudge.id, outcome, decision.reason);
      deps.publishOutcome(nudge.from, { mrUrl: nudge.mrUrl, iid: nudge.iid, nudgeId: nudge.id, result: outcome, reason: decision.reason });
      await deps.notify(`re-review nudge ${outcome} on !${nudge.iid}`, `${nudge.from} asked; ${decision.reason}`);
      result[outcome === "expired" ? "expired" : "rejected"]++;
      continue;
    }
    const launch = await deps.launchReReview(nudge.mrUrl, nudge.iid);
    if (launch.kind === "error") {
      deps.markNudgeHandled(nudge.id, "rejected", "launch-failed");
      deps.publishOutcome(nudge.from, { mrUrl: nudge.mrUrl, iid: nudge.iid, nudgeId: nudge.id, result: "rejected", reason: "launch-failed" });
      deps.appendAudit({ ts: now, mrUrl: nudge.mrUrl, iid: nudge.iid, event: "nudge", action: "launch-failed", outcome: launch.message });
      result.rejected++;
      continue;
    }
    deps.markNudgeHandled(nudge.id, "launched");
    deps.publishOutcome(nudge.from, { mrUrl: nudge.mrUrl, iid: nudge.iid, nudgeId: nudge.id, result: "launched" });
    m.lastDispatchAt = now;
    m.attemptsToday++;
    deps.appendAudit({ ts: now, mrUrl: nudge.mrUrl, iid: nudge.iid, event: "nudge", action: "re-review-launched", attempt: m.attemptsToday });
    await deps.notify(`re-review launched on !${nudge.iid}`, `requested by ${nudge.from}`);
    result.dispatched++;
  }
  return result;
}
