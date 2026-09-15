export interface GateSubjectDeps {
  runsBySession(sessionId: string): Array<{ runId: string; status: string; worktree: string | null }>;
  agentBySession(sessionId: string): { id: string } | undefined;
}

export type GateSubjectResult =
  | { ok: true; subject: string; runWorktree?: string }
  | { ok: false; error: string };

export function resolveGateSubject(
  deps: GateSubjectDeps,
  args: { subject?: string; sessionId?: string },
): GateSubjectResult {
  if (args.subject) return { ok: true, subject: args.subject };
  if (args.sessionId) {
    const running = deps.runsBySession(args.sessionId).filter((r) => r.status === "running");
    if (running.length === 1) {
      const run = running[0]!;
      return { ok: true, subject: `run:${run.runId}`, ...(run.worktree ? { runWorktree: run.worktree } : {}) };
    }
    if (running.length > 1) {
      return { ok: false, error: `multiple running runs for this session; pass --subject (candidates: ${running.map((r) => r.runId).join(", ")})` };
    }
    const agent = deps.agentBySession(args.sessionId);
    if (agent) return { ok: true, subject: `agent:${agent.id}` };
  }
  return { ok: false, error: "no subject: pass --subject, or run under a recorded run/agent session" };
}
