import { afterEach, describe, expect, test } from "bun:test";
import { reposStatus } from "../../commands/repos.ts";

const logs: string[] = [];
const origLog = console.log;
const origErr = console.error;
const origExit = process.exit;

function capture() {
  logs.length = 0;
  console.log = (line: string) => { logs.push(String(line)); };
  console.error = (line: string) => { logs.push(`ERR:${String(line)}`); };
  (process as any).exit = (code: number) => { throw new Error(`exit ${code}`); };
}

afterEach(() => {
  console.log = origLog;
  console.error = origErr;
  (process as any).exit = origExit;
});

const row = {
  repo: "remote:github.com%2Fm4ttstack%2Frt",
  worktrees: [{
    worktree: "/Users/x/rt", branch: "main", detached: false,
    staged: 0, unstaged: 3, untracked: 1, conflicted: 0, clean: false,
    ahead: 1, behind: 0, upstream: "origin/main",
    lastFetchedAt: "2026-09-17T00:00:00.000Z", updatedAt: "2026-09-17T00:01:00.000Z",
  }],
  error: null,
};

describe("rt repos status", () => {
  test("--json prints the daemon data verbatim in the plain envelope", async () => {
    capture();
    await reposStatus(["--json"], {
      query: async () => ({ ok: true, data: { repos: [row], sweptAt: "2026-09-17T00:01:00.000Z" } }) as any,
    });
    expect(JSON.parse(logs[0]!)).toEqual({ ok: true, repos: [row], sweptAt: "2026-09-17T00:01:00.000Z" });
  });

  test("--refresh forwards refresh: true with a generous timeout", async () => {
    capture();
    let sent: any = null;
    let timeout: any = null;
    await reposStatus(["--json", "--refresh"], {
      query: async (_cmd, payload, timeoutMs) => {
        sent = payload;
        timeout = timeoutMs;
        return { ok: true, data: { repos: [], sweptAt: null } } as any;
      },
    });
    expect(sent).toEqual({ refresh: true });
    expect(timeout).toBe(120_000);
  });

  test("daemon down fails with the plain JSON error and exit 1", async () => {
    capture();
    await expect(reposStatus(["--json"], { query: async () => null })).rejects.toThrow("exit 1");
    expect(JSON.parse(logs[0]!)).toEqual({
      ok: false,
      error: "daemon unavailable, the rt daemon must be running for repo status",
    });
  });
});
