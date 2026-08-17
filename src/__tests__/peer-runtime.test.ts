import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { makePeering } from "../peer/runtime.ts";
import type { SwitchboardClient } from "../peer/client.ts";

/** Every peering built here pins its own outbox. Without this the runtime
    falls back to the shared OUTBOX_DIR and a test run would publish and delete
    whatever a real board had queued -- including from start()'s unawaited boot
    tick, which can land after the test that spawned it has finished. */
let dir: string | undefined;
function freshDir(): string {
  dir = mkdtempSync(join(tmpdir(), "peer-runtime-"));
  return dir;
}
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

function fakeClient(inboxResult: () => Awaited<ReturnType<SwitchboardClient["inbox"]>>): SwitchboardClient {
  return {
    publish: async () => 201,
    inbox: async () => inboxResult(),
    ack: async () => true,
  };
}
const noDeps = {
  writePeerReview: () => {}, writeNudge: () => {}, resolveSentNudge: () => {}, retireSentNudge: () => {}, log: () => {},
};

describe("makePeering", () => {
  test("start is idempotent: a second start replaces, never stacks intervals", () => {
    let made = 0;
    const peering = makePeering({ makeClient: () => (made++, fakeClient(() => [])), deps: noDeps, tickMs: 999_999, outboxDir: freshDir() });
    peering.start("https://sb", "tok1");
    peering.start("https://sb", "tok2");
    expect(made).toBe(2);
    expect(peering.current()).not.toBeNull();
    peering.stop();
    expect(peering.current()).not.toBeNull(); // stop kills the timer, not the handle
  });

  test("overlapping ticks coalesce: never two in flight at once", async () => {
    let inFlight = 0;
    let peak = 0;
    const blocked: Array<() => void> = [];
    const client: SwitchboardClient = {
      publish: async () => 201,
      ack: async () => true,
      inbox: async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise<void>((resolve) => blocked.push(resolve));
        inFlight--;
        return [];
      },
    };
    const peering = makePeering({ makeClient: () => client, deps: noDeps, tickMs: 999_999, outboxDir: freshDir() });
    peering.start("https://sb", "tok");   // start's own boot tick blocks in inbox
    await Promise.resolve();
    const a = peering.tickNow();
    const b = peering.tickNow();
    // Release whatever is blocked, repeatedly: a coalesced follow-up tick
    // blocks again, so both callers only settle after a few rounds.
    let settled = false;
    void Promise.all([a, b]).then(() => { settled = true; });
    for (let i = 0; i < 20 && !settled; i++) {
      for (const resolve of blocked.splice(0)) resolve();
      await new Promise((r) => setTimeout(r, 0));
    }
    await Promise.all([a, b]);
    expect(peak).toBe(1);
    peering.stop();
  });

  test("three consecutive unauthorized ticks flip health; one ok clears it", async () => {
    let result: Awaited<ReturnType<SwitchboardClient["inbox"]>> = "unauthorized";
    const peering = makePeering({ makeClient: () => fakeClient(() => result), deps: noDeps, tickMs: 999_999, outboxDir: freshDir() });
    const rt = peering.start("https://sb", "tok");
    // Drive ticks manually via the exported tick hook rather than timers:
    for (let i = 0; i < 3; i++) await peering.tickNow();
    expect(rt.health()).toBe("unauthorized");
    result = [];
    await peering.tickNow();
    expect(rt.health()).toBe("ok");
    peering.stop();
  });
});
