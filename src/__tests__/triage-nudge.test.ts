import { describe, expect, test } from "bun:test";
import { parseTriageBlock } from "../triage/config.ts";
import { emptyMrMemory, type DispatchMemory, type MrMemory } from "../triage/memory.ts";
import { decideNudge, NUDGE_FRESH_MS, runNudgePass, type NudgePassDeps } from "../triage/nudge.ts";
import type { NudgeState } from "../peer/nudges.ts";
import type { NudgeOutcomePayload, NudgeResult } from "../peer/envelope.ts";
import type { ReviewState } from "../review-state.ts";
import type { ReReviewLaunch } from "../review-launch.ts";
import type { AuditEntry } from "../triage/audit.ts";

const NOW = 1_000_000_000;
const cfg = parseTriageBlock({ enabled: true, cooldownMinutes: 30, dailyAttemptBudget: 3 });
const m: MrMemory = emptyMrMemory("1970-01-12"); // dayStamp matching NOW's date

const nudge: NudgeState = { id: "n1", mrUrl: "https://x/mr/1", iid: 1, from: "alice", receivedAt: NOW };
const commentedReview: ReviewState = { mrUrl: nudge.mrUrl, iid: 1, status: "done", outcome: "comment", startedAt: 0, updatedAt: 0 };

describe("decideNudge", () => {
  test("handled always skips, even if everything else would dispatch", () => {
    const handled: NudgeState = { ...nudge, handled: { at: NOW, result: "launched" } };
    expect(decideNudge(handled, commentedReview, m, cfg, NOW)).toEqual({ action: "skip", reason: "already-handled" });
  });

  test("disabled config skips", () => {
    expect(decideNudge(nudge, commentedReview, m, parseTriageBlock(undefined), NOW)).toEqual({ action: "skip", reason: "disabled" });
  });

  test("stale nudge expires, outranking a would-be reject", () => {
    const stale: NudgeState = { ...nudge, receivedAt: NOW - (NUDGE_FRESH_MS + 1) };
    // no ownReview at all would otherwise reject no-commented-review -- expiry wins first
    expect(decideNudge(stale, undefined, m, cfg, NOW)).toEqual({ action: "expire", reason: "stale" });
  });

  test("in-flight own review rejects, outranking budget exhaustion", () => {
    const inFlight: ReviewState = { ...commentedReview, status: "reviewing", outcome: undefined };
    const exhausted: MrMemory = { ...m, attemptsToday: cfg.dailyAttemptBudget };
    expect(decideNudge(nudge, inFlight, exhausted, cfg, NOW)).toEqual({ action: "reject", reason: "review-in-flight" });
  });

  test("no own review, or one that isn't a done+comment, rejects", () => {
    expect(decideNudge(nudge, undefined, m, cfg, NOW)).toEqual({ action: "reject", reason: "no-commented-review" });
    const approved: ReviewState = { ...commentedReview, outcome: "approve" };
    expect(decideNudge(nudge, approved, m, cfg, NOW)).toEqual({ action: "reject", reason: "no-commented-review" });
  });

  test("budget exhausted rejects", () => {
    const exhausted: MrMemory = { ...m, attemptsToday: cfg.dailyAttemptBudget };
    expect(decideNudge(nudge, commentedReview, exhausted, cfg, NOW)).toEqual({ action: "reject", reason: "budget-exhausted" });
  });

  test("cooldown rejects", () => {
    const cooling: MrMemory = { ...m, lastDispatchAt: NOW - 10 * 60_000 }; // 10 min ago < 30 min cooldown
    expect(decideNudge(nudge, commentedReview, cooling, cfg, NOW)).toEqual({ action: "reject", reason: "cooldown" });
    const cooled: MrMemory = { ...m, lastDispatchAt: NOW - 31 * 60_000 };
    expect(decideNudge(nudge, commentedReview, cooled, cfg, NOW).action).toBe("dispatch");
  });

  test("clean state dispatches", () => {
    expect(decideNudge(nudge, commentedReview, m, cfg, NOW)).toEqual({ action: "dispatch", reason: "nudge" });
  });
});

function deps(over: Partial<NudgePassDeps> = {}) {
  const audit: AuditEntry[] = [];
  const notifies: string[] = [];
  const published: Array<{ to: string; payload: NudgeOutcomePayload }> = [];
  const handled: Array<{ id: string; result: NudgeResult; reason?: string }> = [];
  const memory: DispatchMemory = { identity: null, mrs: {} };
  const base: NudgePassDeps = {
    readNudges: () => [nudge],
    markNudgeHandled: (id, result, reason) => handled.push({ id, result, reason }),
    readReviewStates: () => new Map([[nudge.mrUrl, commentedReview]]),
    launchReReview: async (): Promise<ReReviewLaunch> => ({ kind: "launched" }),
    publishOutcome: (to, payload) => published.push({ to, payload }),
    memory,
    cfg,
    appendAudit: (e) => audit.push(e),
    notify: async (_t, msg) => { notifies.push(msg); },
    now: () => NOW,
  };
  return Object.assign(base, over, { audit, notifies, published, handled, memory });
}

describe("runNudgePass", () => {
  test("dispatch path launches, marks handled launched, publishes, bumps memory, audits, notifies", async () => {
    const d = deps();
    const result = await runNudgePass(d);
    expect(result).toEqual({ dispatched: 1, rejected: 0, expired: 0, skipped: 0 });
    expect(d.handled).toEqual([{ id: "n1", result: "launched", reason: undefined }]);
    expect(d.published).toEqual([{ to: "alice", payload: { mrUrl: nudge.mrUrl, iid: 1, nudgeId: "n1", result: "launched" } }]);
    expect(d.memory.mrs[nudge.mrUrl]?.attemptsToday).toBe(1);
    expect(d.memory.mrs[nudge.mrUrl]?.lastDispatchAt).toBe(NOW);
    expect(d.audit.some((e) => e.decision === "dispatch")).toBe(true);
    expect(d.audit.some((e) => e.action === "re-review-launched")).toBe(true);
    expect(d.notifies).toHaveLength(1);
  });

  test("reject path marks handled with reason, publishes, notifies, audits, and does not touch memory counters", async () => {
    const notCommented: ReviewState = { ...commentedReview, outcome: "approve" };
    const d = deps({ readReviewStates: () => new Map([[nudge.mrUrl, notCommented]]) });
    const result = await runNudgePass(d);
    expect(result).toEqual({ dispatched: 0, rejected: 1, expired: 0, skipped: 0 });
    expect(d.handled).toEqual([{ id: "n1", result: "rejected", reason: "no-commented-review" }]);
    expect(d.published[0]?.payload.reason).toBe("no-commented-review");
    expect(d.notifies).toHaveLength(1);
    expect(d.memory.mrs[nudge.mrUrl]?.attemptsToday).toBe(0);
    expect(d.memory.mrs[nudge.mrUrl]?.lastDispatchAt).toBeNull();
  });

  test("expire path marks handled expired, publishes, notifies, audits", async () => {
    const staleNudge: NudgeState = { ...nudge, receivedAt: NOW - (NUDGE_FRESH_MS + 1) };
    const d = deps({ readNudges: () => [staleNudge] });
    const result = await runNudgePass(d);
    expect(result).toEqual({ dispatched: 0, rejected: 0, expired: 1, skipped: 0 });
    expect(d.handled).toEqual([{ id: "n1", result: "expired", reason: "stale" }]);
    expect(d.published[0]?.payload.result).toBe("expired");
    expect(d.notifies).toHaveLength(1);
  });

  test("a launch error publishes rejected launch-failed and does not mark attempts", async () => {
    const d = deps({ launchReReview: async (): Promise<ReReviewLaunch> => ({ kind: "error", message: "boom" }) });
    const result = await runNudgePass(d);
    expect(result).toEqual({ dispatched: 0, rejected: 1, expired: 0, skipped: 0 });
    expect(d.handled).toEqual([{ id: "n1", result: "rejected", reason: "launch-failed" }]);
    expect(d.published[0]?.payload.reason).toBe("launch-failed");
    expect(d.memory.mrs[nudge.mrUrl]?.attemptsToday).toBe(0);
    expect(d.memory.mrs[nudge.mrUrl]?.lastDispatchAt).toBeNull();
    expect(d.audit.some((e) => e.action === "launch-failed")).toBe(true);
  });

  test("skip path touches nothing but the audit log", async () => {
    const handledNudge: NudgeState = { ...nudge, handled: { at: NOW - 1000, result: "launched" } };
    const d = deps({ readNudges: () => [handledNudge] });
    const result = await runNudgePass(d);
    expect(result).toEqual({ dispatched: 0, rejected: 0, expired: 0, skipped: 1 });
    expect(d.handled).toHaveLength(0);
    expect(d.published).toHaveLength(0);
    expect(d.notifies).toHaveLength(0);
    expect(d.audit).toHaveLength(1);
    expect(d.audit[0]?.decision).toBe("skip");
  });
});
