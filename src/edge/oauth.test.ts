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
  return join(process.env.HOME!, ".mattstack", "user", "settings.jsonc");
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

test("setOAuth writes the store unconditionally and stops persisting the rule to the file", () => {
  setOAuth("a", { mode: "emails", emails: ["a@x.dev"] });
  const stored = getSetting<Record<string, unknown>>("deck.access").value;
  expect(stored?.a).toEqual({ mode: "emails", emails: ["a@x.dev"] });

  const onDisk = JSON.parse(readFileSync(ACCESS_PATH, "utf8"));
  expect(onDisk.apps.a).toBeUndefined();
});

test("setOAuth on one app keeps every other app's rule current in the store too", () => {
  setOAuth("a", { mode: "emails", emails: ["a@x.dev"] });
  setOAuth("b", { mode: "domains", domains: ["corp.com"] });
  const stored = getSetting<Record<string, unknown>>("deck.access").value;
  expect(stored?.a).toEqual({ mode: "emails", emails: ["a@x.dev"] });
  expect(stored?.b).toEqual({ mode: "domains", domains: ["corp.com"] });
});

test("access.json is written 0600", () => {
  setOAuth("a", { mode: "off" });
  const mode = statSync(ACCESS_PATH).mode & 0o777;
  expect(mode).toBe(0o600);
});

test("a store write failure reverts the in-memory cache instead of claiming a value neither side holds", () => {
  reloadOAuth();
  mkdirSync(dirname(userStorePath()), { recursive: true });
  writeFileSync(userStorePath(), "{ this is not valid jsonc");
  expect(() => setOAuth("a", { mode: "emails", emails: ["a@x.dev"] })).toThrow();
  expect(getOAuth("a")).toEqual({ mode: "off" });
});
