/**
 * e2e: `rt gate ask`'s always-JSON envelope (RT-150), against a real daemon.
 * The success and refusal shapes below are the wire contract skills parse
 * on stdout for both outcomes -- e2e is the only suite that exercises the
 * compiled binary's tree dispatch, so only it can catch these strings
 * drifting (`bun run test` skips e2e entirely).
 *
 * Case 3 proves the CLI never reads RT_GATE_SUBJECT out of its own process
 * env, only --subject.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync } from "fs";
import { join } from "path";
import { createTestHome, RT_BINARY } from "../harness.ts";

async function waitForSocket(sockPath: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(sockPath)) {
    if (Date.now() > deadline) throw new Error(`daemon socket never appeared at ${sockPath}`);
    await Bun.sleep(100);
  }
}

/** Grab a free TCP port by binding port 0 and releasing it. */
function freePort(): number {
  const srv = Bun.serve({ port: 0, fetch: () => new Response("") });
  const port = srv.port;
  srv.stop(true);
  if (!port) throw new Error("failed to allocate a free port");
  return port;
}

let apiPort = 0;
const children: Array<ReturnType<typeof Bun.spawn>> = [];

function runRt(args: string[], home: string, extraEnv: Record<string, string> = {}) {
  const bunDir = join(process.execPath, "..");
  const proc = Bun.spawn([RT_BINARY, ...args], {
    env: {
      HOME: home,
      PATH: `${join(RT_BINARY, "..")}:${bunDir}:/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin`,
      TERM: "xterm-256color",
      RT_SKIP_SETUP: "1",
      CI: "true",
      RT_API_PORT: String(apiPort),
      RT_RUN_EMIT: "0",
      ...extraEnv,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  children.push(proc);
  return proc;
}

async function finished(proc: ReturnType<typeof runRt>) {
  const exitCode = await proc.exited;
  return {
    exitCode,
    stdout: await new Response(proc.stdout).text(),
    stderr: await new Response(proc.stderr).text(),
  };
}

const NO_SUBJECT_REFUSAL = "no subject: pass --subject, or run under a recorded run/agent session";
const ASK_USAGE = "usage: rt gate ask --questions <json> [--context <text>] [--kind <k>] [--subject <s>] [--json]";

describe("rt gate ask CLI e2e", () => {
  let home: string;
  let cleanup: () => void;
  let daemon: ReturnType<typeof runRt>;

  beforeAll(async () => {
    apiPort = freePort();
    ({ path: home, cleanup } = createTestHome());
    daemon = runRt(["--daemon"], home);
    await waitForSocket(join(home, ".mattstack", "rt", "rt.sock"));
    if (daemon.exitCode !== null) {
      throw new Error(`daemon process exited (code ${daemon.exitCode}) right after creating its socket`);
    }
  });

  afterAll(async () => {
    for (const child of children) {
      try { child.kill(); } catch { /* already gone */ }
    }
    await Promise.all(children.map((c) => c.exited));
    cleanup();
  });

  test("explicit subject + pane + session, 2-option question: ok:true form envelope", async () => {
    const questions = JSON.stringify([{ id: "q", label: "Pick", multi: false, options: ["a", "b"] }]);
    const res = await finished(runRt(
      ["gate", "ask", "--questions", questions, "--subject", "mr:e2e-1", "--context", "the diff under decision, quoted"],
      home,
      { HERDR_PANE_ID: "pane-1", CLAUDE_CODE_SESSION_ID: "sess-1" },
    ));
    expect(res.exitCode).toBe(0);
    const parsed = JSON.parse(res.stdout) as { id: string; ok: boolean; presentation: string; subject: string; supersededId: string | null };
    expect(parsed).toEqual({
      ok: true,
      id: expect.any(String),
      presentation: "form",
      subject: "mr:e2e-1",
      supersededId: null,
    });
  }, 30_000);

  test("no --subject, no recorded run/agent for the session: ok:false refusal, exit 1", async () => {
    const questions = JSON.stringify([{ id: "q", label: "Pick", multi: false, options: ["a", "b"] }]);
    const res = await finished(runRt(
      ["gate", "ask", "--questions", questions],
      home,
      { HERDR_PANE_ID: "pane-2", CLAUDE_CODE_SESSION_ID: "sess-2-no-subject" },
    ));
    expect(res.exitCode).toBe(1);
    expect(JSON.parse(res.stdout)).toEqual({ ok: false, error: NO_SUBJECT_REFUSAL });
  }, 30_000);

  test("RT_GATE_SUBJECT in the child env is never read: same refusal as no-subject case", async () => {
    const questions = JSON.stringify([{ id: "q", label: "Pick", multi: false, options: ["a", "b"] }]);
    const res = await finished(runRt(
      ["gate", "ask", "--questions", questions],
      home,
      {
        HERDR_PANE_ID: "pane-3",
        CLAUDE_CODE_SESSION_ID: "sess-3-no-subject",
        RT_GATE_SUBJECT: "mr:e2e-env",
      },
    ));
    expect(res.exitCode).toBe(1);
    expect(JSON.parse(res.stdout)).toEqual({ ok: false, error: NO_SUBJECT_REFUSAL });
  }, 30_000);

  test("malformed --questions JSON: ok:false refusal, exit 1, no daemon contact", async () => {
    const res = await finished(runRt(
      ["gate", "ask", "--questions", "not json"],
      home,
      { HERDR_PANE_ID: "pane-4", CLAUDE_CODE_SESSION_ID: "sess-4-malformed" },
    ));
    expect(res.exitCode).toBe(1);
    expect(JSON.parse(res.stdout)).toEqual({ ok: false, error: "--questions is not valid JSON: not json" });
  }, 30_000);

  // RT-177: a human-owned gate with no context is what put a bare decision
  // form in front of Matt with nothing to decide from.
  test("no --context on a human-owned gate: ok:false refusal naming what to pass, exit 1", async () => {
    const questions = JSON.stringify([{ id: "q", label: "Pick", multi: false, options: ["a", "b"] }]);
    const res = await finished(runRt(
      ["gate", "ask", "--questions", questions, "--subject", "mr:e2e-bare"],
      home,
      { HERDR_PANE_ID: "pane-6", CLAUDE_CODE_SESSION_ID: "sess-6-bare" },
    ));
    expect(res.exitCode).toBe(1);
    const parsed = JSON.parse(res.stdout) as { ok: boolean; error: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain("decide from alone");
  }, 30_000);

  test("an oversized --context still opens the gate, and the envelope says contextOmitted", async () => {
    const questions = JSON.stringify([{ id: "q", label: "Pick", multi: false, options: ["a", "b"] }]);
    const res = await finished(runRt(
      ["gate", "ask", "--questions", questions, "--subject", "mr:e2e-big", "--context", "x".repeat(9000)],
      home,
      { HERDR_PANE_ID: "pane-7", CLAUDE_CODE_SESSION_ID: "sess-7-big" },
    ));
    expect(res.exitCode).toBe(0);
    expect(JSON.parse(res.stdout)).toEqual({
      ok: true,
      id: expect.any(String),
      presentation: "form",
      subject: "mr:e2e-big",
      supersededId: null,
      contextOmitted: true,
    });
  }, 30_000);

  // RT-184: the per-option explanations and per-question context the pane's
  // form shows must reach the gate row, or the board renders bare labels.
  test("option descriptions and per-question context round-trip ask -> list --json, normalized like labels are", async () => {
    const questions = JSON.stringify([{
      id: "q", label: "Pick", multi: false, context: "what this one turns on",
      options: [{ value: "a", label: "fix", description: "patch the null check", recommended: true }, "b"],
    }]);
    const asked = await finished(runRt(
      ["gate", "ask", "--questions", questions, "--subject", "mr:e2e-structured", "--context", "the diff under decision, quoted"],
      home,
      { HERDR_PANE_ID: "pane-8", CLAUDE_CODE_SESSION_ID: "sess-8-structured" },
    ));
    expect(asked.exitCode).toBe(0);
    const { id, contextOmitted } = JSON.parse(asked.stdout) as { id: string; contextOmitted?: true };
    expect(contextOmitted).toBeUndefined();

    const listed = await finished(runRt(["gate", "list", "--json", "--subject-prefix", "mr:e2e-structured"], home));
    expect(listed.exitCode).toBe(0);
    const { gates } = JSON.parse(listed.stdout) as { gates: Array<{ id: string; context: string | null; questions: unknown }> };
    const row = gates.find((g) => g.id === id)!;
    expect(row.context).toBe("the diff under decision, quoted");
    expect(row.questions).toEqual([{
      id: "q", label: "Pick", multi: false, context: "what this one turns on",
      options: [{ value: "a", label: "Fix (Recommended)", description: "patch the null check" }, { value: "b", label: "B" }],
    }]);
  }, 30_000);

  test("question contexts over the shared budget are dropped, the gate context kept, and the envelope says contextOmitted", async () => {
    const questions = JSON.stringify([
      { id: "q", label: "Pick", multi: false, options: ["a", "b"], context: "x".repeat(4096) },
      { id: "m", label: "Pick many", multi: true, options: ["a", "b"], context: "y".repeat(4097) },
    ]);
    const asked = await finished(runRt(
      ["gate", "ask", "--questions", questions, "--subject", "mr:e2e-budget", "--context", "kept"],
      home,
      { HERDR_PANE_ID: "pane-9", CLAUDE_CODE_SESSION_ID: "sess-9-budget" },
    ));
    expect(asked.exitCode).toBe(0);
    const parsed = JSON.parse(asked.stdout) as { id: string; contextOmitted?: true };
    expect(parsed.contextOmitted).toBe(true);

    const listed = await finished(runRt(["gate", "list", "--json", "--subject-prefix", "mr:e2e-budget"], home));
    const { gates } = JSON.parse(listed.stdout) as { gates: Array<{ id: string; context: string | null; questions: Array<Record<string, unknown>> }> };
    const row = gates.find((g) => g.id === parsed.id)!;
    expect(row.context).toBe("kept");
    expect(row.questions.map((q) => "context" in q)).toEqual([false, false]);
  }, 30_000);

  test("missing --questions: ok:false usage refusal, exit 1, no daemon contact", async () => {
    const res = await finished(runRt(
      ["gate", "ask"],
      home,
      { HERDR_PANE_ID: "pane-5", CLAUDE_CODE_SESSION_ID: "sess-5-missing-questions" },
    ));
    expect(res.exitCode).toBe(1);
    expect(JSON.parse(res.stdout)).toEqual({ ok: false, error: ASK_USAGE });
  }, 30_000);
});
