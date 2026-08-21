import { test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, statSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { getSetting, setSetting } from "@mattstack/rt-client";

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

test("platform.json no longer carries the migrated fields after a write", () => {
  updatePlatformSettings({
    publicDomain: "x.example.dev", legacyPrefixes: ["/y"], tlds: ["localhost", "z"], secrets: { cfApiToken: "tok" },
  });
  const onDisk = JSON.parse(readFileSync(process.env.LOCAL_PLATFORM_SETTINGS_PATH!, "utf8"));
  expect(onDisk).not.toHaveProperty("publicDomain");
  expect(onDisk).not.toHaveProperty("legacyPrefixes");
  expect(onDisk.tlds).toEqual(["localhost", "z"]);
  expect(onDisk.secrets).toEqual({ cfApiToken: "tok" });
});

test("platform.json is written 0600", () => {
  updatePlatformSettings({ tlds: ["localhost", "example.dev"] });
  const mode = statSync(process.env.LOCAL_PLATFORM_SETTINGS_PATH!).mode & 0o777;
  expect(mode).toBe(0o600);
});
