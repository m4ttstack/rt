// src/edge/oauth.test.ts
import { test, expect, beforeEach, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

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

beforeEach(() => {
  rmSync(ACCESS_PATH, { force: true });
  reloadOAuth();
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
