import { describe, expect, test } from "bun:test";
import { parseTriageBlock } from "../triage/config.ts";
import { emptyMrMemory, type DispatchMemory } from "../triage/memory.ts";
import { enabledFixClassNames, numericPipelineId, runTriage, type TriageRunDeps } from "../triage/run.ts";
import type { OwnMrFacts } from "../triage/edge.ts";
import type { AuditEntry } from "../triage/audit.ts";

function deps(over: Partial<TriageRunDeps> = {}): TriageRunDeps & { audit: AuditEntry[]; launches: any[]; notifies: string[] } {
  const audit: AuditEntry[] = [];
  const launches: any[] = [];
  const notifies: string[] = [];
  const base: TriageRunDeps = {
    triage: parseTriageBlock({ enabled: true, doctorSkill: "team:doctor-api" }),
    doctorCwd: "/repo",
    doctorsWorkspace: "doctors",
    fetchOwnMrs: async () => [{ mrUrl: "https://x/mr/1", iid: 1, pipelineId: 100, pipelineState: "failed", needsRebase: false } satisfies OwnMrFacts],
    readDoctorStates: () => new Map(),
    launchDoctor: async (opts) => { launches.push(opts); return { tabId: "t", workspaceId: "w" }; },
    writeDoctorState: (path, patch) => ({ mrUrl: patch.mrUrl ?? "", iid: patch.iid ?? 0, status: patch.status, origin: patch.origin, startedAt: 0, updatedAt: 0 }),
    doctorFilePath: (mrUrl) => `/state/${mrUrl.split("/").pop()}.json`,
    appendAudit: (e) => audit.push(e),
    notify: async (_t, m) => { notifies.push(m); },
    memory: { identity: null, mrs: {} } as DispatchMemory,
    writeMemory: () => {},
    now: () => 1_000_000_000,
  };
  return Object.assign(base, over, { audit, launches, notifies });
}

describe("runTriage", () => {
  test("red own MR dispatches an api-tier doctor and records everything", async () => {
    const d = deps();
    const result = await runTriage(d);
    expect(result.dispatched).toBe(1);
    expect(d.launches[0].tier).toBe("api");
    expect(d.launches[0].skill).toBe("team:doctor-api");
    expect(d.launches[0].fixClasses).toEqual(["retry-flake", "inherited-note-draft"]); // cleanApiRebase off by default
    expect(d.audit.some((e) => e.decision === "dispatch")).toBe(true);
    expect(d.memory.mrs["https://x/mr/1"]!.attemptsToday).toBe(1);
    expect(d.memory.mrs["https://x/mr/1"]!.lastHandledPipelineId).toBe(100);
  });

  test("budget exhausted notifies exactly once", async () => {
    // dayStamp must match now(): 1_000_000_000 ms is 1970-01-12, and a
    // mismatched stamp would legitimately roll the day and reset the budget.
    const d = deps({ memory: { identity: null, mrs: { "https://x/mr/1": { ...emptyMrMemory("1970-01-12"), attemptsToday: 3 } } } });
    await runTriage(d);
    expect(d.notifies).toHaveLength(1);
    await runTriage(d);
    expect(d.notifies).toHaveLength(1); // budgetEscalatedDay dedups
    expect(d.launches).toHaveLength(0);
  });

  test("an in-flight doctor on the MR skips without consuming budget", async () => {
    const inflight = new Map([["https://x/mr/1", { mrUrl: "https://x/mr/1", iid: 1, status: "fixing" as const, origin: "manual" as const, startedAt: 0, updatedAt: 0 }]]);
    const d = deps({ readDoctorStates: () => inflight });
    await runTriage(d);
    expect(d.launches).toHaveLength(0);
    expect(d.audit.some((e) => e.reason === "doctor-in-flight")).toBe(true);
  });

  test("disabled runs do nothing at all", async () => {
    const d = deps({ triage: parseTriageBlock(undefined) });
    const result = await runTriage(d);
    expect(result).toEqual({ dispatched: 0, escalated: 0, skipped: 0 });
    expect(d.audit).toHaveLength(0);
  });
});

describe("helpers", () => {
  test("numericPipelineId parses glance's scoped id", () => {
    expect(numericPipelineId("gitlab:pipeline:12345")).toBe(12345);
    expect(numericPipelineId("garbage")).toBeNull();
  });
  test("enabledFixClassNames kebab-cases only the enabled classes", () => {
    expect(enabledFixClassNames({ retryFlake: true, inheritedNoteDraft: false, cleanApiRebase: true }))
      .toEqual(["retry-flake", "clean-api-rebase"]);
  });
});
