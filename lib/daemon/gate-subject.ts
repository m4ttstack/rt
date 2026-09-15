export interface GateSubjectDeps {
  runsBySession(sessionId: string): Array<{ runId: string; status: string; worktree: string | null }>;
  agentBySession(sessionId: string): { id: string; subject?: string | null } | undefined;
}

export type GateSubjectResult =
  | { ok: true; subject: string; runId?: string; runWorktree?: string }
  | { ok: false; error: string };

/** An explicit run:<id> subject never contradicts itself: runId always comes
    from the subject text, and a session's own runs can only ever ADD a
    matching worktree, never a different id. */
export function resolveGateSubject(
  deps: GateSubjectDeps,
  args: { subject?: string; sessionId?: string },
): GateSubjectResult {
  if (args.subject) {
    const runMatch = args.subject.startsWith("run:") ? args.subject.slice("run:".length) : undefined;
    const running = args.sessionId ? deps.runsBySession(args.sessionId).filter((r) => r.status === "running") : [];
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
    const running = deps.runsBySession(args.sessionId).filter((r) => r.status === "running");
    if (running.length === 1) {
      const run = running[0]!;
      return { ok: true, subject: `run:${run.runId}`, runId: run.runId, ...(run.worktree ? { runWorktree: run.worktree } : {}) };
    }
    if (running.length > 1) {
      return { ok: false, error: `multiple running runs for this session; pass --subject (candidates: ${running.map((r) => r.runId).join(", ")})` };
    }
    const agent = deps.agentBySession(args.sessionId);
    if (agent) return { ok: true, subject: agent.subject && agent.subject.trim() ? agent.subject : `agent:${agent.id}` };
  }
  return { ok: false, error: "no subject: pass --subject, or run under a recorded run/agent session" };
}
