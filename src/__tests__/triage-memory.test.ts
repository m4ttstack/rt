import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { emptyMrMemory, readMemory, rollDay, writeMemory, type DispatchMemory } from "../triage/memory.ts";

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
