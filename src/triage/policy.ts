import type { TriageConfig } from "./config.ts";
import type { MrMemory } from "./memory.ts";
import type { Edge } from "./edge.ts";

export interface Decision {
  action: "dispatch" | "skip" | "escalate";
  reason: string;
}

/** The whole guardrail policy, as one pure function. Order matters:
    budget-exhaustion outranks cooldown so the one-shot escalation fires even
    while a cooldown is running; the cap comes last because a capped skip
    should re-evaluate freely next run. */
export function decide(edge: Edge, m: MrMemory, activeAutoCount: number, cfg: TriageConfig, now: number): Decision {
  if (!cfg.enabled) return { action: "skip", reason: "disabled" };
  if (m.attemptsToday >= cfg.dailyAttemptBudget) {
    if (m.budgetEscalatedDay !== m.dayStamp) return { action: "escalate", reason: "budget-exhausted" };
    return { action: "skip", reason: "budget-exhausted" };
  }
  if (m.lastDispatchAt !== null && now - m.lastDispatchAt < cfg.cooldownMinutes * 60_000) {
    return { action: "skip", reason: "cooldown" };
  }
  if (activeAutoCount >= cfg.maxConcurrent) return { action: "skip", reason: "concurrency-cap" };
  return { action: "dispatch", reason: `edge:${edge.kind}` };
}
