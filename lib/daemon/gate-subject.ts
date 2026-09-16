export interface GateSubjectDeps {
  /** `stale` is the run-liveness verdict (attention reason "stale"), not a
      status: a run left in status "running" by a dead pipeline stays running
      forever, and trusting status alone let it own every later gate this
      session opened. The ladder treats a stale run as absent. */
  runsBySession(sessionId: string): Array<{ runId: string; status: string; worktree: string | null; stale?: boolean }>;
  agentBySession(sessionId: string): { id: string; subject?: string | null } | undefined;
}

export type GateSubjectResult =
  | { ok: true; subject: string; runId?: string; runWorktree?: string }
  | { ok: false; error: string };

function liveRuns(deps: GateSubjectDeps, sessionId: string) {
  return deps.runsBySession(sessionId).filter((r) => r.status === "running" && !r.stale);
}

/** An explicit run:<id> subject never contradicts itself: runId always comes
    from the subject text, and a session's own runs can only ever ADD a
    matching worktree, never a different id. */
export function resolveGateSubject(
  deps: GateSubjectDeps,
  args: { subject?: string; sessionId?: string },
): GateSubjectResult {
  if (args.subject) {
    const runMatch = args.subject.startsWith("run:") ? args.subject.slice("run:".length) : undefined;
    const running = args.sessionId ? liveRuns(deps, args.sessionId) : [];
    if (runMatch !== undefined) {
      const match = running.find((r) => r.runId === runMatch);
      return {
        ok: true,
        subject: args.subject,
        runId: runMatch,
        ...(match?.worktree ? { runWorktree: match.worktree } : {}),
      };
    }
    if (running.length === 1) {
      const run = running[0]!;
      return { ok: true, subject: args.subject, runId: run.runId, ...(run.worktree ? { runWorktree: run.worktree } : {}) };
    }
    return { ok: true, subject: args.subject };
  }
  if (args.sessionId) {
    const running = liveRuns(deps, args.sessionId);
    if (running.length === 1) {
      const run = running[0]!;
      return { ok: true, subject: `run:${run.runId}`, runId: run.runId, ...(run.worktree ? { runWorktree: run.worktree } : {}) };
    }
    if (running.length > 1) {
      return { ok: false, error: `multiple running runs for this session; pass --subject (candidates: ${running.map((r) => r.runId).join(", ")})` };
    }
    const agent = deps.agentBySession(args.sessionId);
    if (agent) return { ok: true, subject: agent.subject && agent.subject.trim() ? agent.subject.trim() : `agent:${agent.id}` };
  }
  return { ok: false, error: "no subject: pass --subject, or run under a recorded run/agent session" };
}
