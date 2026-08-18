import { describe, expect, test } from "bun:test";
import { parseTriageBlock } from "../triage/config.ts";
import { emptyMrMemory, type DispatchMemory } from "../triage/memory.ts";
import { composeFixClasses, enabledFixClassNames, numericPipelineId, runTriage, type TriageRunDeps } from "../triage/run.ts";
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
    claudeCommand: "cswap run 2 -- claude",
    fetchOwnMrs: async () => [{ mrUrl: "https://x/mr/1", iid: 1, pipelineId: 100, pipelineState: "failed", needsRebase: false, author: "matt", sourceBranch: "feat", targetBranch: "master", isStacked: false } satisfies OwnMrFacts],
    readDoctorStates: () => new Map(),
    launchDoctor: async (opts) => { launches.push(opts); return { tabId: "t", workspaceId: "w" }; },
    writeDoctorState: (path, patch) => ({ mrUrl: patch.mrUrl ?? "", iid: patch.iid ?? 0, status: patch.status, origin: patch.origin, startedAt: 0, updatedAt: 0 }),
    doctorFilePath: (mrUrl) => `/state/${mrUrl.split("/").pop()}.json`,
    appendAudit: (e) => audit.push(e),
    notify: async (_t, m) => { notifies.push(m); },
    memory: { identity: null, mrs: {} } as DispatchMemory,
    writeMemory: () => {},
    now: () => 1_000_000_000,
    identity: "matt",
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
    expect(d.launches[0].claudeCommand).toBe("cswap run 2 -- claude");
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
    expect(enabledFixClassNames({ retryFlake: true, inheritedNoteDraft: false, cleanApiRebase: true, mechanicalLint: false }))
      .toEqual(["retry-flake", "clean-api-rebase"]);
  });

  describe("composeFixClasses (MAT-351 author gate)", () => {
    const fc = { retryFlake: true, inheritedNoteDraft: true, cleanApiRebase: false, mechanicalLint: true, codeFix: true };

    test("includes both branch-writing classes when the edge author matches the board identity", () => {
      expect(composeFixClasses(fc, "matt", "matt")).toEqual(["retry-flake", "inherited-note-draft", "mechanical-lint", "code-fix"]);
    });

    test("omits both branch-writing classes when the edge author does not match, even though enabled", () => {
      expect(composeFixClasses(fc, "teammate", "matt")).toEqual(["retry-flake", "inherited-note-draft"]);
    });

    test("omits both branch-writing classes when the board identity is not yet known", () => {
      expect(composeFixClasses(fc, "matt", null)).toEqual(["retry-flake", "inherited-note-draft"]);
    });

    test("each branch-writing class stays off when its config toggle is off, regardless of author match", () => {
      expect(composeFixClasses({ ...fc, mechanicalLint: false }, "matt", "matt")).toEqual(["retry-flake", "inherited-note-draft", "code-fix"]);
      expect(composeFixClasses({ ...fc, codeFix: false }, "matt", "matt")).toEqual(["retry-flake", "inherited-note-draft", "mechanical-lint"]);
      expect(composeFixClasses({ ...fc, mechanicalLint: false, codeFix: false }, "matt", "matt")).toEqual(["retry-flake", "inherited-note-draft"]);
    });
  });
});

describe("runTriage mechanical-lint dispatch gate (MAT-351)", () => {
  const triageWithMechanicalLint = parseTriageBlock({
    enabled: true,
    doctorSkill: "team:doctor",
    tier: "checkout",
    fixClasses: { mechanicalLint: true },
  });

  test("Matt-authored MR gets mechanical-lint in the composed --fix-classes", async () => {
    const d = deps({ triage: triageWithMechanicalLint, identity: "matt" });
    await runTriage(d);
    expect(d.launches[0].fixClasses).toEqual(["retry-flake", "inherited-note-draft", "mechanical-lint"]);
  });

  test("teammate-authored MR does NOT get mechanical-lint even with the class enabled", async () => {
    const d = deps({
      triage: triageWithMechanicalLint,
      identity: "matt",
      fetchOwnMrs: async () => [{ mrUrl: "https://x/mr/1", iid: 1, pipelineId: 100, pipelineState: "failed", needsRebase: false, author: "teammate", sourceBranch: "feat", targetBranch: "master", isStacked: false } satisfies OwnMrFacts],
    });
    await runTriage(d);
    expect(d.launches[0].fixClasses).toEqual(["retry-flake", "inherited-note-draft"]);
  });
});

test("checkout tier dispatches with tier omitted (historical full doctor); api stays explicit", async () => {
  const dApi = deps();
  await runTriage(dApi);
  expect(dApi.launches[0]?.tier).toBe("api");

  const dFull = deps({ triage: parseTriageBlock({ enabled: true, doctorSkill: "team:doctor", tier: "checkout" }) });
  await runTriage(dFull);
  expect(dFull.launches[0]?.tier).toBeUndefined();
});

describe("runTriage attendant lease (BOARD-10)", () => {
  function fakeAttendants(reads: Record<string, "watch-ci" | "doctor" | null> = {}) {
    const calls = { claims: [] as number[], heartbeats: [] as number[], releases: [] as number[] };
    return {
      calls,
      attendants: {
        read: (mrUrl: string, _iid: number) => {
          const holder = reads[mrUrl] ?? null;
          return holder === null ? null : { mr: mrUrl, holder, startedAt: 0, heartbeatAt: 0, ttlSeconds: 600 };
        },
        claim: (_mrUrl: string, iid: number) => { calls.claims.push(iid); return true; },
        heartbeat: (_mrUrl: string, iid: number) => { calls.heartbeats.push(iid); },
        release: (_mrUrl: string, iid: number) => { calls.releases.push(iid); },
      },
    };
  }

  test("a fresh watch-ci lease skips dispatch without consuming budget", async () => {
    const fa = fakeAttendants({ "https://x/mr/1": "watch-ci" });
    const d = deps({ attendants: fa.attendants });
    const result = await runTriage(d);
    expect(result.dispatched).toBe(0);
    expect(d.launches).toHaveLength(0);
    expect(d.audit.some((e) => e.reason === "attended")).toBe(true);
    expect(d.memory.mrs["https://x/mr/1"]!.attemptsToday).toBe(0);
    expect(fa.calls.claims).toHaveLength(0);
  });

  test("a dispatch claims the lease as doctor", async () => {
    const fa = fakeAttendants();
    const d = deps({ attendants: fa.attendants });
    const result = await runTriage(d);
    expect(result.dispatched).toBe(1);
    expect(fa.calls.claims).toEqual([1]);
  });

  test("in-flight doctors get a heartbeat; terminal doctors release", async () => {
    const states = new Map([
      ["https://x/mr/1", { mrUrl: "https://x/mr/1", iid: 1, status: "fixing" as const, origin: "auto" as const, startedAt: 0, updatedAt: 0 }],
      ["https://x/mr/2", { mrUrl: "https://x/mr/2", iid: 2, status: "done" as const, origin: "auto" as const, startedAt: 0, updatedAt: 0 }],
    ]);
    const fa = fakeAttendants();
    const d = deps({ attendants: fa.attendants, readDoctorStates: () => states });
    await runTriage(d);
    expect(fa.calls.heartbeats).toEqual([1]);
    expect(fa.calls.releases).toEqual([2]);
  });
});

