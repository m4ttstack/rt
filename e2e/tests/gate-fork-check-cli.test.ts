/**
 * e2e: the AskUserQuestion hook end to end against a real daemon, the
 * compiled binary's tree dispatch, and the shipped scripts/hooks/gate-fork.sh.
 *
 * Pane rule: `rt gate ask --subject run:...` from a pane files a form gate
 * whose origin carries that pane and session but no worktree (the
 * receive-review shape); the same pane and session get the form, another
 * pane or a reused pane under another session do not.
 *
 * Session rule: a run started under a session, asked with no --subject, is
 * reached from a relaunched pane (new pane id, same session) through the
 * daemon's own subject resolver.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { createTestHome, RT_BINARY } from "../harness.ts";

const HOOK_PATH = resolve(import.meta.dir, "..", "..", "scripts", "hooks", "gate-fork.sh");

async function waitForSocket(sockPath: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(sockPath)) {
    if (Date.now() > deadline) throw new Error(`daemon socket never appeared at ${sockPath}`);
    await Bun.sleep(100);
  }
}

function freePort(): number {
  const srv = Bun.serve({ port: 0, fetch: () => new Response("") });
  const port = srv.port;
  srv.stop(true);
  if (!port) throw new Error("failed to allocate a free port");
  return port;
}

let apiPort = 0;
const children: Array<ReturnType<typeof Bun.spawn>> = [];

function baseEnv(home: string, extraEnv: Record<string, string>): Record<string, string> {
  const bunDir = join(process.execPath, "..");
  return {
    HOME: home,
    PATH: `${join(RT_BINARY, "..")}:${bunDir}:/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin`,
    TERM: "xterm-256color",
    RT_SKIP_SETUP: "1",
    CI: "true",
    RT_API_PORT: String(apiPort),
    RT_RUN_EMIT: "0",
    ...extraEnv,
  };
}

function spawnTracked(cmd: string[], env: Record<string, string>, stdin?: string, cwd?: string) {
  const proc = Bun.spawn(cmd, {
    env, ...(cwd ? { cwd } : {}),
    stdin: stdin === undefined ? "ignore" : new Blob([stdin]),
    stdout: "pipe", stderr: "pipe",
  });
  children.push(proc);
  return proc;
}

async function finished(proc: ReturnType<typeof spawnTracked>) {
  const exitCode = await proc.exited;
  return { exitCode, stdout: await new Response(proc.stdout).text(), stderr: await new Response(proc.stderr).text() };
}

const QUESTIONS = JSON.stringify([{ id: "q", label: "Proceed?", multi: false, options: ["yes", "no"] }]);
const LAUNCH_SUBJECT = "herd:e2e-x/e2e-1-job";
const ASK_PANE = "wKW:p2";
const ASK_SESSION = "sess-ask";
const RUN_PANE = "wKW:p4";
const RUN_SESSION = "sess-run";
const ALLOW = { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" } };

describe("AskUserQuestion hook e2e", () => {
  let home: string;
  let cleanup: () => void;
  let tree: string;

  async function askForm(args: string[], pane: string, session: string): Promise<void> {
    const asked = await finished(spawnTracked(
      [RT_BINARY, "gate", "ask", "--questions", QUESTIONS, "--context", "the plan under decision", ...args],
      baseEnv(home, { HERDR_PANE_ID: pane, CLAUDE_CODE_SESSION_ID: session }),
    ));
    const parsed = JSON.parse(asked.stdout) as { ok: boolean; presentation: string };
    if (!parsed.ok || parsed.presentation !== "form") throw new Error(`gate ask did not open a form gate: ${asked.stdout}${asked.stderr}`);
  }

  beforeAll(async () => {
    apiPort = freePort();
    ({ path: home, cleanup } = createTestHome());
    tree = realpathSync(mkdtempSync(join(tmpdir(), "rt-e2e-fork-tree-")));
    const daemon = spawnTracked([RT_BINARY, "--daemon"], baseEnv(home, {}));
    await waitForSocket(join(home, ".mattstack", "rt", "rt.sock"));
    if (daemon.exitCode !== null) throw new Error(`daemon exited (code ${daemon.exitCode}) right after creating its socket`);

    await askForm(["--subject", "run:e2e-fork-r1"], ASK_PANE, ASK_SESSION);

    const started = await finished(spawnTracked(
      [RT_BINARY, "runs", "run-start", "--repo", "widget-forge", "--work-type", "feature", "--pipeline", "default"],
      baseEnv(home, { HERDR_PANE_ID: RUN_PANE, CLAUDE_CODE_SESSION_ID: RUN_SESSION }),
    ));
    if (started.exitCode !== 0) throw new Error(`run-start failed: ${started.stdout}${started.stderr}`);
    await askForm([], RUN_PANE, RUN_SESSION);
  });

  afterAll(async () => {
    for (const child of children) {
      try { child.kill(); } catch { /* already gone */ }
    }
    await Promise.all(children.map((c) => c.exited));
    cleanup();
    rmSync(tree, { recursive: true, force: true });
  });

  const hook = (pane: string, session: string, envSession?: string) => finished(spawnTracked(
    [HOOK_PATH],
    baseEnv(home, {
      HERDR_PANE_ID: pane, RT_GATE_SUBJECT: LAUNCH_SUBJECT, RT_AGENT_ID: "ag-e2e",
      ...(envSession ? { CLAUDE_CODE_SESSION_ID: envSession } : {}),
    }),
    JSON.stringify({ session_id: session, cwd: tree, hook_event_name: "PreToolUse", tool_name: "AskUserQuestion" }),
    tree,
  ));

  const expectDeny = (stdout: string) => {
    const parsed = JSON.parse(stdout) as { hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string } };
    expect(parsed.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(parsed.hookSpecificOutput.permissionDecisionReason).toContain("form: ask it here with AskUserQuestion");
  };

  test("pane rule: the pane and session that asked get the form", async () => {
    const res = await hook(ASK_PANE, ASK_SESSION);
    expect(res.exitCode).toBe(0);
    expect(JSON.parse(res.stdout)).toEqual(ALLOW);
  }, 30_000);

  test("pane rule: a hook session id that differs from the env one gate ask stamped still gets the form", async () => {
    const res = await hook(ASK_PANE, "sess-hook-differs", ASK_SESSION);
    expect(res.exitCode).toBe(0);
    expect(JSON.parse(res.stdout)).toEqual(ALLOW);
  }, 30_000);

  test("pane rule: any other pane is sent to rt gate ask", async () => {
    const res = await hook("wKW:p9", "sess-p9");
    expect(res.exitCode).toBe(0);
    expectDeny(res.stdout);
  }, 30_000);

  test("pane rule: the same pane id under another session is sent to rt gate ask", async () => {
    const res = await hook(ASK_PANE, "sess-reused-pane");
    expect(res.exitCode).toBe(0);
    expectDeny(res.stdout);
  }, 30_000);

  test("session rule: a relaunched pane on the run's session gets the form", async () => {
    const res = await hook("wKW:p5", RUN_SESSION);
    expect(res.exitCode).toBe(0);
    expect(JSON.parse(res.stdout)).toEqual(ALLOW);
  }, 30_000);
});
