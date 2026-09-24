import { describe, test, expect } from "bun:test";
import { parkUntilServable, type ParkDeps } from "../park.ts";

function deps(overrides: Partial<ParkDeps> = {}): ParkDeps & { logs: string[]; sleeps: number[] } {
  const logs: string[] = [];
  const sleeps: number[] = [];
  return {
    myFlavor: "dev",
    probeHolder: async () => null,
    myLaunchdLabel: () => null,
    sleep: async (ms: number) => { sleeps.push(ms); },
    log: { info: (_o: unknown, m: string) => logs.push(`info:${m}`), warn: (_o: unknown, m: string) => logs.push(`warn:${m}`) },
    logs,
    sleeps,
    ...overrides,
  };
}

describe("parkUntilServable", () => {
  test("free socket returns immediately, no sleep", async () => {
    const d = deps();
    await parkUntilServable(d);
    expect(d.sleeps).toEqual([]);
  });

  test("a live other-flavor holder owns the socket: stands off until it drains", async () => {
    let probes = 0;
    const d = deps({
      probeHolder: async () => (++probes < 2 ? { flavor: "prod", pid: 999 } : null),
    });
    await parkUntilServable(d);
    expect(d.sleeps.length).toBe(1);
    expect(d.logs.some((l) => l.includes("standoff"))).toBe(true);
  });

  test("a same-flavor holder is the restart-orphan case: return and let eviction own it", async () => {
    const d = deps({ probeHolder: async () => ({ flavor: "dev", pid: 111 }) });
    await parkUntilServable(d);
    expect(d.sleeps).toEqual([]);
  });

  test("an unknown-flavor holder also returns immediately (pre-identity daemon, eviction's job)", async () => {
    const d = deps({ probeHolder: async () => ({ flavor: "unknown flavor", pid: 222 }) });
    await parkUntilServable(d);
    expect(d.sleeps).toEqual([]);
  });

  test("started by the other flavor's job: parks and never serves", async () => {
    let probes = 0;
    const d = deps({
      myFlavor: "dev",
      myLaunchdLabel: () => "com.mattstack.daemon",
      probeHolder: async () => { probes++; return null; },
      sleep: async (ms: number) => {
        d.sleeps.push(ms);
        if (d.sleeps.length >= 3) throw new Error("still parked");
      },
    });
    await expect(parkUntilServable(d)).rejects.toThrow("still parked");
    expect(probes).toBe(0);
    expect(d.logs.filter((l) => l.includes("parked")).length).toBe(1);
  });

  test("started by its own flavor's job returns immediately", async () => {
    const d = deps({ myFlavor: "prod", myLaunchdLabel: () => "com.mattstack.daemon" });
    await parkUntilServable(d);
    expect(d.sleeps).toEqual([]);
  });

  test("not launchd-launched (foreground run, e2e) is unaffected by the label gate", async () => {
    const d = deps({ myFlavor: "prod", myLaunchdLabel: () => null });
    await parkUntilServable(d);
    expect(d.sleeps).toEqual([]);
  });
});
