/**
 * RT-166: characterizes the traced mechanism behind RT-162 finding 4
 * (does a worker-opened gate raise a desktop notification to the human?)
 * against TODAY's code. These pin the mechanism, not a fix; they must PASS
 * before and after any Task 2 change (Task 2 adds a THIRD case here for the
 * new skip, it does not flip these two).
 */
import { describe, expect, test } from "bun:test";
import { deriveOwner } from "../handlers/gate.ts";
import { parseEventBridgeRules, startNotifyBridge } from "../../notify-bridge.ts";
import type { NotificationEvent } from "../../state/notifier-store.ts";

function fakeBus(): {
  onBroadcast(fn: (type: string, data: unknown) => void): () => void;
  emit(type: string, data: unknown): Promise<void>;
} {
  const subs = new Set<(type: string, data: unknown) => void>();
  return {
    onBroadcast(fn) {
      subs.add(fn);
      return () => { subs.delete(fn); };
    },
    async emit(type, data) {
      for (const fn of [...subs]) fn(type, data);
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
    },
  };
}

describe("RT-162 finding 4 mechanism", () => {
  test("a hook-shaped gate:open on a herd subject derives owner human today", () => {
    // The hook's message spells `rt gate open --subject herd:.../job` with
    // no origin, so deriveOwner sees no runId and falls back to human.
    expect(deriveOwner(undefined, () => null)).toBe("human");
    expect(deriveOwner({ presentation: "wait" }, () => "herd:h1")).toBe("human");
  });

  test("an owner:human bridge rule delivers a human-owned gate and skips a herd-owned one, blind to subject", async () => {
    const rules = parseEventBridgeRules(
      [{ pattern: "gate/opened/*", category: "gate", title: "t", message: "m", owner: "human" }],
      () => {},
    );
    const bus = fakeBus();
    const delivered: NotificationEvent[] = [];

    startNotifyBridge({
      onBroadcast: bus.onBroadcast,
      rules: () => rules,
      enqueue: (e) => { delivered.push(e); },
      paneFocused: async () => false,
    });

    // A worker's hook-followed gate:open on its herd subject: derived owner
    // "human" (per the test above), subject is the herd job's own subject.
    await bus.emit("event", {
      id: "1",
      topic: "gate/opened/g1",
      payload: { owner: "human", subject: "herd:h1/job" },
      emittedAt: 1,
    });
    await bus.emit("event", {
      id: "2",
      topic: "gate/opened/g2",
      payload: { owner: "herd:h1", subject: "herd:h1/job" },
      emittedAt: 2,
    });

    expect(delivered.map((e) => e.id)).toEqual(["1"]);
  });
});
