import { test, expect, beforeEach } from "bun:test";
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
