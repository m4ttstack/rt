// src/edge/rt-secrets.test.ts
import { test, expect } from "bun:test";
import { readDeckSecrets } from "./rt-secrets.ts";

test("success: returns the two creds the daemon hands back, scoped to deck", async () => {
  let sent: unknown;
  const result = await readDeckSecrets({
    readApiToken: () => "tok-123",
    post: async (payload) => {
      sent = payload;
      return { ok: true, data: { cfApiToken: "cf-tok", cfZoneId: "z1" } };
    },
  });
  expect(sent).toEqual({ token: "tok-123", scope: "deck" });
  expect(result).toEqual({ ok: true, cfApiToken: "cf-tok", cfZoneId: "z1" });
});

test("ok:true with no matching keys degrades to undefined creds, not an error", async () => {
  const result = await readDeckSecrets({
    readApiToken: () => "tok-123",
    post: async () => ({ ok: true, data: {} }),
  });
  expect(result).toEqual({ ok: true, cfApiToken: undefined, cfZoneId: undefined });
});

test("a missing api-token file is the daemon-unreachable case, directed at rt daemon start", async () => {
  const result = await readDeckSecrets({
    readApiToken: () => {
      throw new Error("ENOENT: no such file");
    },
    post: async () => {
      throw new Error("must not be called: no token to send");
    },
  });
  expect(result.ok).toBe(false);
  expect((result as { message: string }).message).toContain("rt daemon start");
});

test("a transport failure (daemon not listening) is directed at rt daemon start", async () => {
  const result = await readDeckSecrets({
    readApiToken: () => "tok-123",
    post: async () => {
      throw new Error("connect ENOENT ~/.mattstack/rt/rt.sock");
    },
  });
  expect(result.ok).toBe(false);
  expect((result as { message: string }).message).toContain("rt daemon start");
});

test("a bad-token refusal is a gate problem, distinct from unreachable", async () => {
  const result = await readDeckSecrets({
    readApiToken: () => "stale-tok",
    post: async () => ({ ok: false, error: "bad-token" }),
  });
  expect(result.ok).toBe(false);
  const message = (result as { message: string }).message;
  expect(message).toContain("bad-token");
  expect(message).not.toContain("rt daemon start");
});

test("a bad-scope refusal is a gate problem, distinct from unreachable", async () => {
  const result = await readDeckSecrets({
    readApiToken: () => "tok-123",
    post: async () => ({ ok: false, error: "bad-scope" }),
  });
  expect(result.ok).toBe(false);
  const message = (result as { message: string }).message;
  expect(message).toContain("bad-scope");
  expect(message).not.toContain("rt daemon start");
});

test("a missing-token refusal from the daemon is a gate problem too", async () => {
  const result = await readDeckSecrets({
    readApiToken: () => "",
    post: async () => ({ ok: false, error: "missing-token" }),
  });
  expect(result.ok).toBe(false);
  expect((result as { message: string }).message).toContain("missing-token");
});
