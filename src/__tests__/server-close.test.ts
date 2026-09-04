import { describe, expect, test } from "bun:test";
import { closeOnDone } from "../close-on-done.ts";
import type { AgentSignal } from "../agent-signal.ts";

function signal(status: string, overrides: Partial<AgentSignal> = {}): AgentSignal {
  return { mrUrl: "https://gitlab.example.com/group/project/-/merge_requests/1", iid: 1, kind: "review", status, ...overrides };
}

describe("closeOnDone", () => {
  test("done with a tabId on file closes that tab and clears it", async () => {
    const closed: string[] = [];
    const cleared: AgentSignal[] = [];
    await closeOnDone(
      signal("done"),
      () => "tab-1",
      async (tabId) => {
        closed.push(tabId);
      },
      (s) => cleared.push(s),
    );
    expect(closed).toEqual(["tab-1"]);
    expect(cleared).toHaveLength(1);
  });

  test("done with no tabId on file is a no-op -- close and clear both skipped", async () => {
    const closed: string[] = [];
    const cleared: AgentSignal[] = [];
    await closeOnDone(
      signal("done"),
      () => undefined,
      async (tabId) => {
        closed.push(tabId);
      },
      (s) => cleared.push(s),
    );
    expect(closed).toEqual([]);
    expect(cleared).toEqual([]);
  });

  test("error status never closes or clears, even with a tabId on file", async () => {
    const closed: string[] = [];
    const cleared: AgentSignal[] = [];
    await closeOnDone(
      signal("error"),
      () => "tab-1",
      async (tabId) => {
        closed.push(tabId);
      },
      (s) => cleared.push(s),
    );
    expect(closed).toEqual([]);
    expect(cleared).toEqual([]);
  });

  test("a throw from close is swallowed, and the tabId is still cleared -- a close failure usually means the tab is already gone", async () => {
    const cleared: AgentSignal[] = [];
    await expect(
      closeOnDone(
        signal("done"),
        () => "tab-1",
        async () => {
          throw new Error("herdr tab close failed");
        },
        (s) => cleared.push(s),
      ),
    ).resolves.toBeUndefined();
    expect(cleared).toHaveLength(1);
  });

  test("any other in-flight status never closes or clears", async () => {
    const closed: string[] = [];
    const cleared: AgentSignal[] = [];
    await closeOnDone(
      signal("reviewing"),
      () => "tab-1",
      async (tabId) => {
        closed.push(tabId);
      },
      (s) => cleared.push(s),
    );
    expect(closed).toEqual([]);
    expect(cleared).toEqual([]);
  });
});
