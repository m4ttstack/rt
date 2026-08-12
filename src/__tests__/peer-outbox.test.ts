import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { classifySend, drainOutbox, enqueueOutbox, readOutbox } from "../peer/outbox.ts";
import { makeSwitchboardClient } from "../peer/client.ts";
import type { DraftEnvelope } from "../peer/envelope.ts";

let dir: string | undefined;
function freshDir(): string {
  dir = mkdtempSync(join(tmpdir(), "outbox-"));
  return dir;
}
// Only classifySend's tests skip freshDir(), so guard against the unset case
// rather than calling rmSync on an undefined path.
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const d = (id: string): DraftEnvelope => ({ id, to: "grace", type: "review-state", sentAt: 1, payload: {} });

describe("classifySend", () => {
  test("2xx sent, 4xx drop, 5xx and network retry", () => {
    expect(classifySend(201)).toBe("sent");
    expect(classifySend(422)).toBe("drop");
    expect(classifySend(401)).toBe("drop");
    expect(classifySend(503)).toBe("retry");
    expect(classifySend("network")).toBe("retry");
  });
});

describe("outbox", () => {
  test("enqueue then read round-trips; enqueue is idempotent per id", () => {
    const dir = freshDir();
    enqueueOutbox(d("e1"), dir, 5);
    enqueueOutbox(d("e1"), dir, 9);
    const entries = readOutbox(dir);
    expect(entries.length).toBe(1);
    expect(entries[0]!.queuedAt).toBe(5);
  });
  test("drain sends, drops 4xx, keeps retryables with attempts bumped", async () => {
    const dir = freshDir();
    enqueueOutbox(d("ok"), dir, 1);
    enqueueOutbox(d("gone"), dir, 1);
    enqueueOutbox(d("later"), dir, 1);
    const statuses: Record<string, number | "network"> = { ok: 201, gone: 422, later: "network" };
    const result = await drainOutbox(async (env) => statuses[env.id]!, dir);
    expect(result).toEqual({ sent: 1, dropped: 1, kept: 1 });
    const remaining = readOutbox(dir);
    expect(remaining.map((e) => e.envelope.id)).toEqual(["later"]);
    expect(remaining[0]!.attempts).toBe(1);
  });
});

describe("makeSwitchboardClient", () => {
  test("publish posts the draft with bearer auth and returns the status", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init! });
      return new Response(JSON.stringify({ ok: true, delivered: 1 }), { status: 201 });
    }) as typeof fetch;
    const client = makeSwitchboardClient("https://sb.test", "tok", fetchFn);
    expect(await client.publish(d("e1"))).toBe(201);
    expect(calls[0]!.url).toBe("https://sb.test/envelopes");
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer tok");
  });
  test("publish returns 'network' on a thrown fetch", async () => {
    const fetchFn = (async () => { throw new Error("down"); }) as typeof fetch;
    const client = makeSwitchboardClient("https://sb.test", "tok", fetchFn);
    expect(await client.publish(d("e1"))).toBe("network");
  });
  test("inbox parses envelopes and returns null on failure", async () => {
    const env = { id: "e", from: "ada", to: "grace", type: "t", sentAt: 1, receivedAt: 2, payload: {} };
    const good = (async () => new Response(JSON.stringify({ envelopes: [env, { junk: true }] }), { status: 200 })) as typeof fetch;
    const envelopes = await makeSwitchboardClient("https://sb.test", "t", good).inbox();
    expect(Array.isArray(envelopes) ? envelopes.map((e) => e.id) : envelopes).toEqual(["e"]);
    const bad = (async () => new Response("nope", { status: 500 })) as typeof fetch;
    expect(await makeSwitchboardClient("https://sb.test", "t", bad).inbox()).toBeNull();
  });
  test("inbox distinguishes a 401 from any other relay failure", async () => {
    const denied = (async () => new Response("nope", { status: 401 })) as typeof fetch;
    expect(await makeSwitchboardClient("https://sb.test", "t", denied).inbox()).toBe("unauthorized");
  });
});
