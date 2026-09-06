import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { setSetting } from "@mattstack/rt-client";
import { isDevMode, resetDevModeCache } from "./dev-mode.ts";

beforeEach(() => resetDevModeCache());

test("dev when mattstack.mode is dev", () => {
  expect(isDevMode({ read: () => "dev" })).toBe(true);
});

test("prod when mattstack.mode is prod", () => {
  expect(isDevMode({ read: () => "prod" })).toBe(false);
});

test("unset value is production (fail closed)", () => {
  expect(isDevMode({ read: () => undefined })).toBe(false);
});

test("a throwing read is production (fail closed)", () => {
  expect(isDevMode({ read: () => { throw new Error("no daemon"); } })).toBe(false);
});

// The real getSetting path (no injected read), which the cases above bypass.
// Regression guard for the rt-client bump: `mattstack.mode` must be a registered
// key, or getSetting throws unknownKey and the gate is stuck fail-closed to prod.
test("real rt-client path reads mattstack.mode from the store", () => {
  const origHome = process.env.HOME;
  process.env.HOME = mkdtempSync(join(tmpdir(), "devmode-real-"));
  try {
    resetDevModeCache();
    expect(isDevMode()).toBe(false); // unset -> prod

    setSetting("mattstack.mode", "prod", "machine");
    resetDevModeCache();
    expect(isDevMode()).toBe(false);

    setSetting("mattstack.mode", "dev", "machine");
    resetDevModeCache();
    expect(isDevMode()).toBe(true);
  } finally {
    process.env.HOME = origHome;
    resetDevModeCache();
  }
});
