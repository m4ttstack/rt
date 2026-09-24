import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildForkCheckPayload, forkCheckHookOutput, forkDenyReason, FORK_CHECK_ALLOW } from "../gate.ts";

const agentEnv = {
  RT_GATE_SUBJECT: "herd:acme-x/acme-1234-attorney",
  HERDR_PANE_ID: "wKW:p2",
  CLAUDE_CODE_SESSION_ID: "sess-env",
} as NodeJS.ProcessEnv;

describe("buildForkCheckPayload", () => {
  test("sends the hook stdin's session and the env session, and the stdin cwd over the process cwd", () => {
    const stdin = JSON.stringify({ session_id: "sess-hook", cwd: "/does/not/exist", hook_event_name: "PreToolUse" });
    expect(buildForkCheckPayload(stdin, agentEnv, "/elsewhere")).toEqual({
      subject: "herd:acme-x/acme-1234-attorney",
      sessionIds: ["sess-hook", "sess-env"],
      paneId: "wKW:p2",
      worktrees: ["/does/not/exist"],
    });
  });

  test("one session id when stdin and env agree", () => {
    const stdin = JSON.stringify({ session_id: "sess-env" });
    expect(buildForkCheckPayload(stdin, agentEnv, "/x")?.sessionIds).toEqual(["sess-env"]);
  });

  test("no stdin payload falls back to the env session and the process cwd", () => {
    const p = buildForkCheckPayload("", agentEnv, "/does/not/exist");
    expect(p?.sessionIds).toEqual(["sess-env"]);
    expect(p?.worktrees).toEqual(["/does/not/exist"]);
  });

  test("no session anywhere leaves the field absent", () => {
    const env = { RT_GATE_SUBJECT: "herd:x/y" } as NodeJS.ProcessEnv;
    expect(buildForkCheckPayload("{}", env, "/x")?.sessionIds).toBeUndefined();
  });

  test("a symlinked cwd sends both the logical and the physical path", () => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), "fork-check-")));
    try {
      const real = join(base, "real");
      const link = join(base, "link");
      mkdirSync(real);
      symlinkSync(real, link);
      expect(buildForkCheckPayload(JSON.stringify({ cwd: link }), agentEnv, "/x")?.worktrees).toEqual([link, real]);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  test("no RT_GATE_SUBJECT means no rt agent launch: no payload, nothing to ask", () => {
    expect(buildForkCheckPayload("{}", { HERDR_PANE_ID: "wKW:p2" } as NodeJS.ProcessEnv, "/x")).toBeNull();
  });
});

describe("forkCheckHookOutput", () => {
  test("allow verdict: allow", () => {
    expect(forkCheckHookOutput({ ok: true, data: { allow: true, match: "pane", gateId: "g1" } })).toEqual(FORK_CHECK_ALLOW);
  });

  test("daemon unreachable: allow", () => {
    expect(forkCheckHookOutput({ ok: false, error: "rt daemon unreachable at /tmp/rt.sock: ECONNREFUSED" })).toEqual(FORK_CHECK_ALLOW);
  });

  test("a daemon that predates the verb: allow", () => {
    expect(forkCheckHookOutput({ ok: false, error: "unknown command: gate:fork-check" })).toEqual(FORK_CHECK_ALLOW);
  });

  test("not an rt agent launch (no payload sent): allow", () => {
    expect(forkCheckHookOutput(null)).toEqual(FORK_CHECK_ALLOW);
  });

  test("deny verdict: deny, naming the subject rt gate ask files under", () => {
    const out = forkCheckHookOutput({ ok: true, data: { allow: false, subject: "run:20260923-185017-2020-15828" } });
    expect(out).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: forkDenyReason("run:20260923-185017-2020-15828"),
      },
    });
  });
});

describe("forkDenyReason", () => {
  const reason = forkDenyReason("run:r1");

  test("sends the agent to rt gate ask first", () => {
    expect(reason).toContain("rt gate ask --questions <json>");
  });

  test("a form presentation comes back to AskUserQuestion, which is then allowed", () => {
    expect(reason).toContain("form: ask it here with AskUserQuestion, which this hook then allows");
    expect(reason).toContain("rt gate answer <id> --answers <json> --by pane");
  });

  test("only a wait presentation backgrounds rt gate wait", () => {
    expect(reason).toContain("wait: background `rt gate wait <id>` and end the turn");
    expect(reason.indexOf("rt gate wait")).toBeGreaterThan(reason.indexOf("wait:"));
  });

  test("names the subject JSON-quoted, and omits the clause when unresolved", () => {
    expect(forkDenyReason('run:"quoted"\tx')).toContain('This pane\'s gates file under "run:\\"quoted\\"\\tx".');
    expect(forkDenyReason(undefined)).not.toContain("gates file under");
  });
});
