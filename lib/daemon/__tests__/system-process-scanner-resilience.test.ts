import { test, expect } from "bun:test";
import { SystemProcessScanner } from "../system-process-scanner.ts";

/** Drives gather()'s return value directly so a null (failed lsof/ps tick)
 *  can be simulated without shelling out. */
class FakeScanner extends SystemProcessScanner {
  next: any[] | null = [];
  protected override async gather(): Promise<any[] | null> {
    return this.next;
  }
}

function fakeProcess(pid: number, cpuPercent: number) {
  return {
    pid,
    ppid: 1,
    command: "node",
    fullCommand: "node build.js",
    cpuPercent,
    rssKb: 10_000,
    uptime: "01:00",
    cwd: "/repo",
    repo: "r",
    worktree: null,
    branch: null,
    relativeDir: "",
    port: null,
    linearTicket: null,
    packageScript: null,
  };
}

test("a failed gather (null) keeps tracked windows and lastResult intact", async () => {
  const s = new FakeScanner();

  s.next = [fakeProcess(4242, 95)];
  const first = await s.scan();
  expect(first.find((p) => p.pid === 4242)).toBeTruthy();
  const firstSeen = s.getTracked(4242)?.firstSeen;
  expect(firstSeen).toBeDefined();

  s.next = null;
  const during = await s.scan();
  expect(s.getTracked(4242)?.firstSeen).toBe(firstSeen);
  expect(during.find((p) => p.pid === 4242)).toBeTruthy();
});

// RT-128: with the tray polling faster than a gather finishes (a machine
// whose spawns are slow), each queued poll used to launch its own full
// fan-out (git worktree list per repo + lsof), feeding the very slowness
// that queued it. Concurrent refreshes must share ONE in-flight gather.
test("concurrent refresh calls share one in-flight gather", async () => {
  let gathers = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  class SlowScanner extends SystemProcessScanner {
    protected override async gather(): Promise<any[] | null> {
      gathers++;
      await gate;
      return [fakeProcess(4242, 10)];
    }
  }
  const s = new SlowScanner();

  const a = s.refresh();
  const b = s.refresh();
  release();
  const [ra, rb] = await Promise.all([a, b]);

  expect(gathers).toBe(1);
  expect(ra.find((p) => p.pid === 4242)).toBeTruthy();
  expect(rb.find((p) => p.pid === 4242)).toBeTruthy();
});
