import { describe, expect, test } from "bun:test";
import { closeOnDone } from "../close-on-done.ts";
import type { AgentSignal } from "../agent-signal.ts";

function signal(status: string, overrides: Partial<AgentSignal> = {}): AgentSignal {
  return { mrUrl: "https://gitlab.example.com/group/project/-/merge_requests/1", iid: 1, kind: "review", status, ...overrides };
}

describe("closeOnDone", () => {
  test("done with a tabId on file closes that tab", async () => {
    const closed: string[] = [];
    await closeOnDone(signal("done"), () => "tab-1", async (tabId) => {
      closed.push(tabId);
    });
    expect(closed).toEqual(["tab-1"]);
  });

  test("done with no tabId on file is a no-op", async () => {
    const closed: string[] = [];
    await closeOnDone(signal("done"), () => undefined, async (tabId) => {
      closed.push(tabId);
    });
    expect(closed).toEqual([]);
  });

  test("error status never closes, even with a tabId on file", async () => {
    const closed: string[] = [];
    await closeOnDone(signal("error"), () => "tab-1", async (tabId) => {
      closed.push(tabId);
    });
    expect(closed).toEqual([]);
  });

  test("a throw from close is swallowed", async () => {
    await expect(
      closeOnDone(signal("done"), () => "tab-1", async () => {
        throw new Error("herdr tab close failed");
      }),
    ).resolves.toBeUndefined();
  });

  test("any other in-flight status never closes", async () => {
    const closed: string[] = [];
    await closeOnDone(signal("reviewing"), () => "tab-1", async (tabId) => {
      closed.push(tabId);
    });
    expect(closed).toEqual([]);
  });
});
