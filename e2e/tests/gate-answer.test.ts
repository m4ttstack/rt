/**
 * e2e: gate:answer owner enforcement against a real daemon (RT-117). A gate
 * opened on a run whose spawner is a herd is herd-owned; answering it needs
 * the owning shepherd's session, the answering pane itself, or an explicit
 * human --override. A closed (superseded) gate is refused with the id of
 * whatever replaced it. Both refusals are pinned on the CLI's exact stderr
 * text, which only an e2e run -- not the unit-level handler tests -- can
 * catch drifting.
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
      RT_RUN_EMIT: "0", // no need for run-start to round-trip through the daemon here
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

async function startRun(home: string, spawnedBy?: string): Promise<string> {
  const args = ["runs", "run-start", "--repo", "widget-forge", "--work-type", "feature", "--pipeline", "default"];
  if (spawnedBy) args.push("--spawned-by", spawnedBy);
  const res = await finished(runRt(args, home));
  expect(res.exitCode).toBe(0);
  return (JSON.parse(res.stdout) as { runId: string }).runId;
}

async function openGate(home: string, runId: string, kind = "clarify"): Promise<string> {
  const questions = JSON.stringify([{ id: "q", label: "Pick", multi: false, options: ["a", "b"] }]);
  const origin = JSON.stringify({ runId, presentation: "wait" });
  const res = await finished(runRt(
    ["gate", "open", "--subject", `run:${runId}`, "--kind", kind, "--questions", questions, "--origin", origin],
    home,
  ));
  expect(res.exitCode).toBe(0);
  return (JSON.parse(res.stdout) as { id: string }).id;
}

describe("rt gate answer owner enforcement (RT-117 e2e)", () => {
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

  test("a non-owner is refused; --override lets a human answer anyway", async () => {
    const runId = await startRun(home, "herd:h-1");

    const intruderGate = await openGate(home, runId, "clarify-a");
    const refused = await finished(runRt(
      ["gate", "answer", intruderGate, "--answers", JSON.stringify({ q: "a" }), "--by", "intruder"],
      home,
    ));
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain(`gate ${intruderGate} is owned by herd:h-1; pass --override to answer anyway`);

    const overrideGate = await openGate(home, runId, "clarify-b");
    const overridden = await finished(runRt(
      ["gate", "answer", overrideGate, "--answers", JSON.stringify({ q: "a" }), "--by", "matt", "--override"],
      home,
    ));
    expect(overridden.exitCode).toBe(0);
    const overriddenRow = JSON.parse(overridden.stdout).row;
    expect(overriddenRow.answer.overridden).toBe(true);
  }, 30_000);

  test("answering a superseded gate reports the structured closed rejection with supersededBy", async () => {
    const runId = await startRun(home);
    const firstId = await openGate(home, runId, "clarify-c");
    const secondId = await openGate(home, runId, "clarify-c"); // same subject+kind supersedes

    const res = await finished(runRt(
      ["gate", "answer", firstId, "--answers", JSON.stringify({ q: "a" }), "--by", "anyone"],
      home,
    ));
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain(`gate ${firstId} is closed (superseded); superseded by ${secondId}`);
  }, 30_000);
});
