import { test, expect, beforeEach, afterEach, afterAll, spyOn } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, statSync, mkdirSync, chmodSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { getSetting, setSetting } from "@mattstack/rt-client";

// rt-client doesn't export its user-store path helper; this literal is
// duplicated from rt-client/src/settings/paths.ts#userSettingsPath (which
// itself documents duplicating it from repo-tools/lib/rt-paths.ts) for the
// same reason platform-settings.test.ts duplicates the machine one: no
// dependency from here on rt-client's internals, only its public API.
function userStorePath(): string {
  return join(process.env.HOME!, ".mattstack", "user", "settings.jsonc");
}

const dir = mkdtempSync(join(tmpdir(), "la-settings-"));
process.env.LOCAL_APPS_SETTINGS_PATH = join(dir, "settings.json");

const {
  getAppSettings, getSecret, setPublished, setPassword, clearPassword, reloadSettings,
  getOverride, setOverride, clearOverride, getOverrides,
  getPublicFollowsOverride, setPublicFollowsOverride, renameAppSettings,
} = await import("./settings.ts");

const origHome = process.env.HOME;
let home: string;

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  // Reset to an empty file between tests.
  Bun.write(process.env.LOCAL_APPS_SETTINGS_PATH!, JSON.stringify({ version: 1, apps: {} }));
  home = mkdtempSync(join(tmpdir(), "la-settings-home-"));
  process.env.HOME = home;
  reloadSettings();
});

afterEach(() => {
  process.env.HOME = origHome;
  rmSync(home, { recursive: true, force: true });
});

function writeLegacyFile(body: Record<string, unknown>): void {
  writeFileSync(process.env.LOCAL_APPS_SETTINGS_PATH!, JSON.stringify(body));
}

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

test("setOverride persists and getOverride/getAppSettings surface it", () => {
  setOverride("boxscore", { devPort: 5173, basePort: 8787 });
  expect(getOverride("boxscore")).toEqual({ devPort: 5173, basePort: 8787 });
  expect(getAppSettings("boxscore").override).toEqual({ devPort: 5173, basePort: 8787 });
});

test("clearOverride removes it", () => {
  setOverride("boxscore", { devPort: 5173, basePort: 8787 });
  clearOverride("boxscore");
  expect(getOverride("boxscore")).toBeUndefined();
  expect(getAppSettings("boxscore").override).toBeUndefined();
});

test("getOverrides lists only apps with an active override", () => {
  setOverride("boxscore", { devPort: 5173, basePort: 8787 });
  expect(getOverrides()).toEqual({ boxscore: { devPort: 5173, basePort: 8787 } });
});

// ─── deck.apps store migration (MAT-384 Task 2) ──────────────────────────────

test("deck.apps store value wins over settings.json, per field", () => {
  writeLegacyFile({
    version: 1,
    apps: { nihongo: { published: false, passwordVersion: 0, publicFollowsOverride: false } },
  });
  setSetting("deck.apps", { nihongo: { published: true, publicFollowsOverride: true } }, "user");
  reloadSettings();
  const s = getAppSettings("nihongo");
  expect(s.published).toBe(true);
  expect(s.publicFollowsOverride).toBe(true);
});

test("a field absent from the store falls back to settings.json's value", () => {
  writeLegacyFile({
    version: 1,
    apps: { nihongo: { published: false, passwordVersion: 0, publicFollowsOverride: true } },
  });
  setSetting("deck.apps", { nihongo: { published: true } }, "user");
  reloadSettings();
  const s = getAppSettings("nihongo");
  expect(s.published).toBe(true);
  expect(s.publicFollowsOverride).toBe(true);
});

test("an app absent from the store falls back to its file entry untouched", () => {
  writeLegacyFile({
    version: 1,
    apps: {
      nihongo: { published: false, passwordVersion: 0 },
      boxscore: { published: true, passwordVersion: 0 },
    },
  });
  setSetting("deck.apps", { nihongo: { published: true } }, "user");
  reloadSettings();
  expect(getAppSettings("boxscore").published).toBe(true);
});

test("passwordHash/passwordVersion/override stay file-local: the store never carries them", () => {
  writeLegacyFile({
    version: 1,
    apps: { nihongo: { published: true, passwordHash: "h", passwordVersion: 3 } },
  });
  setSetting("deck.apps", { nihongo: { published: false } }, "user");
  reloadSettings();
  const s = getAppSettings("nihongo");
  expect(s.published).toBe(false);
  expect(s.passwordHash).toBe("h");
  expect(s.passwordVersion).toBe(3);
});

test("a resolver throw degrades to settings.json's entries entirely, warning once", () => {
  writeLegacyFile({
    version: 1,
    apps: { nihongo: { published: false, passwordVersion: 0 } },
  });
  const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  const throwingResolver: typeof getSetting = () => {
    throw new Error("rt daemon unreachable");
  };
  reloadSettings(throwingResolver);
  expect(getAppSettings("nihongo").published).toBe(false);
  expect(warnSpy).toHaveBeenCalledTimes(1);
  warnSpy.mockRestore();
});

test("setPublished writes the store unconditionally and stops persisting published to the file", async () => {
  await setPublished("nihongo", false);
  const stored = getSetting<Record<string, { published?: boolean }>>("deck.apps").value;
  expect(stored?.nihongo?.published).toBe(false);

  const onDisk = JSON.parse(readFileSync(process.env.LOCAL_APPS_SETTINGS_PATH!, "utf8"));
  expect(onDisk.apps.nihongo).not.toHaveProperty("published");
});

test("setPublicFollowsOverride writes the store and stops persisting the field to the file", () => {
  setPublicFollowsOverride("nihongo", true);
  const stored = getSetting<Record<string, { publicFollowsOverride?: boolean }>>("deck.apps").value;
  expect(stored?.nihongo?.publicFollowsOverride).toBe(true);

  const onDisk = JSON.parse(readFileSync(process.env.LOCAL_APPS_SETTINGS_PATH!, "utf8"));
  expect(onDisk.apps.nihongo).not.toHaveProperty("publicFollowsOverride");
});

test("a setPassword-triggered save keeps the store current for every app, not just the touched one", async () => {
  await setPublished("nihongo", false);
  await setPassword("nihongo", "hunter2");
  const stored = getSetting<Record<string, { published?: boolean }>>("deck.apps").value;
  expect(stored?.nihongo?.published).toBe(false);
});

test("passwordVersion survives a write that strips the migrated fields from the file", async () => {
  await setPassword("nihongo", "one");
  const onDisk = JSON.parse(readFileSync(process.env.LOCAL_APPS_SETTINGS_PATH!, "utf8"));
  expect(onDisk.apps.nihongo.passwordVersion).toBe(1);
});

test("settings.json is written 0600", async () => {
  await setPublished("nihongo", true);
  const mode = statSync(process.env.LOCAL_APPS_SETTINGS_PATH!).mode & 0o777;
  expect(mode).toBe(0o600);
});

test("an existing 0644 settings.json is upgraded to 0600 on the next write", async () => {
  writeLegacyFile({ version: 1, apps: {} });
  chmodSync(process.env.LOCAL_APPS_SETTINGS_PATH!, 0o644);
  await setPublished("nihongo", true);
  const mode = statSync(process.env.LOCAL_APPS_SETTINGS_PATH!).mode & 0o777;
  expect(mode).toBe(0o600);
});

test("a store write failure reverts the in-memory cache instead of claiming a value neither side holds", async () => {
  reloadSettings();
  const before = getAppSettings("nihongo").published;
  mkdirSync(dirname(userStorePath()), { recursive: true });
  writeFileSync(userStorePath(), "{ this is not valid jsonc");
  await expect(setPublished("nihongo", false)).rejects.toThrow();
  expect(getAppSettings("nihongo").published).toBe(before);
});

test("renameAppSettings carries published/publicFollowsOverride to the new key in the store", () => {
  setPublicFollowsOverride("old-name", true);
  renameAppSettings("old-name", "new-name");
  const stored = getSetting<Record<string, { published?: boolean; publicFollowsOverride?: boolean }>>(
    "deck.apps",
  ).value;
  expect(stored?.["old-name"]).toBeUndefined();
  expect(stored?.["new-name"]?.publicFollowsOverride).toBe(true);
  expect(getPublicFollowsOverride("new-name")).toBe(true);
});
