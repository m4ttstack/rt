import { describe, expect, test } from "bun:test";
import { existsSync } from "fs";
import { SUN_PATH_MAX, assertSocketPathFits, termwrightSocketPath } from "../socket-path.ts";

describe("termwright socket paths", () => {
  test("the preload exports a socket dir whose paths stay under macOS's sun_path limit", () => {
    const dir = process.env.RT_TEST_SOCKET_DIR;
    expect(dir).toBeDefined();
    expect(existsSync(dir!)).toBe(true);
    const widest = termwrightSocketPath(dir!, 9_999_999, 9_999);
    expect(Buffer.byteLength(widest)).toBeLessThan(SUN_PATH_MAX);
  });

  test("a path at the limit is refused with its byte count, one byte under it is not", () => {
    const atLimit = `/${"x".repeat(SUN_PATH_MAX - 1)}`;
    expect(() => assertSocketPathFits(atLimit)).toThrow(`${SUN_PATH_MAX} bytes`);
    expect(() => assertSocketPathFits(atLimit.slice(0, -1))).not.toThrow();
  });

  test("multibyte characters count as bytes, not characters", () => {
    const path = `/${"é".repeat(60)}`;
    expect(path.length).toBeLessThan(SUN_PATH_MAX);
    expect(() => assertSocketPathFits(path)).toThrow();
  });
});
