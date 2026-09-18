import { describe, expect, test } from "bun:test";
import { makeSandbox } from "../../test-support/sandbox.ts";
import { rawGit } from "../exec.ts";

// Finds the pid of a still-direct child of this test process whose command
// line matches, polling because the child may not have been reflected in
// the process table the instant Bun.spawn returns.
async function findChildPid(match: RegExp, timeoutMs = 2000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const proc = Bun.spawn(["ps", "-o", "pid=,ppid=,command=", "-e"], { stdout: "pipe" });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    for (const line of out.split("\n")) {
      const fields = line.trim().split(/\s+/);
      const pid = Number(fields[0]);
      const ppid = Number(fields[1]);
      const command = fields.slice(2).join(" ");
      if (ppid === process.pid && pid > 0 && match.test(command)) return pid;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`no child of ${process.pid} matching ${match} appeared within ${timeoutMs}ms`);
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntilExited(pid: number, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isRunning(pid)) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`pid ${pid} still running after ${timeoutMs}ms`);
}

describe("rawGit abort", () => {
  test("aborting mid-run rejects promptly and leaves no lingering child", async () => {
    const sb = await makeSandbox();
    const server = Bun.serve({
      port: 0,
      // Never resolves: the fetch's HTTP request hangs, holding the spawned
      // git process open until something kills it.
      fetch: () => new Promise<Response>(() => {}),
    });
    try {
      await sb.git(["remote", "add", "origin", `http://127.0.0.1:${server.port}/x.git`]);
      const controller = new AbortController();
      const promise = rawGit(sb.dir, ["fetch", "origin"], { signal: controller.signal });
      const childPid = await findChildPid(/git fetch origin/);

      const start = Date.now();
      controller.abort();
      await expect(promise).rejects.toThrow();
      expect(Date.now() - start).toBeLessThan(5000);

      await waitUntilExited(childPid);
    } finally {
      server.stop(true);
      await sb.cleanup();
    }
  });

  test("an already-aborted signal rejects without spawning", async () => {
    const sb = await makeSandbox();
    try {
      const controller = new AbortController();
      controller.abort();
      await expect(rawGit(sb.dir, ["status"], { signal: controller.signal })).rejects.toThrow();
    } finally {
      await sb.cleanup();
    }
  });
});
