import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { restoreHome } from "../home-env.ts";

describe("a describe that saves HOME in its own beforeEach", () => {
  let home: string;
  let savedHome: string | undefined;

  beforeEach(() => {
    savedHome = process.env.HOME;
    home = mkdtempSync(join(tmpdir(), "rt-home-guard-"));
    process.env.HOME = home;
  });

  afterEach(() => {
    restoreHome(savedHome);
    rmSync(home, { recursive: true, force: true });
  });

  test("first test", () => {
    expect(process.env.HOME).toBe(home);
  });

  test("second test", () => {
    expect(process.env.HOME).toBe(home);
  });

  test("third test", () => {
    expect(process.env.HOME).toBe(home);
  });
});
