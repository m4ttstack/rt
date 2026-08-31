import { expect, test, beforeEach } from "bun:test";
import { getPlatformSettings, updatePlatformSettings, reloadPlatformSettings } from "./platform-settings.ts";

beforeEach(() => {
  process.env.LOCAL_PLATFORM_SETTINGS_PATH = `/tmp/deck-plat-${crypto.randomUUID()}.json`;
  reloadPlatformSettings(() => ({ value: undefined }));
});

test("tunnel defaults to null and round-trips (unowned: via platform.json)", () => {
  expect(getPlatformSettings().tunnel).toBeNull();
  updatePlatformSettings({ tunnel: { name: "deck-edge-mbp-abc123", uuid: "u-1" } }, () => ({ value: undefined }));
  reloadPlatformSettings(() => ({ value: undefined }));
  expect(getPlatformSettings().tunnel).toEqual({ name: "deck-edge-mbp-abc123", uuid: "u-1" });
});

test("tunnel is store-migrated: the deck.platform store wins over the file", () => {
  updatePlatformSettings({ tunnel: { name: "file-name", uuid: "file-uuid" } }, () => ({ value: undefined }));
  reloadPlatformSettings(() => ({ value: { tunnel: { name: "store-name", uuid: "store-uuid" } } }));
  expect(getPlatformSettings().tunnel).toEqual({ name: "store-name", uuid: "store-uuid" });
});

test("tunnel: null clears a recorded identity", () => {
  updatePlatformSettings({ tunnel: { name: "n", uuid: "u" } }, () => ({ value: undefined }));
  updatePlatformSettings({ tunnel: null }, () => ({ value: undefined }));
  reloadPlatformSettings(() => ({ value: undefined }));
  expect(getPlatformSettings().tunnel).toBeNull();
});
