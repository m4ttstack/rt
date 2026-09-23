import { describe, expect, test } from "bun:test";
import { isCompiledRt, rtSelfArgv } from "../rt-self.ts";

describe("isCompiledRt", () => {
  test("a module under the compiled binary's /$bunfs root is compiled", () => {
    expect(isCompiledRt("file:///$bunfs/root/rt")).toBe(true);
  });
  test("a source module is not", () => {
    expect(isCompiledRt("file:///Users/dev/repo-tools/lib/rt-self.ts")).toBe(false);
  });
  test("this test process runs from source", () => {
    expect(isCompiledRt()).toBe(false);
  });
});

describe("rtSelfArgv", () => {
  test("compiled: the binary alone", () => {
    expect(rtSelfArgv({ compiled: true, execPath: "/Apps/mattstack.app/Contents/Helpers/rt" })).toEqual(["/Apps/mattstack.app/Contents/Helpers/rt"]);
  });
  test("source: bun pinned to rt's own bunfig and no .env, then the entry script", () => {
    expect(rtSelfArgv({ compiled: false, execPath: "/opt/bun", main: "/repo/cli.ts" })).toEqual([
      "/opt/bun",
      "--no-env-file",
      "--config=/repo/bunfig.toml",
      "/repo/cli.ts",
    ]);
  });
});
