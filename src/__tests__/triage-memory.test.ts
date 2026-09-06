import { describe, expect, test } from "bun:test";
import { mkdtempSync, utimesSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  emptyMrMemory,
  readMemory,
  releaseMemoryLock,
  rollDay,
  tryAcquireMemoryLock,
  writeMemory,
  writeRefreshedIdentity,
  type DispatchMemory,
} from "../triage/memory.ts";

describe("dispatch memory", () => {
  test("read of a missing file yields an empty memory", () => {
    const path = join(mkdtempSync(join(tmpdir(), "triage-mem-")), "auto-dispatch.json");
    expect(readMemory(path)).toEqual({ identity: null, mrs: {} });
  });

  test("write/read round-trips", () => {
    const path = join(mkdtempSync(join(tmpdir(), "triage-mem-")), "auto-dispatch.json");
    const mem: DispatchMemory = {
      identity: { username: "matt", fetchedAt: 111 },
      mrs: { "https://x/mr/1": { ...emptyMrMemory("2026-08-08"), attemptsToday: 2 } },
    };
    writeMemory(mem, path);
    expect(readMemory(path)).toEqual(mem);
  });

  test("rollDay resets the daily counters on a new day and keeps edge memory", () => {
    const m = { ...emptyMrMemory("2026-08-08"), attemptsToday: 3, budgetEscalatedDay: "2026-08-08", lastHandledPipelineId: 42 };
    const rolled = rollDay(m, "2026-08-09");
    expect(rolled.attemptsToday).toBe(0);
    expect(rolled.budgetEscalatedDay).toBeNull();
    expect(rolled.dayStamp).toBe("2026-08-09");
    expect(rolled.lastHandledPipelineId).toBe(42);
    expect(rollDay(m, "2026-08-08")).toEqual(m); // same day: unchanged
  });
});

describe("memory lock", () => {
  test("acquire/release round-trips: a released lock can be re-acquired", () => {
    const path = join(mkdtempSync(join(tmpdir(), "triage-mem-")), "auto-dispatch.json");
    const token = tryAcquireMemoryLock(path);
    expect(typeof token).toBe("string");
    releaseMemoryLock(token as string, path);
    const token2 = tryAcquireMemoryLock(path);
    expect(typeof token2).toBe("string");
    releaseMemoryLock(token2 as string, path);
  });

  test("a fresh lock held by another process is refused, not stolen", () => {
    const path = join(mkdtempSync(join(tmpdir(), "triage-mem-")), "auto-dispatch.json");
    const token = tryAcquireMemoryLock(path);
    expect(tryAcquireMemoryLock(path)).toBe(false);
    releaseMemoryLock(token as string, path);
  });

  test("a stale lock (older than the reclaim window) is reclaimed", () => {
    const path = join(mkdtempSync(join(tmpdir(), "triage-mem-")), "auto-dispatch.json");
    tryAcquireMemoryLock(path);
    const staleTime = (Date.now() - 3 * 60_000) / 1000;
    utimesSync(`${path}.lock`, staleTime, staleTime);
    const token2 = tryAcquireMemoryLock(path);
    expect(typeof token2).toBe("string");
    releaseMemoryLock(token2 as string, path);
  });

  test("releasing an unheld lock is a no-op", () => {
    const path = join(mkdtempSync(join(tmpdir(), "triage-mem-")), "auto-dispatch.json");
    expect(() => releaseMemoryLock("whatever-token", path)).not.toThrow();
  });

  test("exactly one of two contenders acquires the lock, and a non-owner release is a no-op", () => {
    const path = join(mkdtempSync(join(tmpdir(), "triage-mem-")), "auto-dispatch.json");
    const tokenA = tryAcquireMemoryLock(path);
    const tokenB = tryAcquireMemoryLock(path);
    expect(typeof tokenA).toBe("string");
    expect(tokenB).toBe(false);

    // B never held the lock; releasing with a foreign token must not
    // clobber A's still-live lock (a stale-reclaimed lock must not be
    // clobbered by the previous owner's late release, same hazard).
    releaseMemoryLock("a-token-nobody-was-issued", path);
    expect(tryAcquireMemoryLock(path)).toBe(false); // A's lock still stands

    releaseMemoryLock(tokenA as string, path);
    const tokenC = tryAcquireMemoryLock(path); // now released, re-acquirable
    expect(typeof tokenC).toBe("string");
    releaseMemoryLock(tokenC as string, path);
  });
});

describe("writeRefreshedIdentity", () => {
  test("merges only identity onto the CURRENT file, never a stale earlier read", () => {
    const path = join(mkdtempSync(join(tmpdir(), "triage-mem-")), "auto-dispatch.json");
    writeMemory(
      { identity: { username: "old", fetchedAt: 1 }, mrs: { "https://x/mr/1": { ...emptyMrMemory("2026-08-08"), attemptsToday: 2 } } },
      path,
    );
    // Simulate the auto pass writing OTHER fields during this caller's own
    // (already-completed) network round-trip, between its stale read and
    // this write-back.
    const concurrent = readMemory(path);
    concurrent.mrs["https://x/mr/1"]!.attemptsToday = 5;
    writeMemory(concurrent, path);

    writeRefreshedIdentity({ username: "fresh", fetchedAt: 2 }, path);

    const final = readMemory(path);
    expect(final.identity).toEqual({ username: "fresh", fetchedAt: 2 });
    expect(final.mrs["https://x/mr/1"]!.attemptsToday).toBe(5); // not clobbered
  });
});
