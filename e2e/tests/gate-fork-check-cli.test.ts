/**
 * e2e: the AskUserQuestion hook end to end against a real daemon, the
 * compiled binary's tree dispatch, and the shipped scripts/hooks/gate-fork.sh.
 * Reproduces the receive-review case: `rt gate ask` files a run: gate whose
 * origin carries this pane but no worktree, and the same pane's hook must
 * then allow the form it was told to present.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdtempSync, realpathSync } from "fs";
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

const RUN_SUBJECT = "run:e2e-fork-r1";
const LAUNCH_SUBJECT = "herd:e2e-x/e2e-1-job";
const ASK_PANE = "wKW:p2";

describe("AskUserQuestion hook e2e", () => {
  let home: string;
  let cleanup: () => void;
  let tree: string;

  beforeAll(async () => {
    apiPort = freePort();
    ({ path: home, cleanup } = createTestHome());
    tree = realpathSync(mkdtempSync(join(tmpdir(), "rt-e2e-fork-tree-")));
    const daemon = spawnTracked([RT_BINARY, "--daemon"], baseEnv(home, {}));
    await waitForSocket(join(home, ".mattstack", "rt", "rt.sock"));
    if (daemon.exitCode !== null) throw new Error(`daemon exited (code ${daemon.exitCode}) right after creating its socket`);

    const questions = JSON.stringify([{ id: "q", label: "Proceed?", multi: false, options: ["yes", "no"] }]);
    const asked = await finished(spawnTracked(
      [RT_BINARY, "gate", "ask", "--questions", questions, "--subject", RUN_SUBJECT, "--context", "the plan under decision"],
      baseEnv(home, { HERDR_PANE_ID: ASK_PANE, CLAUDE_CODE_SESSION_ID: "sess-ask" }),
    ));
    const parsed = JSON.parse(asked.stdout) as { ok: boolean; presentation: string };
    if (!parsed.ok || parsed.presentation !== "form") throw new Error(`gate ask did not open a form gate: ${asked.stdout}${asked.stderr}`);
  });

  afterAll(async () => {
    for (const child of children) {
      try { child.kill(); } catch { /* already gone */ }
    }
    await Promise.all(children.map((c) => c.exited));
    cleanup();
  });

  const hook = (pane: string) => finished(spawnTracked(
    [HOOK_PATH],
    baseEnv(home, { HERDR_PANE_ID: pane, RT_GATE_SUBJECT: LAUNCH_SUBJECT, RT_AGENT_ID: "ag-e2e" }),
    JSON.stringify({ session_id: "sess-hook", cwd: tree, hook_event_name: "PreToolUse", tool_name: "AskUserQuestion" }),
    tree,
  ));

  test("the pane that asked gets its form: allow", async () => {
    const res = await hook(ASK_PANE);
    expect(res.exitCode).toBe(0);
    expect(JSON.parse(res.stdout)).toEqual({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" } });
  }, 30_000);

  test("any other pane is sent to rt gate ask: deny", async () => {
    const res = await hook("wKW:p9");
    expect(res.exitCode).toBe(0);
    const parsed = JSON.parse(res.stdout) as { hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string } };
    expect(parsed.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(parsed.hookSpecificOutput.permissionDecisionReason).toContain("form: ask it here with AskUserQuestion");
  }, 30_000);
});
