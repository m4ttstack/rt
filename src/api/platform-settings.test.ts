import { test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, statSync, mkdirSync, chmodSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { getSetting, setSetting } from "@mattstack/rt-client";

// rt-client doesn't export its machine-store path helper; this literal is
// duplicated from rt-client/src/settings/paths.ts#machineSettingsPath (which
// itself documents duplicating it from repo-tools/lib/rt-paths.ts) for the
// same reason: no dependency from here on rt-client's internals, only its
// public API. Change there first, mirror here.
function machineStorePath(): string {
  return join(process.env.HOME!, ".mattstack", "settings.local.jsonc");
}

const dir = mkdtempSync(join(tmpdir(), "local-psettings-"));
process.env.LOCAL_PLATFORM_SETTINGS_PATH = join(dir, "platform.json");
const {
  getPlatformSettings, updatePlatformSettings, reloadPlatformSettings, redactedSettings,
} = await import("./platform-settings.ts");

const origHome = process.env.HOME;
let home: string;

beforeEach(() => {
  rmSync(process.env.LOCAL_PLATFORM_SETTINGS_PATH!, { force: true });
  home = mkdtempSync(join(tmpdir(), "local-psettings-home-"));
  process.env.HOME = home;
  reloadPlatformSettings();
});

afterEach(() => {
  process.env.HOME = origHome;
  rmSync(home, { recursive: true, force: true });
});

function writeLegacyFile(body: Record<string, unknown>): void {
  writeFileSync(process.env.LOCAL_PLATFORM_SETTINGS_PATH!, JSON.stringify(body));
}

test("defaults are the stranger's defaults", () => {
  expect(getPlatformSettings()).toEqual({
    publicDomain: null, tlds: ["localhost"], legacyPrefixes: [], secrets: {},
  });
});

test("updates persist and merge", () => {
  updatePlatformSettings({ publicDomain: "example.dev", secrets: { cfApiToken: "tok" } });
  reloadPlatformSettings();
  expect(getPlatformSettings().publicDomain).toBe("example.dev");
  expect(getPlatformSettings().secrets.cfApiToken).toBe("tok");
});

test("redaction: secrets never leave as values", () => {
  updatePlatformSettings({ secrets: { cfApiToken: "tok", cfZoneId: "z1" } });
  const r = redactedSettings();
  expect(r).toEqual({
    publicDomain: null, tlds: ["localhost"], legacyPrefixes: [],
    hasCfToken: true, hasCfZone: true,
  });
  expect(JSON.stringify(r)).not.toContain("tok");
});

test("deck.platform store value wins over platform.json, per field", () => {
  writeLegacyFile({
    publicDomain: "file.example.dev", legacyPrefixes: ["/file-prefix"], tlds: ["localhost"], secrets: {},
  });
  setSetting("deck.platform", { publicDomain: "store.example.dev", legacyPrefixes: ["/store-prefix"] }, "machine");
  reloadPlatformSettings();
  expect(getPlatformSettings().publicDomain).toBe("store.example.dev");
  expect(getPlatformSettings().legacyPrefixes).toEqual(["/store-prefix"]);
});

test("a field absent from the store falls back to platform.json's value", () => {
  writeLegacyFile({
    publicDomain: "file.example.dev", legacyPrefixes: ["/file-prefix"], tlds: ["localhost"], secrets: {},
  });
  setSetting("deck.platform", { publicDomain: "store.example.dev" }, "machine");
  reloadPlatformSettings();
  expect(getPlatformSettings().publicDomain).toBe("store.example.dev");
  expect(getPlatformSettings().legacyPrefixes).toEqual(["/file-prefix"]);
});

test("the inverse: a store carrying only legacyPrefixes still falls back to the file for publicDomain", () => {
  writeLegacyFile({
    publicDomain: "file.example.dev", legacyPrefixes: ["/file-prefix"], tlds: ["localhost"], secrets: {},
  });
  setSetting("deck.platform", { legacyPrefixes: ["/store-prefix"] }, "machine");
  reloadPlatformSettings();
  expect(getPlatformSettings().publicDomain).toBe("file.example.dev");
  expect(getPlatformSettings().legacyPrefixes).toEqual(["/store-prefix"]);
});

test("a resolver throw degrades to platform.json's values, warning once", () => {
  writeLegacyFile({
    publicDomain: "file.example.dev", legacyPrefixes: ["/file-prefix"], tlds: ["localhost"], secrets: {},
  });
  const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  const throwingResolver: typeof getSetting = () => {
    throw new Error("rt daemon unreachable");
  };
  reloadPlatformSettings(throwingResolver);
  expect(getPlatformSettings().publicDomain).toBe("file.example.dev");
  expect(getPlatformSettings().legacyPrefixes).toEqual(["/file-prefix"]);
  expect(warnSpy).toHaveBeenCalledTimes(1);
  warnSpy.mockRestore();
});

test("updatePlatformSettings writes a patched migrated field to the store without clobbering the other", () => {
  setSetting("deck.platform", { publicDomain: "existing.example.dev", legacyPrefixes: ["/existing"] }, "machine");
  reloadPlatformSettings();
  updatePlatformSettings({ publicDomain: "new.example.dev" });
  const stored = getSetting<{ publicDomain?: string; legacyPrefixes?: string[] }>("deck.platform").value;
  expect(stored?.publicDomain).toBe("new.example.dev");
  expect(stored?.legacyPrefixes).toEqual(["/existing"]);
});

test("store key present: platform.json no longer carries the migrated fields after a write", () => {
  // Establish ownership first -- the latch only strips the file once the
  // store already carries deck.platform (see the "store key absent" tests
  // below for the opposite state).
  setSetting("deck.platform", { publicDomain: "seed.example.dev", legacyPrefixes: [] }, "machine");
  reloadPlatformSettings();
  updatePlatformSettings({
    publicDomain: "x.example.dev", legacyPrefixes: ["/y"], tlds: ["localhost", "z"], secrets: { cfApiToken: "tok" },
  });
  const onDisk = JSON.parse(readFileSync(process.env.LOCAL_PLATFORM_SETTINGS_PATH!, "utf8"));
  expect(onDisk).not.toHaveProperty("publicDomain");
  expect(onDisk).not.toHaveProperty("legacyPrefixes");
  expect(onDisk.tlds).toEqual(["localhost", "z"]);
  expect(onDisk.secrets).toEqual({ cfApiToken: "tok" });
});

test("store key absent: updatePlatformSettings keeps the migrated fields in the file and never touches the store", () => {
  writeLegacyFile({
    publicDomain: "file.example.dev", legacyPrefixes: ["/file-prefix"], tlds: ["localhost"], secrets: {},
  });
  reloadPlatformSettings();
  updatePlatformSettings({ tlds: ["localhost", "z"] });

  const onDisk = JSON.parse(readFileSync(process.env.LOCAL_PLATFORM_SETTINGS_PATH!, "utf8"));
  expect(onDisk.publicDomain).toBe("file.example.dev");
  expect(onDisk.legacyPrefixes).toEqual(["/file-prefix"]);
  expect(onDisk.tlds).toEqual(["localhost", "z"]);

  // Ownership is never manufactured by deck's own save path.
  expect(getSetting<unknown>("deck.platform").value).toBeUndefined();
});

test("store key absent: a publicDomain-changing write still lands only in the file", () => {
  updatePlatformSettings({ publicDomain: "fresh.example.dev" });
  reloadPlatformSettings();
  expect(getPlatformSettings().publicDomain).toBe("fresh.example.dev");
  expect(getSetting<unknown>("deck.platform").value).toBeUndefined();
});

test("platform.json is written 0600", () => {
  updatePlatformSettings({ tlds: ["localhost", "example.dev"] });
  const mode = statSync(process.env.LOCAL_PLATFORM_SETTINGS_PATH!).mode & 0o777;
  expect(mode).toBe(0o600);
});

test("an existing 0644 platform.json is upgraded to 0600 on the next write", () => {
  writeLegacyFile({ publicDomain: null, legacyPrefixes: [], tlds: ["localhost"], secrets: {} });
  chmodSync(process.env.LOCAL_PLATFORM_SETTINGS_PATH!, 0o644);
  updatePlatformSettings({ tlds: ["localhost", "upgraded.dev"] });
  const mode = statSync(process.env.LOCAL_PLATFORM_SETTINGS_PATH!).mode & 0o777;
  expect(mode).toBe(0o600);
});

test("a tlds-only patch never strips publicDomain/legacyPrefixes that only the file was carrying", () => {
  writeLegacyFile({
    publicDomain: "file-only.example.dev", legacyPrefixes: ["/file-only-prefix"], tlds: ["localhost"], secrets: {},
  });
  reloadPlatformSettings();
  updatePlatformSettings({ tlds: ["localhost", "upgraded.dev"] });
  reloadPlatformSettings();
  expect(getPlatformSettings().publicDomain).toBe("file-only.example.dev");
  expect(getPlatformSettings().legacyPrefixes).toEqual(["/file-only-prefix"]);
});

test("store key present: a store write failure reverts the in-memory cache instead of claiming a value neither side holds", () => {
  // rt-client's read path honest-degrades malformed stores to "empty"
  // rather than throwing (see stores.ts), so a plain syntax error can no
  // longer be used to force a write-time throw -- it would just read back
  // as unowned. A duplicate top-level key is the one shape that both (a)
  // parses fine under the lenient reader the ownership check uses (last
  // occurrence wins, so deck.platform reads as present/owned) and (b) is
  // refused by setSetting's stricter writer (assertEditableJsonc refuses to
  // edit a document with ANY duplicate key, anywhere in the tree).
  writeLegacyFile({ publicDomain: "file.example.dev", legacyPrefixes: [], tlds: ["localhost"], secrets: {} });
  mkdirSync(dirname(machineStorePath()), { recursive: true });
  writeFileSync(
    machineStorePath(),
    '{ "deck.platform": { "publicDomain": "owned.example.dev", "legacyPrefixes": [] },'
      + ' "deck.platform": { "publicDomain": "owned.example.dev", "legacyPrefixes": [] } }',
  );
  reloadPlatformSettings();
  const before = getPlatformSettings().publicDomain;
  expect(before).toBe("owned.example.dev"); // sanity: the store is read as owned before the write attempt

  expect(() => updatePlatformSettings({ publicDomain: "should-not-apply.example.dev" })).toThrow();
  expect(getPlatformSettings().publicDomain).toBe(before);
});
