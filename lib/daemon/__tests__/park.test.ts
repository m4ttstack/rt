import { describe, test, expect } from "bun:test";
import { parkUntilIntended, type ParkDeps } from "../park.ts";

function deps(overrides: Partial<ParkDeps> = {}): ParkDeps & { logs: string[]; sleeps: number[] } {
  const logs: string[] = [];
  const sleeps: number[] = [];
  return {
    myFlavor: "dev",
    resolveIntent: () => ({ mode: "dev", provenance: "setting" as const }),
    probeHolder: async () => null,
    myLaunchdLabel: () => null,
    activeLaunchdLabel: () => "com.mattstack.daemon.dev",
    sleep: async (ms: number) => { sleeps.push(ms); },
    log: { info: (_o: unknown, m: string) => logs.push(`info:${m}`), warn: (_o: unknown, m: string) => logs.push(`warn:${m}`) },
    logs,
    sleeps,
    ...overrides,
  };
}

describe("parkUntilIntended", () => {
  test("matched flavor with free socket returns immediately, no sleep", async () => {
    const d = deps();
    await parkUntilIntended(d);
    expect(d.sleeps).toEqual([]);
  });

  test("mismatched flavor parks until the setting flips, then returns", async () => {
    let reads = 0;
    const d = deps({
      resolveIntent: () => (++reads < 3 ? { mode: "prod", provenance: "setting" } : { mode: "dev", provenance: "setting" }),
    });
    await parkUntilIntended(d);
    expect(d.sleeps.length).toBe(2);
    expect(d.logs.some((l) => l.includes("parked"))).toBe(true);
  });

  test("matched but a live wrong-flavor holder owns the socket: stands off until it drains", async () => {
    let probes = 0;
    const d = deps({
      probeHolder: async () => (++probes < 2 ? { flavor: "prod", pid: 999 } : null),
    });
    await parkUntilIntended(d);
    expect(d.sleeps.length).toBe(1);
    expect(d.logs.some((l) => l.includes("standoff"))).toBe(true);
  });

  test("a resolver that throws keeps the previous decision and logs warn, never crashes", async () => {
    let reads = 0;
    const d = deps({
      resolveIntent: () => {
        reads++;
        if (reads === 2) throw new Error("store hiccup");
        return reads < 4 ? { mode: "prod", provenance: "setting" } : { mode: "dev", provenance: "setting" };
      },
    });
    await parkUntilIntended(d);
    // prod -> throw(keeps prod) -> prod -> dev: 3 mismatched passes before the
    // match. A reset-to-match bug on the thrown read would end early at 1 sleep.
    expect(d.sleeps.length).toBe(3);
    expect(d.logs.some((l) => l.startsWith("warn:"))).toBe(true);
  });

  test("a same-flavor holder is the restart-orphan case: return and let eviction own it", async () => {
    const d = deps({ probeHolder: async () => ({ flavor: "dev", pid: 111 }) });
    await parkUntilIntended(d);
    expect(d.sleeps).toEqual([]);
  });

  test("an unknown-flavor holder also returns immediately (pre-identity daemon, eviction's job)", async () => {
    const d = deps({ probeHolder: async () => ({ flavor: "unknown flavor", pid: 222 }) });
    await parkUntilIntended(d);
    expect(d.sleeps).toEqual([]);
  });

  // In dev mode the app bundle's rt hands off to the dev source, so BOTH
  // launchd jobs exec a dev-flavored daemon: daemonFlavor() reads "dev" on
  // each, intent matches on each, and nothing below the gate stops them from
  // SIGTERMing each other through the shared rt.pid forever (137 daemon
  // instances in one day). The launching job's label is the only signal that
  // separates them.
  test("launched by the inactive flavor's job: parks even though the build flavor matches intent", async () => {
    let reads = 0;
    const d = deps({
      myLaunchdLabel: () => "com.mattstack.daemon",
      activeLaunchdLabel: () =>
        ++reads < 2 ? "com.mattstack.daemon.dev" : "com.mattstack.daemon",
    });
    await parkUntilIntended(d);
    expect(d.sleeps.length).toBe(1);
    expect(d.logs.some((l) => l.includes("wrong launchd job"))).toBe(true);
  });

  test("launched by the active flavor's job returns immediately", async () => {
    const d = deps({
      myLaunchdLabel: () => "com.mattstack.daemon.dev",
      activeLaunchdLabel: () => "com.mattstack.daemon.dev",
    });
    await parkUntilIntended(d);
    expect(d.sleeps).toEqual([]);
  });

  test("not launchd-launched (foreground run, e2e) is unaffected by the label gate", async () => {
    const d = deps({
      myLaunchdLabel: () => null,
      activeLaunchdLabel: () => "com.mattstack.daemon.dev",
    });
    await parkUntilIntended(d);
    expect(d.sleeps).toEqual([]);
  });

  test("a label park ends the moment the mode flips to name this job active", async () => {
    let reads = 0;
    const d = deps({
      myLaunchdLabel: () => "com.mattstack.daemon",
      activeLaunchdLabel: () =>
        ++reads < 3 ? "com.mattstack.daemon.dev" : "com.mattstack.daemon",
    });
    await parkUntilIntended(d);
    expect(d.sleeps.length).toBe(2);
  });
});
