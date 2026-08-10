// src/edge/access-tiers.test.ts
import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const dir = mkdtempSync(join(tmpdir(), "local-access-"));
process.env.LOCAL_STATE_DIR = dir;
process.env.LOCAL_ACCESS_PATH = join(dir, "access.json");
const { parseTier, getTier, setTier, reloadTiers, tierRequiresCf } = await import("./access-tiers.ts");

beforeEach(() => { rmSync(process.env.LOCAL_ACCESS_PATH!, { force: true }); reloadTiers(); });

test("parseTier accepts each tier shape and rejects junk", () => {
  expect(parseTier({ tier: "public" })).toEqual({ tier: "public" });
  expect(parseTier({ tier: "only-me", email: "m@x.dev" })).toEqual({ tier: "only-me", email: "m@x.dev" });
  expect(parseTier({ tier: "work-domain", emailDomain: "corp.com" })).toEqual({ tier: "work-domain", emailDomain: "corp.com" });
  expect(parseTier({ tier: "custom", emails: ["a@x.dev", "b@x.dev"] })).toEqual({ tier: "custom", emails: ["a@x.dev", "b@x.dev"] });
  expect(parseTier({ tier: "custom", emails: [] })).toHaveProperty("error");
  expect(parseTier({ tier: "only-me" })).toHaveProperty("error");
  expect(parseTier({ tier: "vip" })).toHaveProperty("error");
});

test("tiers persist per app; default is public", () => {
  expect(getTier("a")).toEqual({ tier: "public" });
  setTier("a", { tier: "work-domain", emailDomain: "corp.com" });
  reloadTiers();
  expect(getTier("a")).toEqual({ tier: "work-domain", emailDomain: "corp.com" });
});

test("only the identity tiers need Cloudflare", () => {
  expect(tierRequiresCf({ tier: "public" })).toBe(false);
  expect(tierRequiresCf({ tier: "password" })).toBe(false);
  expect(tierRequiresCf({ tier: "only-me", email: "m@x.dev" })).toBe(true);
});
