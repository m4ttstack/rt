// src/edge/rt-secrets.test.ts
import { test, expect } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
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

test("a missing-token refusal from the daemon is a gate problem too", async () => {
  const result = await readDeckSecrets({
    readApiToken: () => "",
    post: async () => ({ ok: false, error: "missing-token" }),
  });
  expect(result.ok).toBe(false);
  expect((result as { message: string }).message).toContain("missing-token");
});

test("a bad-scope refusal names an outdated rt daemon, never the api-token or unreachable advice", async () => {
  const result = await readDeckSecrets({
    readApiToken: () => "tok-123",
    post: async () => ({ ok: false, error: "bad-scope" }),
  });
  expect(result.ok).toBe(false);
  const message = (result as { message: string }).message;
  expect(message).toContain("update rt and restart the daemon");
  expect(message).not.toContain("rt daemon start");
  expect(message).not.toContain("api-token");
});

test("an ok:true response carrying only extension keys (no cf keys) is the old-daemon signature, not not-configured", async () => {
  const result = await readDeckSecrets({
    readApiToken: () => "tok-123",
    post: async () => ({ ok: true, data: { linearApiKey: "li-key" } }),
  });
  expect(result.ok).toBe(false);
  expect((result as { message: string }).message).toContain("update rt and restart the daemon");
});

test("an ok:true response carrying only gitlabToken is also the old-daemon signature", async () => {
  const result = await readDeckSecrets({
    readApiToken: () => "tok-123",
    post: async () => ({ ok: true, data: { gitlabToken: "gl-tok" } }),
  });
  expect(result.ok).toBe(false);
  expect((result as { message: string }).message).toContain("update rt and restart the daemon");
});

test("an ok:true response carrying a real cf key wins over the old-daemon heuristic, even alongside an extension key", async () => {
  const result = await readDeckSecrets({
    readApiToken: () => "tok-123",
    post: async () => ({ ok: true, data: { cfApiToken: "cf-tok", linearApiKey: "li-key" } }),
  });
  expect(result).toEqual({ ok: true, cfApiToken: "cf-tok", cfZoneId: undefined });
});

test("the unreachable message carries the underlying cause, not the token", async () => {
  const result = await readDeckSecrets({
    readApiToken: () => "should-never-appear-in-message",
    post: async () => {
      throw new Error("connect ECONNREFUSED /tmp/fake.sock");
    },
  });
  expect(result.ok).toBe(false);
  const message = (result as { message: string }).message;
  expect(message).toContain("ECONNREFUSED");
  expect(message).not.toContain("should-never-appear-in-message");
});

test("a daemon-side non-gate refusal (e.g. an internal error) surfaces its own string, not the api-token advice", async () => {
  const result = await readDeckSecrets({
    readApiToken: () => "tok-123",
    post: async () => ({ ok: false, error: "internal-error: secrets store corrupted" }),
  });
  expect(result.ok).toBe(false);
  const message = (result as { message: string }).message;
  expect(message).toContain("internal-error: secrets store corrupted");
  expect(message).not.toContain("api-token");
});

// The pinning test for the critical bug: rt-secrets.ts used to resolve
// API_TOKEN_PATH/SOCK_PATH via bare `homedir()` at module load, which Bun
// caches per process -- a test's HOME fake never moved them, so the
// UN-INJECTED default path authenticated against the real daemon with the
// real api-token. Faked HOME + no injected deps must resolve paths fresh
// at call time and land on "unreachable" against the empty scratch HOME,
// never fall through to a real, frozen path.
test("pinning: faked HOME with no api-token file resolves paths at call time -- default deps land on unreachable, not a real read", async () => {
  const originalHome = process.env.HOME;
  const scratchHome = mkdtempSync(join(tmpdir(), "rt-secrets-home-"));
  process.env.HOME = scratchHome;
  try {
    const result = await readDeckSecrets();
    expect(result.ok).toBe(false);
    expect((result as { message: string }).message).toContain("rt daemon start");
  } finally {
    process.env.HOME = originalHome;
    rmSync(scratchHome, { recursive: true, force: true });
  }
});

test("pinning: faked HOME with a scratch api-token file still resolves the socket at call time -- no daemon there, so still unreachable", async () => {
  const originalHome = process.env.HOME;
  const scratchHome = mkdtempSync(join(tmpdir(), "rt-secrets-home-"));
  mkdirSync(join(scratchHome, ".mattstack", "rt"), { recursive: true });
  writeFileSync(join(scratchHome, ".mattstack", "rt", "api-token"), "scratch-token");
  process.env.HOME = scratchHome;
  try {
    const result = await readDeckSecrets();
    // If the socket path were still frozen at the real HOME (the bug), and
    // a real daemon happened to be running there, this would come back
    // ok:true with real credentials instead.
    expect(result.ok).toBe(false);
    expect((result as { message: string }).message).toContain("rt daemon start");
  } finally {
    process.env.HOME = originalHome;
    rmSync(scratchHome, { recursive: true, force: true });
  }
});
