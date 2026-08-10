import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const dir = mkdtempSync(join(tmpdir(), "local-psettings-"));
process.env.LOCAL_PLATFORM_SETTINGS_PATH = join(dir, "platform.json");
const {
  getPlatformSettings, updatePlatformSettings, reloadPlatformSettings, redactedSettings,
} = await import("./platform-settings.ts");

beforeEach(() => {
  rmSync(process.env.LOCAL_PLATFORM_SETTINGS_PATH!, { force: true });
  reloadPlatformSettings();
});

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
