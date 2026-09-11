/**
 * e2e: `rt reconciler status`/`clear` against a real compiled daemon.
 * Follows e2e/tests/events.test.ts's single-daemon harness recipe.
 *
 * The reconciler's own sweep is scheduled with a 30s boot delay (lib/daemon.ts,
 * "reconciler-sweep"), so a `status` call made immediately after the daemon's
 * socket appears is guaranteed to land before the first sweep -- the exact
 * envelope this test pins is the reconciler's documented pre-sweep default
 * (lib/daemon/reconciler.ts's `lastStatus` initializer), not a race.
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
const children: Array<ReturnType<typeof Bun.spawn>> = [];

function runRt(args: string[], home: string) {
  const bunDir = join(process.execPath, "..");
  const proc = Bun.spawn([RT_BINARY, ...args], {
    env: {
      HOME: home,
      PATH: `${join(RT_BINARY, "..")}:${bunDir}:/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin`,
      TERM: "xterm-256color",
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

async function finished(proc: ReturnType<typeof runRt>) {
  const exitCode = await proc.exited;
  return {
    exitCode,
    stdout: await new Response(proc.stdout).text(),
    stderr: await new Response(proc.stderr).text(),
  };
}

describe("rt reconciler (e2e)", () => {
  let home: string;
  let cleanup: () => void;
  let daemon: ReturnType<typeof runRt>;

  beforeAll(async () => {
    apiPort = freePort();
    ({ path: home, cleanup } = createTestHome());
    daemon = runRt(["--daemon"], home);
    await waitForSocket(join(home, ".mattstack", "rt", "rt.sock"));
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

  test("status --json is the exact pre-sweep envelope", async () => {
    const res = await finished(runRt(["reconciler", "status", "--json"], home));
    expect(res.exitCode).toBe(0);
    expect(res.stdout.trim()).toBe('{"ok":true,"sweptAt":0,"herdrReachable":false,"executors":[]}');
  }, 20_000);

  test("clear --json is the exact envelope for an unknown agent", async () => {
    const res = await finished(runRt(["reconciler", "clear", "ag-unknown", "--json"], home));
    expect(res.exitCode).toBe(0);
    expect(res.stdout.trim()).toBe('{"ok":true,"cleared":true}');
  }, 20_000);
});
