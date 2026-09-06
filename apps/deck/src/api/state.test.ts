import { test, expect, beforeEach, afterAll } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const scratch = mkdtempSync(join(tmpdir(), "local-state-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const { stateDir, adoptLegacyStateDir } = await import("./state.ts");

beforeEach(() => {
  delete process.env.LOCAL_STATE_DIR;
  delete process.env.LOCAL_LEGACY_STATE_DIR;
});

test("adoptLegacyStateDir renames the pre-rename dir into place when the new one doesn't exist yet", () => {
  const newDir = join(scratch, `deck-${Date.now()}`);
  const legacyDir = join(scratch, `local-${Date.now()}`);
  mkdirSync(legacyDir, { recursive: true });
  writeFileSync(join(legacyDir, "registry.json"), '{"version":1,"apps":{}}');
  process.env.LOCAL_STATE_DIR = newDir;
  process.env.LOCAL_LEGACY_STATE_DIR = legacyDir;

  adoptLegacyStateDir();

  expect(existsSync(newDir)).toBe(true);
  expect(existsSync(legacyDir)).toBe(false);
  expect(readFileSync(join(newDir, "registry.json"), "utf8")).toContain('"version":1');
});

test("adoptLegacyStateDir is a no-op when the new dir already exists -- never overwrites live state", () => {
  const newDir = join(scratch, `deck-existing-${Date.now()}`);
  const legacyDir = join(scratch, `local-existing-${Date.now()}`);
  mkdirSync(newDir, { recursive: true });
  writeFileSync(join(newDir, "registry.json"), '{"version":1,"apps":{"kept":true}}');
  mkdirSync(legacyDir, { recursive: true });
  writeFileSync(join(legacyDir, "registry.json"), '{"version":1,"apps":{"stale":true}}');
  process.env.LOCAL_STATE_DIR = newDir;
  process.env.LOCAL_LEGACY_STATE_DIR = legacyDir;

  adoptLegacyStateDir();

  expect(existsSync(legacyDir)).toBe(true); // untouched
  expect(readFileSync(join(newDir, "registry.json"), "utf8")).toContain("kept"); // untouched
});

test("adoptLegacyStateDir is a no-op when no legacy dir exists", () => {
  const newDir = join(scratch, `deck-fresh-${Date.now()}`);
  const legacyDir = join(scratch, `local-never-existed-${Date.now()}`);
  process.env.LOCAL_STATE_DIR = newDir;
  process.env.LOCAL_LEGACY_STATE_DIR = legacyDir;

  expect(() => adoptLegacyStateDir()).not.toThrow();
  expect(existsSync(newDir)).toBe(false);
});

test("adoptLegacyStateDir is a no-op when the resolved new and legacy dirs are the same path", () => {
  // Both overrides pointed at the identical directory: nothing to adopt
  // FROM, and a rename onto itself must never be attempted.
  const sameDir = join(scratch, `deck-same-${Date.now()}`);
  mkdirSync(sameDir, { recursive: true });
  process.env.LOCAL_STATE_DIR = sameDir;
  process.env.LOCAL_LEGACY_STATE_DIR = sameDir;

  expect(() => adoptLegacyStateDir()).not.toThrow();
  expect(existsSync(sameDir)).toBe(true);
});

test("stateDir defaults under ~/.mattstack/deck", () => {
  expect(stateDir()).toContain(join(".mattstack", "deck"));
});

test("stateDir follows a faked HOME at call time, not a value frozen at process start", () => {
  const originalHome = process.env.HOME;
  const fakeHome = join(scratch, `home-${Date.now()}`);
  process.env.HOME = fakeHome;
  try {
    expect(stateDir()).toBe(join(fakeHome, ".mattstack", "deck"));
  } finally {
    process.env.HOME = originalHome;
  }
});
