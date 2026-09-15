import { describe, expect, test } from "bun:test";
import { resolveGateSubject } from "../gate-subject.ts";

const none = { runsBySession: () => [], agentBySession: () => undefined };

describe("resolveGateSubject", () => {
  test("explicit subject wins over everything", () => {
    const deps = { runsBySession: () => [{ runId: "r1", status: "running", worktree: "/w" }], agentBySession: () => ({ id: "ag-1" }) };
    expect(resolveGateSubject(deps, { subject: "mr:x", sessionId: "s" })).toEqual({ ok: true, subject: "mr:x" });
  });
  test("single running run resolves to run:<id> with its worktree", () => {
    const deps = { ...none, runsBySession: () => [{ runId: "r1", status: "running", worktree: "/w" }] };
    expect(resolveGateSubject(deps, { sessionId: "s" })).toEqual({ ok: true, subject: "run:r1", runWorktree: "/w" });
  });
  test("non-running runs are ignored", () => {
    const deps = { ...none, runsBySession: () => [{ runId: "r1", status: "done", worktree: null }] };
    expect(resolveGateSubject(deps, { sessionId: "s" }).ok).toBe(false);
  });
  test("two running runs is a loud error naming candidates", () => {
    const deps = { ...none, runsBySession: () => [
      { runId: "r1", status: "running", worktree: null },
      { runId: "r2", status: "running", worktree: null },
    ] };
    const res = resolveGateSubject(deps, { sessionId: "s" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("r1, r2");
  });
  test("agent record fallback", () => {
    const deps = { ...none, agentBySession: () => ({ id: "ag-9" }) };
    expect(resolveGateSubject(deps, { sessionId: "s" })).toEqual({ ok: true, subject: "agent:ag-9" });
  });
  test("nothing resolvable", () => {
    const res = resolveGateSubject(none, { sessionId: "s" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("no subject: pass --subject, or run under a recorded run/agent session");
  });
  test("no sessionId and no subject", () => {
    expect(resolveGateSubject(none, {}).ok).toBe(false);
  });
});
