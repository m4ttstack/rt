import { afterEach, describe, expect, test } from "bun:test";
import { homeProblem, restoreHome } from "./home-env.ts";

const PRELOAD_HOME = process.env.HOME!;

afterEach(() => {
  process.env.HOME = PRELOAD_HOME;
});

describe("restoreHome", () => {
  test("a saved value of undefined removes HOME instead of storing the string \"undefined\"", () => {
    restoreHome(undefined);
    expect("HOME" in process.env).toBe(false);
  });

  test("a saved path is put back as-is", () => {
    process.env.HOME = "/somewhere/else";
    restoreHome(PRELOAD_HOME);
    expect(process.env.HOME).toBe(PRELOAD_HOME);
  });
});

describe("homeProblem", () => {
  test("an absolute path is fine", () => {
    expect(homeProblem("/tmp/rt-tests/home")).toBeNull();
  });

  test.each([
    ["missing", undefined],
    ["the string \"undefined\"", "undefined"],
    ["empty", ""],
    ["relative", "some/dir"],
  ])("%s is a problem", (_label, value) => {
    expect(homeProblem(value)).toContain(JSON.stringify(value) ?? "unset");
  });
});
