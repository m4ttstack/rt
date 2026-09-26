/**
 * e2e: `pane:announce-relocation` over the daemon socket, against a real
 * compiled daemon. Follows e2e/tests/reconciler.test.ts's single-daemon
 * harness recipe.
 *
 * The isolated test daemon has no herdr panes reachable, so
 * `snapshotPanes()` resolves to an empty/null snapshot -- `resolveLivePane`
 * then finds no match and the watcher's own `no-pane` branch fires
 * (lib/daemon/relocation-announce.ts), the same branch a real "session id
 * nobody has" would hit.
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

function freePort(): number {
  const srv = Bun.serve({ port: 0, fetch: () => new Response("") });
  const port = srv.port;
  srv.stop(true);
  if (!port) throw new Error("failed to allocate a free port");
  return port;
}

let apiPort = 0;
let sockPath = "";
const children: Array<ReturnType<typeof Bun.spawn>> = [];

function runRt(args: string[], home: string) {
  const bunDir = join(process.execPath, "..");
  const proc = Bun.spawn([RT_BINARY, ...args], {
    env: {
      HOME: home,
      PATH: `${join(RT_BINARY, "..")}:${bunDir}:/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin`,
      TERM: "xterm-256color",
      RT_GH_TOKEN_FALLBACK: "off",
      RT_SKIP_SETUP: "1",
      CI: "true",
      RT_API_PORT: String(apiPort),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  children.push(proc);
  return proc;
}

/** Raw POST over the daemon's unix socket, the same transport as lib/daemon-client.ts's trySocketQuery, kept local so this file never depends on that module's HOME-resolved constants. */
async function postCommand(cmd: string, payload: Record<string, unknown>): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const res = await fetch(`http://localhost/${cmd}`, {
    unix: sockPath,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  } as unknown as RequestInit);
  return (await res.json()) as { ok: boolean; data?: unknown; error?: string };
}

describe("pane:announce-relocation (e2e)", () => {
  let home: string;
  let cleanup: () => void;
  let daemon: ReturnType<typeof runRt>;

  beforeAll(async () => {
    apiPort = freePort();
    ({ path: home, cleanup } = createTestHome());
    sockPath = join(home, ".mattstack", "rt", "rt.sock");
    daemon = runRt(["--daemon"], home);
    await waitForSocket(sockPath);
    if (daemon.exitCode !== null) {
      throw new Error(
        `daemon process exited (code ${daemon.exitCode}) right after creating its socket -- ` +
          `port ${apiPort} collision or daemon boot crash; check the daemon's stderr.`,
      );
    }
  });

  afterAll(async () => {
    for (const child of children) {
      try { child.kill(); } catch { /* already gone */ }
    }
    await Promise.all(children.map((c) => c.exited));
    cleanup();
  });

  test("a session id no pane has returns scheduled:false, pane:null, reason:no-pane", async () => {
    const res = await postCommand("pane:announce-relocation", {
      sessionId: "session-nobody-has",
      tool: "EnterWorktree",
      cwd: "/tmp/nowhere",
    });
    expect(res).toEqual({ ok: true, data: { scheduled: false, pane: null, reason: "no-pane" } });
  }, 20_000);

  test("a tool other than EnterWorktree is refused", async () => {
    const res = await postCommand("pane:announce-relocation", {
      sessionId: "session-nobody-has",
      tool: "Bash",
      cwd: "/tmp/nowhere",
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("tool must be EnterWorktree");
  }, 20_000);

  test("a payload missing sessionId is refused", async () => {
    const res = await postCommand("pane:announce-relocation", {
      tool: "EnterWorktree",
      cwd: "/tmp/nowhere",
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("sessionId and cwd are required");
  }, 20_000);
});
