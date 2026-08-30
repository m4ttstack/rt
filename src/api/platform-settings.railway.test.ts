import { expect, test, beforeEach } from "bun:test";
import { getPlatformSettings, updatePlatformSettings, reloadPlatformSettings } from "./platform-settings.ts";

beforeEach(() => { process.env.LOCAL_PLATFORM_SETTINGS_PATH = `/tmp/deck-plat-${crypto.randomUUID()}.json`; reloadPlatformSettings(() => ({ value: undefined })); });

test("railway defaults to null and round-trips", () => {
  expect(getPlatformSettings().railway).toBeNull();
  updatePlatformSettings({ railway: { projectId: "p1", environmentId: "e1" } });
  reloadPlatformSettings(() => ({ value: undefined }));
  expect(getPlatformSettings().railway).toEqual({ projectId: "p1", environmentId: "e1" });
});
