/**
 * e2e: the herd watchdog's poke round trip against a real daemon under a
 * test HOME. A spawned worker goes idle with an answered gate it never
 * consumed; the watchdog sweep pokes its pane through herdr and
 * `rt herd status --json` carries the strike.
 *
 * herdr is faked on both transports, as in e2e/tests/herd.test.ts: the unix
 * socket for the daemon's herdrRequest calls and a CLI shim for agent:start.
 * The socket fake keeps `events.subscribe` connections open, because the
 * watchdog's idle clock is set only by a `pane.agent_status_changed` frame
 * the lifecycle receives on the pane's own stream.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createTestHome, RT_BINARY } from "../harness.ts";
import { fakeHerdr, HerdrFakeError, HerdrFakeStream, type FakeHerdrHandler } from "../../lib/herdr/__tests__/fake-herdr.ts";

const PANE = "w1:p1";
const SWEEP_MS = "500";

/** The herdr CLI shim from e2e/tests/herd.test.ts: journals argv and keeps a
    synthetic workspace/tab table so the herd's workspace survives across calls. */
const FAKE_HERDR = `#!/bin/bash
echo "$@" >> "$FAKE_HERDR_LOG"

STATE="$FAKE_HERDR_STATE"
mkdir -p "$STATE"

find_flag() {
  local flag="$1"; shift
  local i n
  for ((i = 1; i <= $#; i++)); do
    if [ "\${!i}" = "$flag" ]; then
      n=$((i + 1))
      printf '%s' "\${!n}"
      return 0
    fi
  done
}

case "$1 $2" in
  "workspace list")
    if [ -f "$STATE/ws_label" ]; then
      label=$(cat "$STATE/ws_label")
      printf '{"result":{"workspaces":[{"workspace_id":"w1","label":"%s"}]}}' "$label"
    else
      printf '{"result":{"workspaces":[]}}'
    fi
    ;;
  "workspace create")
    label=$(find_flag --label "$@")
    printf '%s' "$label" > "$STATE/ws_label"
    echo 2 > "$STATE/seq"
    : > "$STATE/tabs"
    printf '{"result":{"root_pane":{"pane_id":"w1:p1","tab_id":"w1:t1","workspace_id":"w1"}}}'
    ;;
  "tab rename")
    printf '%s|%s\\n' "$3" "$4" >> "$STATE/tabs"
    printf '{}'
    ;;
  "tab list")
    entries=""
    if [ -f "$STATE/tabs" ]; then
      while IFS='|' read -r tid tlabel; do
        [ -z "$tid" ] && continue
        if [ -n "$entries" ]; then entries="$entries,"; fi
        entries="$entries{\\"tab_id\\":\\"$tid\\",\\"label\\":\\"$tlabel\\"}"
      done < "$STATE/tabs"
    fi
    printf '{"result":{"tabs":[%s]}}' "$entries"
    ;;
  "tab create")
    label=$(find_flag --label "$@")
    n=$(cat "$STATE/seq" 2>/dev/null || echo 2)
    echo $((n + 1)) > "$STATE/seq"
    tab_id="w1:t$n"
    pane_id="w1:p$n"
    printf '%s|%s\\n' "$tab_id" "$label" >> "$STATE/tabs"
    printf '{"result":{"root_pane":{"pane_id":"%s","tab_id":"%s","workspace_id":"w1"}}}' "$pane_id" "$tab_id"
    ;;
  *)
    printf '{}'
    ;;
esac
`;

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

let home = "";
let cleanupHome: () => void = () => {};
let apiPort = 0;
let herdr: ReturnType<typeof fakeHerdr>;
const children: Array<ReturnType<typeof Bun.spawn>> = [];
const stops: Array<() => void> = [];

function runRt(args: string[], homeDir: string, extraEnv: Record<string, string> = {}) {
  const bunDir = join(process.execPath, "..");
  const proc = Bun.spawn([RT_BINARY, ...args], {
    env: {
      HOME: homeDir,
      PATH: `${join(RT_BINARY, "..")}:${bunDir}:/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin`,
      TERM: "xterm-256color",
      RT_SKIP_SETUP: "1",
      CI: "true",
      RT_API_PORT: String(apiPort),
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

async function startDaemonForHome(homeDir: string, extraEnv: Record<string, string> = {}): Promise<void> {
  apiPort = freePort();
  runRt(["--daemon"], homeDir, extraEnv);
  await waitForSocket(join(homeDir, ".mattstack", "rt", "rt.sock"));
}

// ─── fakes ───────────────────────────────────────────────────────────────────

const subscribesTo = (params: Record<string, unknown>, type: string): boolean =>
  Array.isArray(params.subscriptions) && (params.subscriptions as Array<{ type?: unknown }>).some((s) => s.type === type);

/** Socket-side herdr fake. The pane carries `agent: "claude"` everywhere,
    since the watchdog reads a listed pane without one as a dead worker. */
function herdrSocketFake(): ReturnType<typeof fakeHerdr> {
  const agent = { pane_id: PANE, agent: "claude", agent_status: "idle" };
  const handler: FakeHerdrHandler = (method, params) => {
    if (method === "session.snapshot") return { snapshot: { workspaces: [], panes: [agent] } };
    if (method === "agent.get" || method === "agent.wait") return { agent };
    if (method === "agent.prompt") return { type: "agent_prompted", agent: { ...agent, agent_status: "working" } };
    if (method === "events.subscribe") {
      // The pane's own status stream gets its idle frame right behind the
      // ack; that receipt is the watchdog's idle clock.
      const frames = subscribesTo(params, "pane.agent_status_changed")
        ? [{ event: "pane.agent_status_changed", data: { pane_id: PANE, agent_status: "idle" } }]
        : [];
      return new HerdrFakeStream({ type: "subscribed" }, frames);
    }
    return new HerdrFakeError("invalid_request", `${method} ${JSON.stringify(params)}`);
  };
  return fakeHerdr(handler);
}

let registrySeq = 0;

/** A claude-registry entry (lib/claude-registry.ts) under the test HOME,
    pointed at a fake inbox this test process owns; `process.pid` satisfies
    `inboxAlive`'s liveness probe for the whole run. */
function registerFakeInbox(homeDir: string, sessionId: string, socketPath: string): void {
  const dir = join(homeDir, ".claude", "sessions");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${100000 + registrySeq++}.json`),
    JSON.stringify({ sessionId, pid: process.pid, messagingSocketPath: socketPath, status: "idle" }),
  );
}

/** A real unix-socket "Claude Code inbox": one connection and one JSON line per frame. */
function startFakeInbox(): { socketPath: string; frames: Array<Record<string, unknown>>; stop: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "e2e-inbox-"));
  const socketPath = join(dir, "s.sock");
  const frames: Array<Record<string, unknown>> = [];
  const server = Bun.listen({
    unix: socketPath,
    socket: {
      data(_socket, chunk) {
        for (const line of chunk.toString().split("\n")) {
          if (!line.trim()) continue;
          try { frames.push(JSON.parse(line)); } catch { /* a split chunk: the whole line arrives eventually */ }
        }
      },
    },
  });
  return {
    socketPath,
    frames,
    stop: () => { server.stop(true); rmSync(dir, { recursive: true, force: true }); },
  };
}

async function waitFor<T>(find: () => T | undefined, what: string, timeoutMs: number, stepMs = 250): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const hit = find();
    if (hit !== undefined) return hit;
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}`);
    await Bun.sleep(stepMs);
  }
}

function frameContent(frame: Record<string, unknown>): string {
  const message = frame.message as { content?: unknown } | undefined;
  return typeof message?.content === "string" ? message.content : "";
}

// ─── suite ───────────────────────────────────────────────────────────────────

describe("rt herd watchdog (e2e)", () => {
  beforeAll(async () => {
    ({ path: home, cleanup: cleanupHome } = createTestHome());
    herdr = herdrSocketFake();
    stops.push(herdr.stop);

    const binDir = join(home, ".local", "bin");
    mkdirSync(binDir, { recursive: true });
    const herdrBin = join(binDir, "herdr");
    writeFileSync(herdrBin, FAKE_HERDR, { mode: 0o755 });
    const herdrLog = join(home, "herdr.log");
    writeFileSync(herdrLog, "");
    const herdrState = join(home, "herdr-state");
    mkdirSync(herdrState, { recursive: true });

    // fastMins 0: any idle age qualifies, so the test never waits on a clock.
    const seeded = await finished(runRt(["settings", "set", "herd.watchdog.fastMins", "0", "--scope", "machine"], home));
    expect(seeded.exitCode).toBe(0);

    await startDaemonForHome(home, {
      HERDR_SOCKET_PATH: herdr.sock,
      HERDR_BIN: herdrBin,
      FAKE_HERDR_LOG: herdrLog,
      FAKE_HERDR_STATE: herdrState,
      RT_HERD_WATCHDOG_SWEEP_MS: SWEEP_MS,
    });
  });

  afterAll(async () => {
    for (const stop of stops) stop();
    stops.length = 0;
    for (const child of children) {
      try { child.kill(); } catch { /* already gone */ }
    }
    await Promise.all(children.map((c) => c.exited));
    children.length = 0;
    cleanupHome();
  });

  test("an idle worker with an answered, unconsumed gate is poked and status carries the strike", async () => {
    const shepherd = startFakeInbox();
    stops.push(shepherd.stop);
    registerFakeInbox(home, "sess-shepherd", shepherd.socketPath);

    const repo = join(home, "repo");
    mkdirSync(repo, { recursive: true });

    const started = await finished(runRt(["herd", "start", "--name", "e2e", "--repo", repo, "--json"], home, {
      CLAUDE_CODE_SESSION_ID: "sess-shepherd",
    }));
    expect(started.exitCode).toBe(0);
    const herd = JSON.parse(started.stdout) as { herd: string; room: string };

    const brief = join(home, "brief.md");
    writeFileSync(brief, "# e2e brief");
    const spawned = await finished(runRt(
      ["herd", "spawn", "--herd", herd.herd, "--job", "job-a", "--brief", brief, "--dir", repo, "--json"],
      home,
    ));
    expect(spawned.exitCode).toBe(0);
    const job = JSON.parse(spawned.stdout) as { job: string; pane: string; sessionId: string };
    expect(job).toMatchObject({ job: "job-a", pane: PANE });

    // The gate's nudge must land on the job's own session for the watchdog
    // to count it, so the worker's inbox is registered under that id.
    const worker = startFakeInbox();
    stops.push(worker.stop);
    registerFakeInbox(home, job.sessionId, worker.socketPath);

    // herdr detecting the agent is what makes the lifecycle open the pane's
    // status stream; the fake answers that stream with the idle frame.
    expect(herdr.push({ event: "pane_agent_detected", data: { pane_id: PANE } }, (r) => subscribesTo(r.params, "pane.agent_detected"))).toBe(1);
    await waitFor(
      () => herdr.seen.find((r) => r.method === "events.subscribe" && subscribesTo(r.params, "pane.agent_status_changed")),
      "the pane status subscription",
      10_000,
    );

    const questions = JSON.stringify([{ id: "q", label: "Which?", multi: false, options: ["a", "b"] }]);
    const asked = await finished(runRt(["herd", "ask", "--questions", questions, "--json"], home, {
      HERD_ID: herd.herd,
      HERD_JOB: "job-a",
      CLAUDE_CODE_SESSION_ID: job.sessionId,
    }));
    expect(asked.exitCode).toBe(0);
    const gate = (JSON.parse(asked.stdout) as { gate: string }).gate;
    await waitFor(() => shepherd.frames.find((f) => frameContent(f).includes(`[gate] ${gate} is now open`)), "the shepherd's doorbell", 10_000);

    const answered = await finished(runRt(
      ["gate", "answer", gate, "--answers", JSON.stringify({ q: "b" }), "--by", "shepherd"],
      home,
    ));
    expect(answered.exitCode).toBe(0);
    // The answer's doorbell reaching the worker is what records the delivery
    // the unconsumed-answered sensor requires.
    await waitFor(() => worker.frames.find((f) => frameContent(f).includes(`[gate] ${gate} answered by shepherd`)), "the worker's doorbell", 10_000);

    const poke = await waitFor(() => herdr.seen.find((r) => r.method === "agent.prompt"), "the watchdog poke", 20_000);
    expect(poke.params).toMatchObject({ target: PANE });
    expect(poke.params.text).toBe(`watchdog: gate ${gate} answered 0m ago and unconsumed. Consume it or post status.`);

    const status = await finished(runRt(["herd", "status", "--herd", herd.herd, "--json"], home));
    expect(status.exitCode).toBe(0);
    const statusData = JSON.parse(status.stdout) as { jobs: Array<Record<string, unknown>> };
    expect(statusData.jobs).toHaveLength(1);
    expect(statusData.jobs[0]).toMatchObject({ name: "job-a", pane: PANE, paneStatus: "idle" });
    expect(statusData.jobs[0]!.watchdog).toEqual({ strikes: 1, lastPokeAt: expect.any(Number) });
  }, 60_000);
});
