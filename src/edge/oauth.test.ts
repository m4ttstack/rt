// src/edge/oauth.test.ts
import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const dir = mkdtempSync(join(tmpdir(), "local-oauth-"));
process.env.LOCAL_STATE_DIR = dir;
process.env.LOCAL_ACCESS_PATH = join(dir, "access.json");
const { parseOAuth, getOAuth, setOAuth, reloadOAuth, oauthRequiresCf } = await import("./oauth.ts");

beforeEach(() => {
  rmSync(process.env.LOCAL_ACCESS_PATH!, { force: true });
  reloadOAuth();
});

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
  writeFileSync(process.env.LOCAL_ACCESS_PATH!, JSON.stringify({
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
  const onDisk = JSON.parse(readFileSync(process.env.LOCAL_ACCESS_PATH!, "utf8"));
  expect(Object.keys(onDisk.apps)).toEqual(["keeper"]);
});

test("a file with nothing to drop is left alone", () => {
  setOAuth("a", { mode: "emails", emails: ["a@x.dev"] });
  const before = readFileSync(process.env.LOCAL_ACCESS_PATH!, "utf8");
  reloadOAuth();
  expect(readFileSync(process.env.LOCAL_ACCESS_PATH!, "utf8")).toBe(before);
});
