import { describe, expect, test } from "bun:test";
import { resolveGateSubject } from "../gate-subject.ts";

const none = { runsBySession: () => [], agentBySession: () => undefined };

describe("resolveGateSubject", () => {
  test("explicit NON-run subject enriches from the session's single running run", () => {
    const deps = { ...none, runsBySession: () => [{ runId: "r1", status: "running", worktree: "/w" }] };
    expect(resolveGateSubject(deps, { subject: "mr:x", sessionId: "s" }))
      .toEqual({ ok: true, subject: "mr:x", runId: "r1", runWorktree: "/w" });
  });

  test("explicit non-run subject with zero or multiple running runs skips enrichment silently", () => {
    const two = { ...none, runsBySession: () => [
      { runId: "r1", status: "running", worktree: null },
      { runId: "r2", status: "running", worktree: null },
    ] };
    expect(resolveGateSubject(two, { subject: "mr:x", sessionId: "s" })).toEqual({ ok: true, subject: "mr:x" });
    expect(resolveGateSubject(none, { subject: "mr:x" })).toEqual({ ok: true, subject: "mr:x" });
  });

  test("explicit non-run subject with a real sessionId whose runsBySession returns zero running runs skips enrichment silently", () => {
    expect(resolveGateSubject(none, { subject: "mr:x", sessionId: "s" })).toEqual({ ok: true, subject: "mr:x" });
  });

  test("explicit run: subject takes runId from the SUBJECT, even with no sessionId", () => {
    expect(resolveGateSubject(none, { subject: "run:rZ" }))
      .toEqual({ ok: true, subject: "run:rZ", runId: "rZ" });
  });

  test("explicit run: subject never inherits a DIFFERENT session run's id or worktree", () => {
    const deps = { ...none, runsBySession: () => [{ runId: "r1", status: "running", worktree: "/w" }] };
    expect(resolveGateSubject(deps, { subject: "run:rZ", sessionId: "s" }))
      .toEqual({ ok: true, subject: "run:rZ", runId: "rZ" });
  });

  test("explicit run: subject matching the session's single running run gains its worktree", () => {
    const deps = { ...none, runsBySession: () => [{ runId: "r1", status: "running", worktree: "/w" }] };
    expect(resolveGateSubject(deps, { subject: "run:r1", sessionId: "s" }))
      .toEqual({ ok: true, subject: "run:r1", runId: "r1", runWorktree: "/w" });
  });

  test("single running run resolves to run:<id> with its worktree and runId", () => {
    const deps = { ...none, runsBySession: () => [{ runId: "r1", status: "running", worktree: "/w" }] };
    expect(resolveGateSubject(deps, { sessionId: "s" }))
      .toEqual({ ok: true, subject: "run:r1", runId: "r1", runWorktree: "/w" });
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

  test("agent fallback prefers the record's own subject", () => {
    const deps = { ...none, agentBySession: () => ({ id: "ag-9", subject: "herd:h1/job" }) };
    expect(resolveGateSubject(deps, { sessionId: "s" })).toEqual({ ok: true, subject: "herd:h1/job" });
  });

  test("agent fallback without a recorded subject stays agent:<id>", () => {
    const deps = { ...none, agentBySession: () => ({ id: "ag-9", subject: null }) };
    expect(resolveGateSubject(deps, { sessionId: "s" })).toEqual({ ok: true, subject: "agent:ag-9" });
  });

  test("agent fallback treats an empty-string recorded subject like null", () => {
    const deps = { ...none, agentBySession: () => ({ id: "ag-9", subject: "" }) };
    expect(resolveGateSubject(deps, { sessionId: "s" })).toEqual({ ok: true, subject: "agent:ag-9" });
  });

  test("agent record fallback (legacy fixture with no subject field)", () => {
    const deps = { ...none, agentBySession: () => ({ id: "ag-9" }) };
    expect(resolveGateSubject(deps, { sessionId: "s" })).toEqual({ ok: true, subject: "agent:ag-9" });
  });

  test("a running run outranks the agent record's subject", () => {
    const deps = {
      runsBySession: () => [{ runId: "r1", status: "running", worktree: null }],
      agentBySession: () => ({ id: "ag-9", subject: "herd:h1/job" }),
    };
    expect(resolveGateSubject(deps, { sessionId: "s" })).toEqual({ ok: true, subject: "run:r1", runId: "r1" });
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

// RT-157: a run stuck in status "running" that the liveness ladder would call
// stale must not capture the session's subject resolution.
describe("resolveGateSubject skips stale runs", () => {
  test("a stale running run falls through to the agent record", () => {
    const deps = {
      runsBySession: () => [{ runId: "r1", status: "running", worktree: "/w", stale: true }],
      agentBySession: () => ({ id: "ag-9", subject: "herd:h1/job" }),
    };
    expect(resolveGateSubject(deps, { sessionId: "s" })).toEqual({ ok: true, subject: "herd:h1/job" });
  });

  test("a stale run never counts toward the multiple-running-runs refusal", () => {
    const deps = { ...none, runsBySession: () => [
      { runId: "r1", status: "running", worktree: "/w", stale: true },
      { runId: "r2", status: "running", worktree: "/w2", stale: false },
    ] };
    expect(resolveGateSubject(deps, { sessionId: "s" }))
      .toEqual({ ok: true, subject: "run:r2", runId: "r2", runWorktree: "/w2" });
  });

  test("an explicit non-run subject never enriches from a stale run", () => {
    const deps = { ...none, runsBySession: () => [{ runId: "r1", status: "running", worktree: "/w", stale: true }] };
    expect(resolveGateSubject(deps, { subject: "mr:x", sessionId: "s" })).toEqual({ ok: true, subject: "mr:x" });
  });
});
