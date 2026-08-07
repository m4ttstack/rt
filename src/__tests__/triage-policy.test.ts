import { describe, expect, test } from "bun:test";
import { parseTriageBlock } from "../triage/config.ts";
import { emptyMrMemory } from "../triage/memory.ts";
import { decide } from "../triage/policy.ts";
import type { Edge } from "../triage/edge.ts";

const cfg = parseTriageBlock({ enabled: true });
const edge: Edge = { mrUrl: "https://x/mr/1", iid: 1, kind: "pipeline-red", pipelineId: 100 };
const NOW = 1_000_000_000;

describe("decide", () => {
  test("clean state dispatches", () => {
    expect(decide(edge, emptyMrMemory("2026-08-08"), 0, cfg, NOW)).toEqual({ action: "dispatch", reason: "edge:pipeline-red" });
  });

  test("budget exhausted escalates once, then skips", () => {
    const m = { ...emptyMrMemory("2026-08-08"), attemptsToday: 3 };
    expect(decide(edge, m, 0, cfg, NOW).action).toBe("escalate");
    const escalated = { ...m, budgetEscalatedDay: "2026-08-08" };
    expect(decide(edge, escalated, 0, cfg, NOW)).toEqual({ action: "skip", reason: "budget-exhausted" });
  });

  test("cooldown skips", () => {
    const m = { ...emptyMrMemory("2026-08-08"), lastDispatchAt: NOW - 10 * 60_000 }; // 10 min ago < 30 min cooldown
    expect(decide(edge, m, 0, cfg, NOW)).toEqual({ action: "skip", reason: "cooldown" });
    const cooled = { ...emptyMrMemory("2026-08-08"), lastDispatchAt: NOW - 31 * 60_000 };
    expect(decide(edge, cooled, 0, cfg, NOW).action).toBe("dispatch");
  });

  test("global concurrency cap skips", () => {
    expect(decide(edge, emptyMrMemory("2026-08-08"), 2, cfg, NOW)).toEqual({ action: "skip", reason: "concurrency-cap" });
  });

  test("disabled config skips everything", () => {
    expect(decide(edge, emptyMrMemory("2026-08-08"), 0, parseTriageBlock(undefined), NOW)).toEqual({ action: "skip", reason: "disabled" });
  });
});
