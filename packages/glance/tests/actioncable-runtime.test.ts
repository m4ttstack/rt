#!/usr/bin/env bun
/**
 * ActionCableClient on runtimes without a global WebSocket (MAT-156).
 *
 * Node had no default global WebSocket until 21, and the old behavior on such
 * a runtime was the worst shape available: connect() resolved normally, the
 * failure went to a default-noop logger, no callback fired, and the reconnect
 * loop burned its 8 attempts failing identically before going permanently
 * quiet. These tests pin the fixed contract: a missing global throws at the
 * connect() call site, and a constructor failure that might be transient is
 * reported through onDisconnected before the retry is scheduled.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { ActionCableClient, type ActionCableCallbacks } from "../src/ActionCableClient.ts";

const realWebSocket = globalThis.WebSocket;
const realSetTimeout = globalThis.setTimeout;
afterEach(() => {
  globalThis.WebSocket = realWebSocket;
  globalThis.setTimeout = realSetTimeout;
});

function recordingCallbacks(): { callbacks: ActionCableCallbacks; disconnects: Array<{ intentional: boolean; reason: string }> } {
  const disconnects: Array<{ intentional: boolean; reason: string }> = [];
  return {
    disconnects,
    callbacks: {
      onConnected: () => {},
      onDisconnected: (intentional, reason) => disconnects.push({ intentional, reason }),
      onMessage: () => {},
      onConfirm: () => {},
      onReject: () => {},
    },
  };
}

describe("ActionCableClient without a global WebSocket", () => {
  test("connect() throws synchronously instead of failing silently", () => {
    const { callbacks, disconnects } = recordingCallbacks();
    const client = new ActionCableClient("https://gitlab.example.com", "tok", callbacks);
    // @ts-expect-error deliberately simulating Node <21
    delete globalThis.WebSocket;

    expect(() => client.connect()).toThrow(/WebSocket|Node 21/);
    // An environment defect is the caller's to handle via the throw; the
    // callback channel stays quiet and no retry loop starts.
    expect(disconnects).toEqual([]);
  });

  test("the throw names the runtime requirement, not just the symptom", () => {
    const { callbacks } = recordingCallbacks();
    const client = new ActionCableClient("https://gitlab.example.com", "tok", callbacks);
    // @ts-expect-error deliberately simulating Node <21
    delete globalThis.WebSocket;

    expect(() => client.connect()).toThrow(/Node 21/);
  });

  test("a connect() rejected for a missing global does not wedge the client", () => {
    const { callbacks } = recordingCallbacks();
    const client = new ActionCableClient("https://gitlab.example.com", "tok", callbacks);
    // @ts-expect-error deliberately simulating Node <21
    delete globalThis.WebSocket;
    expect(() => client.connect()).toThrow();

    globalThis.WebSocket = realWebSocket;
    const scheduled: number[] = [];
    // Swallow the real connection attempt: an unroutable ws:// URL here would
    // hit the network. A constructor stub keeps the test hermetic and proves
    // connect() gets past the guard once the global exists again.
    globalThis.WebSocket = class {
      onmessage: unknown = null;
      onclose: unknown = null;
      onerror: unknown = null;
      close() {}
    } as unknown as typeof WebSocket;
    expect(() => client.connect()).not.toThrow();
    client.disconnect();
    expect(scheduled).toEqual([]);
  });
});

describe("ActionCableClient when the WebSocket constructor throws", () => {
  test("reports through onDisconnected before scheduling the retry", () => {
    const { callbacks, disconnects } = recordingCallbacks();
    const client = new ActionCableClient("https://gitlab.example.com", "tok", callbacks);
    globalThis.WebSocket = class {
      constructor() {
        throw new Error("boom from constructor");
      }
    } as unknown as typeof WebSocket;

    const delays: number[] = [];
    globalThis.setTimeout = ((fn: () => void, ms?: number) => {
      delays.push(ms ?? 0);
      return realSetTimeout(() => {}, 0);
    }) as typeof setTimeout;

    expect(() => client.connect()).not.toThrow();
    expect(disconnects).toEqual([
      { intentional: false, reason: "boom from constructor" },
    ]);
    // Still retried: a constructor failure other than the missing global may
    // be transient, so the backoff loop stays. First attempt waits at least
    // the 1s base delay.
    expect(delays.length).toBe(1);
    expect(delays[0]!).toBeGreaterThanOrEqual(1_000);
    client.disconnect();
  });
});
