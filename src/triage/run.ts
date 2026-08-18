import type { DoctorState, DoctorStatus } from "../doctor-state.ts";
import type { LaunchPaneOpts } from "../herdr.ts";
import { draftBinPath } from "../herdr.ts";
import type { FixClasses, TriageConfig } from "./config.ts";
import { detectEdges, markHandled, observe, type OwnMrFacts } from "./edge.ts";
import { chainOf } from "./stack.ts";
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
  codeFix: "code-fix",
};

/** The classes that write to the MR branch (commit and/or push). Only ever
    dispatched for the board identity's own MRs -- see composeFixClasses. */
const OWN_MR_ONLY_CLASSES = ["mechanical-lint", "code-fix"];

export function enabledFixClassNames(fc: FixClasses): string[] {
  return (Object.keys(FIX_CLASS_FLAGS) as Array<keyof FixClasses>)
    .filter((k) => fc[k])
    .map((k) => FIX_CLASS_FLAGS[k]);
}

/** MAT-351: the branch-writing classes (mechanical-lint, and code-fix per
    Matt's 2026-08-10 widening) stay gated to the board's own identity even
    when their config toggles are on -- fetchOwnMrs already restricts this
    whole pipeline to the token identity's own MRs, but this is the explicit
    re-check at the point the flag string is actually built, so a future
    change to that upstream filter can never silently widen who gets a
    branch-mutating auto-fix. `identity` is the resolved GitLab token
    username (never a hardcoded username, never config.defaultMember --
    see the 2026-08-08 ruling in .local-dev/2026-08-08-ci-triage-design.md
    §6 on why this pipeline's own-MR identity never comes from config). */
export function composeFixClasses(fc: FixClasses, edgeAuthor: string, identity: string | null): string[] {
  const names = enabledFixClassNames(fc);
  if (identity !== null && edgeAuthor === identity) return names;
  return names.filter((n) => !OWN_MR_ONLY_CLASSES.includes(n));
}

const IN_FLIGHT = new Set<DoctorStatus>(["queued", "diagnosing", "rebasing", "fixing", "watching"]);

/** BOARD-10: the one-CI-attendant-per-MR lease (src/triage/attendant.ts).
    Injected as a port so runTriage stays fs-free in tests; absent means the
    lease system is not wired (behavior identical to pre-BOARD-10). */
export interface AttendantsPort {
  read(mrUrl: string, iid: number): { holder: "watch-ci" | "doctor" } | null;
  /** BOARD-12: the fresh lease on a BRANCH, whichever MR it belongs to. The
      only way to see an attendant on a parent that sits outside the board's
      scope window; watch-ci has always written `branch`, and the doctor's own
      claim now does too. */
  readByBranch(branch: string): { mr: string; holder: "watch-ci" | "doctor" } | null;
  claim(mrUrl: string, iid: number, branch?: string): boolean;
  heartbeat(mrUrl: string, iid: number): void;
  release(mrUrl: string, iid: number): void;
}

/** Everything runTriage touches, injected so the orchestration is testable
    and bin/triage.ts is pure wiring. */
export interface TriageRunDeps {
  triage: TriageConfig;
  doctorCwd: string;
  doctorsWorkspace: string;
  /** Command that starts claude in the pane (config.claudeCommand). Empty/absent = "claude". */
  claudeCommand?: string;
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
  attendants?: AttendantsPort;
}

/** BOARD-12: the ancestor, if any, that owns this edge instead of us. Checks
    the lease AND the doctor state map, because a doctor launched by hand from
    the board UI writes state without ever claiming a lease (the gap BOARD-10
    left open). An unresolved parent is only ever blocked on positive evidence
    -- a lease naming its branch -- so an MR whose parent sits outside the
    board's scope window still dispatches rather than silently stalling. */
function upstreamBlocker(
  edge: { mrUrl: string },
  mrs: OwnMrFacts[],
  doctors: Map<string, DoctorState>,
  attendants: AttendantsPort | undefined,
): { reason: "attended-upstream" | "red-upstream"; upstreamMr: string } | null {
  const { ancestors, unresolvedParentBranch } = chainOf(mrs, edge.mrUrl);
  for (const anc of ancestors) {
    const doc = doctors.get(anc.mrUrl);
    if (attendants?.read(anc.mrUrl, anc.iid) || (doc && IN_FLIGHT.has(doc.status))) {
      return { reason: "attended-upstream", upstreamMr: anc.mrUrl };
    }
    if (anc.pipelineState === "failed") return { reason: "red-upstream", upstreamMr: anc.mrUrl };
  }
  if (unresolvedParentBranch === null) return null;
  const held = attendants?.readByBranch(unresolvedParentBranch);
  return held ? { reason: "attended-upstream", upstreamMr: held.mr } : null;
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
  const byUrl = new Map(mrs.map((m) => [m.mrUrl, m]));
  let activeAuto = [...doctors.values()].filter((d) => d.origin === "auto" && IN_FLIGHT.has(d.status)).length;

  // Lease maintenance (BOARD-10) BEFORE edge decisions: keep in-flight
  // doctors' leases alive (the doctor pane itself never heartbeats; this
  // cron is its pulse, so the cron interval must stay under the TTL) and
  // release the lease of any doctor that reached a terminal state.
  if (deps.attendants) {
    for (const d of doctors.values()) {
      if (IN_FLIGHT.has(d.status)) deps.attendants.heartbeat(d.mrUrl, d.iid);
      else deps.attendants.release(d.mrUrl, d.iid);
    }
  }

  for (const edge of edges) {
    const existing = doctors.get(edge.mrUrl);
    if (existing && IN_FLIGHT.has(existing.status)) {
      result.skipped++;
      deps.appendAudit({ ts: now, mrUrl: edge.mrUrl, iid: edge.iid, event: edge.kind, decision: "skip", reason: "doctor-in-flight", pipelineId: edge.pipelineId });
      continue;
    }
    // BOARD-10: someone (a watch-ci session) is already attending this MR's
    // CI. The red is theirs to handle; skip without consuming budget.
    const lease = deps.attendants?.read(edge.mrUrl, edge.iid) ?? null;
    if (lease && lease.holder !== "doctor") {
      result.skipped++;
      deps.appendAudit({ ts: now, mrUrl: edge.mrUrl, iid: edge.iid, event: edge.kind, decision: "skip", reason: "attended", pipelineId: edge.pipelineId });
      continue;
    }
    // BOARD-12: the attendant unit is the chain. An ancestor that is attended
    // may push at any moment and restack every descendant, and an ancestor
    // that is merely red already explains this MR's red (the child branch
    // contains the parent's commits). Either way the edge is not ours to act
    // on. Skipping without markHandled means it re-fires once the ancestor
    // clears. Applies to both edge kinds -- auto-rebasing a child while the
    // parent's attendant is mid-push is the force-with-lease race itself.
    const upstream = upstreamBlocker(edge, mrs, doctors, deps.attendants);
    if (upstream) {
      result.skipped++;
      deps.appendAudit({ ts: now, mrUrl: edge.mrUrl, iid: edge.iid, event: edge.kind, decision: "skip", reason: upstream.reason, outcome: upstream.upstreamMr, pipelineId: edge.pipelineId });
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
        claudeCommand: deps.claudeCommand,
        skill: deps.triage.doctorSkill,
        // The wrapper treats an absent tier as the historical checkout
        // (fix-and-push) behavior; "api" stays the explicit no-checkout tier.
        tier: deps.triage.tier === "checkout" ? undefined : "api",
        fixClasses: composeFixClasses(deps.triage.fixClasses, edge.author, deps.identity),
        draftBin: draftBinPath(),
      });
      deps.writeDoctorState(statePath, { status: "queued", tabId, workspaceId });
      deps.attendants?.claim(edge.mrUrl, edge.iid, byUrl.get(edge.mrUrl)?.sourceBranch);
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
