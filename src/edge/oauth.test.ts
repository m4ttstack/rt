// src/edge/oauth.test.ts
import { test, expect, beforeEach, afterEach, afterAll, spyOn } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, statSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { getSetting, setSetting } from "@mattstack/rt-client";

// rt-client doesn't export its user-store path helper; this literal is
// duplicated from rt-client/src/settings/paths.ts#userSettingsPath, same
// reason platform-settings.test.ts duplicates the machine one: no dependency
// from here on rt-client's internals, only its public API.
function userStorePath(): string {
  return join(process.env.HOME!, ".mattstack", "user", "settings.user.jsonc");
}

const dir = mkdtempSync(join(tmpdir(), "local-oauth-"));
const ACCESS_PATH = join(dir, "access.json");
// These are process-wide, and `bun test` runs every file in one process, so
// restore them afterwards rather than leaving this file's scratch paths for
// whatever sorts after it to inherit.
const priorState = process.env.LOCAL_STATE_DIR;
const priorAccess = process.env.LOCAL_ACCESS_PATH;
process.env.LOCAL_STATE_DIR = dir;
process.env.LOCAL_ACCESS_PATH = ACCESS_PATH;
const { parseOAuth, getOAuth, setOAuth, reloadOAuth, oauthRequiresCf } = await import("./oauth.ts");

const origHome = process.env.HOME;
let home: string;

beforeEach(() => {
  rmSync(ACCESS_PATH, { force: true });
  home = mkdtempSync(join(tmpdir(), "local-oauth-home-"));
  process.env.HOME = home;
  reloadOAuth();
});

afterEach(() => {
  process.env.HOME = origHome;
  rmSync(home, { recursive: true, force: true });
});

afterAll(() => {
  restore("LOCAL_STATE_DIR", priorState);
  restore("LOCAL_ACCESS_PATH", priorAccess);
  rmSync(dir, { recursive: true, force: true });
});

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

test("parseOAuth accepts each mode and rejects junk", () => {
  expect(parseOAuth({ mode: "off" })).toEqual({ mode: "off" });
  expect(parseOAuth({ mode: "emails", emails: ["a@x.dev", "b@x.dev"] }))
    .toEqual({ mode: "emails", emails: ["a@x.dev", "b@x.dev"] });
  expect(parseOAuth({ mode: "domains", domains: ["corp.com", "other.dev"] }))
    .toEqual({ mode: "domains", domains: ["corp.com", "other.dev"] });

  expect(parseOAuth({ mode: "emails", emails: [] })).toHaveProperty("error");
  expect(parseOAuth({ mode: "emails", emails: ["not-an-email"] })).toHaveProperty("error");
  expect(parseOAuth({ mode: "emails" })).toHaveProperty("error");
  expect(parseOAuth({ mode: "domains", domains: [] })).toHaveProperty("error");
  expect(parseOAuth({ mode: "domains", domains: ["not a domain"] })).toHaveProperty("error");
  expect(parseOAuth({ mode: "vip" })).toHaveProperty("error");
  expect(parseOAuth(null)).toHaveProperty("error");
});

test("parseOAuth rejects the old tier names rather than translating them", () => {
  expect(parseOAuth({ tier: "public" })).toHaveProperty("error");
  expect(parseOAuth({ tier: "password" })).toHaveProperty("error");
  expect(parseOAuth({ tier: "only-me", email: "m@x.dev" })).toHaveProperty("error");
  expect(parseOAuth({ tier: "work-domain", emailDomain: "corp.com" })).toHaveProperty("error");
  expect(parseOAuth({ tier: "custom", emails: ["a@x.dev"] })).toHaveProperty("error");
});

test("rules persist per app; the default is off", () => {
  expect(getOAuth("a")).toEqual({ mode: "off" });
  setOAuth("a", { mode: "domains", domains: ["corp.com"] });
  reloadOAuth();
  expect(getOAuth("a")).toEqual({ mode: "domains", domains: ["corp.com"] });
});

test("only an on-mode needs Cloudflare", () => {
  expect(oauthRequiresCf({ mode: "off" })).toBe(false);
  expect(oauthRequiresCf({ mode: "emails", emails: ["m@x.dev"] })).toBe(true);
  expect(oauthRequiresCf({ mode: "domains", domains: ["corp.com"] })).toBe(true);
});

test("load drops every entry that does not match the current shape and rewrites the file", () => {
  writeFileSync(ACCESS_PATH, JSON.stringify({
    apps: {
      legacyPublic: { tier: "public" },
      legacyOnlyMe: { tier: "only-me", email: "m@x.dev" },
      legacyDomain: { tier: "work-domain", emailDomain: "corp.com" },
      junk: { mode: "emails", emails: [] },
      keeper: { mode: "emails", emails: ["a@x.dev"] },
    },
  }));
  reloadOAuth();

  expect(getOAuth("legacyOnlyMe")).toEqual({ mode: "off" });
  expect(getOAuth("legacyDomain")).toEqual({ mode: "off" });
  expect(getOAuth("junk")).toEqual({ mode: "off" });
  expect(getOAuth("keeper")).toEqual({ mode: "emails", emails: ["a@x.dev"] });

  // The drop is written back, not re-derived on every load.
  const onDisk = JSON.parse(readFileSync(ACCESS_PATH, "utf8"));
  expect(Object.keys(onDisk.apps)).toEqual(["keeper"]);
});

test("a file with nothing to drop is left alone", () => {
  setOAuth("a", { mode: "emails", emails: ["a@x.dev"] });
  const before = readFileSync(ACCESS_PATH, "utf8");
  const beforeStat = statSync(ACCESS_PATH);

  reloadOAuth();

  // Content alone cannot fail this: a rewrite is byte-identical, so an
  // unconditional save() would still pass. save() writes a temp file and
  // renames it over the target, so any write at all lands a NEW inode.
  expect(statSync(ACCESS_PATH).ino).toBe(beforeStat.ino);
  expect(readFileSync(ACCESS_PATH, "utf8")).toBe(before);
});

// ─── deck.access store migration (MAT-384 Task 2) ────────────────────────────

test("deck.access store entry wins over access.json wholesale, per app", () => {
  writeFileSync(ACCESS_PATH, JSON.stringify({
    apps: { a: { mode: "domains", domains: ["file.example.com"] } },
  }));
  setSetting("deck.access", { a: { mode: "emails", emails: ["store@example.com"] } }, "user");
  reloadOAuth();
  expect(getOAuth("a")).toEqual({ mode: "emails", emails: ["store@example.com"] });
});

test("an app absent from the store falls back to its access.json entry", () => {
  writeFileSync(ACCESS_PATH, JSON.stringify({
    apps: { a: { mode: "domains", domains: ["file.example.com"] } },
  }));
  setSetting("deck.access", { b: { mode: "off" } }, "user");
  reloadOAuth();
  expect(getOAuth("a")).toEqual({ mode: "domains", domains: ["file.example.com"] });
});

test("a store entry that doesn't match the OAuth shape is skipped, never rewritten", () => {
  writeFileSync(ACCESS_PATH, JSON.stringify({
    apps: { a: { mode: "domains", domains: ["file.example.com"] } },
  }));
  setSetting("deck.access", { a: { tier: "public" } }, "user");
  reloadOAuth();
  expect(getOAuth("a")).toEqual({ mode: "domains", domains: ["file.example.com"] });
  // Never auto-rewrite the store: the malformed entry is still there verbatim.
  const stored = getSetting<Record<string, unknown>>("deck.access").value;
  expect(stored?.a).toEqual({ tier: "public" });
});

test("a resolver throw degrades to access.json's entries entirely, warning once", () => {
  writeFileSync(ACCESS_PATH, JSON.stringify({
    apps: { a: { mode: "domains", domains: ["file.example.com"] } },
  }));
  const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  const throwingResolver: typeof getSetting = () => {
    throw new Error("rt daemon unreachable");
  };
  reloadOAuth(throwingResolver);
  expect(getOAuth("a")).toEqual({ mode: "domains", domains: ["file.example.com"] });
  expect(warnSpy).toHaveBeenCalledTimes(1);
  warnSpy.mockRestore();
});

// ─── store ownership latch (MAT-384 fix wave) ────────────────────────────────
//
// Store ownership of deck.access is a one-way latch, decided fresh on every
// call from whether getSetting("deck.access") currently yields a defined
// value. It starts absent in every one of these tests (a fresh temp HOME per
// test, per beforeEach), so the "store key absent" tests below need no setup
// at all; the "store key present" tests establish ownership explicitly with
// a `setSetting` call before exercising setOAuth.

test("store key absent: setOAuth keeps the rule in the file and never touches the store", () => {
  setOAuth("a", { mode: "emails", emails: ["a@x.dev"] });

  const onDisk = JSON.parse(readFileSync(ACCESS_PATH, "utf8"));
  expect(onDisk.apps.a).toEqual({ mode: "emails", emails: ["a@x.dev"] });
  expect(getSetting<unknown>("deck.access").value).toBeUndefined();
});

test("store key present: setOAuth writes the store and stops persisting the rule to the file", () => {
  setSetting("deck.access", { seed: { mode: "off" } }, "user");
  reloadOAuth();

  setOAuth("a", { mode: "emails", emails: ["a@x.dev"] });
  const stored = getSetting<Record<string, unknown>>("deck.access").value;
  expect(stored?.a).toEqual({ mode: "emails", emails: ["a@x.dev"] });

  const onDisk = JSON.parse(readFileSync(ACCESS_PATH, "utf8"));
  expect(onDisk.apps).toEqual({});
});

test("store key present: setOAuth on one app keeps every other app's rule current in the store too", () => {
  setSetting("deck.access", { seed: { mode: "off" } }, "user");
  reloadOAuth();

  setOAuth("a", { mode: "emails", emails: ["a@x.dev"] });
  setOAuth("b", { mode: "domains", domains: ["corp.com"] });
  const stored = getSetting<Record<string, unknown>>("deck.access").value;
  expect(stored?.a).toEqual({ mode: "emails", emails: ["a@x.dev"] });
  expect(stored?.b).toEqual({ mode: "domains", domains: ["corp.com"] });
});

test("store key present: a malformed store entry for another app survives a write untouched", () => {
  // "a" is malformed (isOAuth rejects it): the loader skips it on READ, but
  // the WRITE overlay reads the raw store fresh, so it must never be erased
  // by a write that only touches "b".
  setSetting("deck.access", { a: { tier: "public" }, b: { mode: "off" } }, "user");
  reloadOAuth();

  setOAuth("b", { mode: "emails", emails: ["b@x.dev"] });
  const stored = getSetting<Record<string, unknown>>("deck.access").value;
  expect(stored?.a).toEqual({ tier: "public" });
  expect(stored?.b).toEqual({ mode: "emails", emails: ["b@x.dev"] });
});

test("access.json is written 0600", () => {
  setOAuth("a", { mode: "off" });
  const mode = statSync(ACCESS_PATH).mode & 0o777;
  expect(mode).toBe(0o600);
});

test("store key absent: a file-write failure reverts the in-memory cache instead of silently keeping the change", () => {
  setOAuth("a", { mode: "off" }); // establishes a baseline the failed write must revert to

  rmSync(ACCESS_PATH, { force: true });
  mkdirSync(ACCESS_PATH, { recursive: true });
  try {
    expect(() => setOAuth("a", { mode: "emails", emails: ["a@x.dev"] })).toThrow();
  } finally {
    rmSync(ACCESS_PATH, { recursive: true, force: true });
  }

  expect(getOAuth("a")).toEqual({ mode: "off" });
});

test("a resolver throw on the ownership probe degrades to unowned rather than crashing the write", () => {
  setSetting("deck.access", { poison: "${repoRoot}" }, "user");
  reloadOAuth(); // load()'s own fallback already tolerates this; unaffected by the probe fix

  expect(() => setOAuth("a", { mode: "emails", emails: ["a@x.dev"] })).not.toThrow();

  const onDisk = JSON.parse(readFileSync(ACCESS_PATH, "utf8"));
  expect(onDisk.apps.a).toEqual({ mode: "emails", emails: ["a@x.dev"] });
});

test("store key present: a file-write failure collapsing access.json to {} does not revert the store or fail the call -- the store already persisted", () => {
  setSetting("deck.access", { seed: { mode: "off" } }, "user");
  reloadOAuth();

  rmSync(ACCESS_PATH, { force: true });
  mkdirSync(ACCESS_PATH, { recursive: true });
  const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  try {
    expect(() => setOAuth("a", { mode: "emails", emails: ["a@x.dev"] })).not.toThrow();
    expect(warnSpy).toHaveBeenCalled();
  } finally {
    rmSync(ACCESS_PATH, { recursive: true, force: true });
    warnSpy.mockRestore();
  }

  const stored = getSetting<Record<string, unknown>>("deck.access").value;
  expect(stored?.a).toEqual({ mode: "emails", emails: ["a@x.dev"] });
});

test("store key present: a store write failure reverts the in-memory cache instead of claiming a value neither side holds", () => {
  // rt-client's read path honest-degrades a malformed store to "empty"
  // rather than throwing (see stores.ts), so a plain syntax error can no
  // longer be used to force a write-time throw -- it would just read back as
  // unowned. A duplicate top-level key is the one shape that both (a) parses
  // fine under the lenient reader the ownership check uses (last occurrence
  // wins, so deck.access reads as present/owned) and (b) is refused by
  // setSetting's stricter writer (assertEditableJsonc refuses to edit a
  // document with ANY duplicate key, anywhere in the tree).
  mkdirSync(dirname(userStorePath()), { recursive: true });
  writeFileSync(
    userStorePath(),
    '{ "deck.access": { "a": { "mode": "off" } }, "deck.access": { "a": { "mode": "off" } } }',
  );
  reloadOAuth();
  expect(getOAuth("a")).toEqual({ mode: "off" }); // sanity: the store is read as owned before the write attempt

  expect(() => setOAuth("a", { mode: "emails", emails: ["a@x.dev"] })).toThrow();
  expect(getOAuth("a")).toEqual({ mode: "off" });
});
