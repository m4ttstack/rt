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
  mechanicalLint: "mechanical-lint",
};

export function enabledFixClassNames(fc: FixClasses): string[] {
  return (Object.keys(FIX_CLASS_FLAGS) as Array<keyof FixClasses>)
    .filter((k) => fc[k])
    .map((k) => FIX_CLASS_FLAGS[k]);
}

/** MAT-351: mechanical-lint commits + pushes to the MR branch, so unlike the
    other fix classes it stays gated to the board's own identity even when
    the config toggle is on -- fetchOwnMrs already restricts this whole
    pipeline to the token identity's own MRs, but this is the explicit
    re-check at the point the flag string is actually built, so a future
    change to that upstream filter can never silently widen who gets a
    branch-mutating auto-fix. `identity` is the resolved GitLab token
    username (never a hardcoded username, never config.defaultMember --
    see the 2026-08-08 ruling in .local-dev/2026-08-08-ci-triage-design.md
    §6 on why this pipeline's own-MR identity never comes from config). */
export function composeFixClasses(fc: FixClasses, edgeAuthor: string, identity: string | null): string[] {
  const names = enabledFixClassNames(fc);
  if (!fc.mechanicalLint) return names;
  if (identity !== null && edgeAuthor === identity) return names;
  return names.filter((n) => n !== "mechanical-lint");
}

const IN_FLIGHT = new Set<DoctorStatus>(["queued", "diagnosing", "rebasing", "fixing", "watching"]);

/** Everything runTriage touches, injected so the orchestration is testable
    and bin/triage.ts is pure wiring. */
export interface TriageRunDeps {
  triage: TriageConfig;
  doctorCwd: string;
  doctorsWorkspace: string;
  /** Resolved GitLab token username this pipeline is dispatching as (see
      bin/triage.ts). Never config.defaultMember (2026-08-08 ruling). Used
      only to re-verify the mechanical-lint author gate (MAT-351); null
      before the identity has ever been resolved. */
  identity: string | null;
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
        // The wrapper treats an absent tier as the historical checkout
        // (fix-and-push) behavior; "api" stays the explicit no-checkout tier.
        tier: deps.triage.tier === "checkout" ? undefined : "api",
        fixClasses: composeFixClasses(deps.triage.fixClasses, edge.author, deps.identity),
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
