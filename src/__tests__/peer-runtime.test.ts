import { describe, expect, test } from "bun:test";
import { makePeering } from "../peer/runtime.ts";
import type { SwitchboardClient } from "../peer/client.ts";

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
    const peering = makePeering({ makeClient: () => (made++, fakeClient(() => [])), deps: noDeps, tickMs: 999_999 });
    peering.start("https://sb", "tok1");
    peering.start("https://sb", "tok2");
    expect(made).toBe(2);
    expect(peering.current()).not.toBeNull();
    peering.stop();
    expect(peering.current()).not.toBeNull(); // stop kills the timer, not the handle
  });

  test("three consecutive unauthorized ticks flip health; one ok clears it", async () => {
    let result: Awaited<ReturnType<SwitchboardClient["inbox"]>> = "unauthorized";
    const peering = makePeering({ makeClient: () => fakeClient(() => result), deps: noDeps, tickMs: 999_999 });
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
