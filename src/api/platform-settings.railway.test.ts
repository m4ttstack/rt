import { expect, test, beforeEach } from "bun:test";
import { getPlatformSettings, updatePlatformSettings, reloadPlatformSettings } from "./platform-settings.ts";

beforeEach(() => { process.env.LOCAL_PLATFORM_SETTINGS_PATH = `/tmp/deck-plat-${crypto.randomUUID()}.json`; reloadPlatformSettings(() => ({ value: undefined })); });

test("railway defaults to null and round-trips (unowned: via platform.json)", () => {
  expect(getPlatformSettings().railway).toBeNull();
  updatePlatformSettings({ railway: { projectId: "p1", environmentId: "e1" } }, () => ({ value: undefined }));
  reloadPlatformSettings(() => ({ value: undefined }));
  expect(getPlatformSettings().railway).toEqual({ projectId: "p1", environmentId: "e1" });
});

test("railway is store-migrated: the deck.platform store wins over the file", () => {
  // file holds one value (unowned write); the store then owns deck.platform and carries another.
  updatePlatformSettings({ railway: { projectId: "file-p", environmentId: "file-e" } }, () => ({ value: undefined }));
  reloadPlatformSettings(() => ({ value: { railway: { projectId: "store-p", environmentId: "store-e" } } }));
  expect(getPlatformSettings().railway).toEqual({ projectId: "store-p", environmentId: "store-e" });
});
