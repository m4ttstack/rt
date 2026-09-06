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
    expect(tryAcquireMemoryLock(path)).toBe(true);
    releaseMemoryLock(path);
    expect(tryAcquireMemoryLock(path)).toBe(true);
    releaseMemoryLock(path);
  });

  test("a fresh lock held by another process is refused, not stolen", () => {
    const path = join(mkdtempSync(join(tmpdir(), "triage-mem-")), "auto-dispatch.json");
    expect(tryAcquireMemoryLock(path)).toBe(true);
    expect(tryAcquireMemoryLock(path)).toBe(false);
    releaseMemoryLock(path);
  });

  test("a stale lock (older than the reclaim window) is reclaimed", () => {
    const path = join(mkdtempSync(join(tmpdir(), "triage-mem-")), "auto-dispatch.json");
    expect(tryAcquireMemoryLock(path)).toBe(true);
    const staleTime = (Date.now() - 3 * 60_000) / 1000;
    utimesSync(`${path}.lock`, staleTime, staleTime);
    expect(tryAcquireMemoryLock(path)).toBe(true);
    releaseMemoryLock(path);
  });

  test("releasing an unheld lock is a no-op", () => {
    const path = join(mkdtempSync(join(tmpdir(), "triage-mem-")), "auto-dispatch.json");
    expect(() => releaseMemoryLock(path)).not.toThrow();
  });
});
