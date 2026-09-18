import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    await new Promise((r) => setTimeout(r, 10));
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

async function waitUntilExited(pid: number, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isRunning(pid)) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`pid ${pid} still running after ${timeoutMs}ms`);
}

describe("rawGit abort", () => {
  // A FIFO with no writer blocks a reader's open() call indefinitely by
  // construction (POSIX open-open rendezvous), so this hangs the same way
  // on every machine -- no network, no timing, no fixture size to tune.
  test("aborting mid-run rejects promptly and leaves no lingering child", async () => {
    const sb = await makeSandbox();
    const fifoDir = await mkdtemp(join(tmpdir(), "git-core-fifo-"));
    const fifoPath = join(fifoDir, "input");
    const controller = new AbortController();
    let childPid: number | undefined;
    try {
      Bun.spawnSync(["mkfifo", fifoPath]);
      // `git apply <file>` opens the file argument directly; with no writer
      // on the other end of the fifo, that open() never returns on its own.
      const promise = rawGit(sb.dir, ["apply", fifoPath], { signal: controller.signal });
      childPid = await findChildPid(/git apply/);
      expect(isRunning(childPid)).toBe(true);

      const start = Date.now();
      controller.abort();
      await expect(promise).rejects.toThrow();
      expect(Date.now() - start).toBeLessThan(500);

      await waitUntilExited(childPid);
    } finally {
      // Unconditional: a failure anywhere above (findChildPid timing out,
      // an assertion throwing) must not leave the child parked in open()
      // forever once the fifo's directory is removed out from under it.
      controller.abort();
      if (childPid !== undefined) {
        try {
          process.kill(childPid, "SIGKILL");
        } catch {
          // Already exited.
        }
      }
      await sb.cleanup();
      await rm(fifoDir, { recursive: true, force: true });
    }
  }, 8000);

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
