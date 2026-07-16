import { test, expect, beforeEach, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Point the module at a throwaway file BEFORE importing it.
const dir = mkdtempSync(join(tmpdir(), "la-settings-"));
process.env.LOCAL_APPS_SETTINGS_PATH = join(dir, "settings.json");

const {
  getAppSettings, getSecret, setPublished, setPassword, clearPassword, reloadSettings,
} = await import("./settings.ts");

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  // Reset to an empty file between tests.
  Bun.write(process.env.LOCAL_APPS_SETTINGS_PATH!, JSON.stringify({ version: 1, apps: {} }));
  reloadSettings();
});

test("absent app defaults to published, no password, version 0", () => {
  const s = getAppSettings("ghost");
  expect(s.published).toBe(true);
  expect(s.passwordHash).toBeUndefined();
  expect(s.passwordVersion).toBe(0);
});

test("setPublished persists and survives reload", async () => {
  await setPublished("nihongo", false);
  reloadSettings();
  expect(getAppSettings("nihongo").published).toBe(false);
});

test("setPassword stores a bcrypt hash, not the raw password, and bumps version", async () => {
  await setPassword("nihongo", "hunter2");
  const s = getAppSettings("nihongo");
  expect(s.passwordHash).toBeDefined();
  expect(s.passwordHash).not.toContain("hunter2");
  expect(await Bun.password.verify("hunter2", s.passwordHash!)).toBe(true);
  expect(s.passwordVersion).toBe(1);
});

test("changing password bumps version again", async () => {
  await setPassword("nihongo", "one");
  await setPassword("nihongo", "two");
  expect(getAppSettings("nihongo").passwordVersion).toBe(2);
});

test("clearPassword removes the hash and bumps version", async () => {
  await setPassword("nihongo", "one");
  await clearPassword("nihongo");
  const s = getAppSettings("nihongo");
  expect(s.passwordHash).toBeUndefined();
  expect(s.passwordVersion).toBe(2);
});

test("getSecret generates a stable hex secret and persists it", () => {
  const a = getSecret();
  expect(a).toMatch(/^[0-9a-f]{64}$/);
  reloadSettings();
  expect(getSecret()).toBe(a);
});
