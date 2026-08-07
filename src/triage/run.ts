import type { DoctorState, DoctorStatus } from "../doctor-state.ts";
import type { LaunchPaneOpts } from "../herdr.ts";
import { draftBinPath } from "../herdr.ts";
import type { FixClasses, TriageConfig } from "./config.ts";
import { detectEdges, markHandled, observe, type OwnMrFacts } from "./edge.ts";
import { decide } from "./policy.ts";
import type { AuditEntry } from "./audit.ts";
import type { DispatchMemory } from "./memory.ts";

/** Numeric tail of a glance scoped id ("gitlab:pipeline:12345" → 12345). */
export function numericPipelineId(scoped: string): number | null {
  const tail = scoped.split(":").pop() ?? "";
  const n = Number(tail);
  return /^\d+$/.test(tail) && Number.isFinite(n) ? n : null;
}

const FIX_CLASS_FLAGS: Record<keyof FixClasses, string> = {
  retryFlake: "retry-flake",
  inheritedNoteDraft: "inherited-note-draft",
  cleanApiRebase: "clean-api-rebase",
};

export function enabledFixClassNames(fc: FixClasses): string[] {
  return (Object.keys(FIX_CLASS_FLAGS) as Array<keyof FixClasses>)
    .filter((k) => fc[k])
    .map((k) => FIX_CLASS_FLAGS[k]);
}

const IN_FLIGHT = new Set<DoctorStatus>(["queued", "diagnosing", "rebasing", "fixing", "watching"]);

/** Everything runTriage touches, injected so the orchestration is testable
    and bin/triage.ts is pure wiring. */
export interface TriageRunDeps {
  triage: TriageConfig;
  doctorCwd: string;
  doctorsWorkspace: string;
  /** Own open MRs (token identity, drafts included), already reduced to facts. */
  fetchOwnMrs(): Promise<OwnMrFacts[]>;
  readDoctorStates(): Map<string, DoctorState>;
  launchDoctor(opts: LaunchPaneOpts): Promise<{ tabId: string; workspaceId: string }>;
  writeDoctorState(path: string, patch: Partial<DoctorState> & { status: DoctorStatus }): DoctorState;
  doctorFilePath(mrUrl: string): string;
  appendAudit(entry: AuditEntry): void;
  notify(title: string, message: string): Promise<void>;
  memory: DispatchMemory;
  writeMemory(mem: DispatchMemory): void;
  now(): number;
}

export async function runTriage(deps: TriageRunDeps): Promise<{ dispatched: number; escalated: number; skipped: number }> {
  const result = { dispatched: 0, escalated: 0, skipped: 0 };
  if (!deps.triage.enabled) return result;

  const now = deps.now();
  const dayStamp = new Date(now).toISOString().slice(0, 10);
  const mrs = await deps.fetchOwnMrs();

  observe(deps.memory, mrs, dayStamp);
  const edges = detectEdges(deps.memory, mrs);
  const doctors = deps.readDoctorStates();
  let activeAuto = [...doctors.values()].filter((d) => d.origin === "auto" && IN_FLIGHT.has(d.status)).length;

  for (const edge of edges) {
    const existing = doctors.get(edge.mrUrl);
    if (existing && IN_FLIGHT.has(existing.status)) {
      result.skipped++;
      deps.appendAudit({ ts: now, mrUrl: edge.mrUrl, iid: edge.iid, event: edge.kind, decision: "skip", reason: "doctor-in-flight", pipelineId: edge.pipelineId });
      continue;
    }
    const m = deps.memory.mrs[edge.mrUrl]!;
    const decision = decide(edge, m, activeAuto, deps.triage, now);
    deps.appendAudit({
      ts: now, mrUrl: edge.mrUrl, iid: edge.iid, event: edge.kind,
      decision: decision.action, reason: decision.reason, pipelineId: edge.pipelineId, attempt: m.attemptsToday + 1,
    });
    if (decision.action === "skip") {
      result.skipped++;
      continue;
    }
    if (decision.action === "escalate") {
      result.escalated++;
      await deps.notify(`auto-doctor budget exhausted on !${edge.iid}`, `${edge.kind} on ${edge.mrUrl}: ${deps.triage.dailyAttemptBudget} attempts today, giving up until tomorrow or a human acts`);
      markHandled(deps.memory, edge);
      m.budgetEscalatedDay = dayStamp;
      continue;
    }
    // dispatch
    const statePath = deps.doctorFilePath(edge.mrUrl);
    deps.writeDoctorState(statePath, { mrUrl: edge.mrUrl, iid: edge.iid, status: "queued", origin: "auto" });
    try {
      const { tabId, workspaceId } = await deps.launchDoctor({
        mrUrl: edge.mrUrl,
        iid: edge.iid,
        cwd: deps.doctorCwd,
        workspaceLabel: deps.doctorsWorkspace,
        statePath,
        skill: deps.triage.doctorSkill,
        tier: "api",
        fixClasses: enabledFixClassNames(deps.triage.fixClasses),
        draftBin: draftBinPath(),
      });
      deps.writeDoctorState(statePath, { status: "queued", tabId, workspaceId });
      result.dispatched++;
      activeAuto++;
      markHandled(deps.memory, edge);
      m.lastDispatchAt = now;
      m.attemptsToday++;
      deps.appendAudit({ ts: now, mrUrl: edge.mrUrl, iid: edge.iid, event: edge.kind, action: "doctor-launched", pipelineId: edge.pipelineId, attempt: m.attemptsToday });
    } catch (err) {
      deps.writeDoctorState(statePath, { status: "error", message: "failed to launch doctor pane" });
      deps.appendAudit({ ts: now, mrUrl: edge.mrUrl, iid: edge.iid, event: edge.kind, action: "launch-failed", outcome: err instanceof Error ? err.message : String(err) });
    }
  }

  deps.writeMemory(deps.memory);
  return result;
}
