import { beforeAll, expect, test } from "bun:test";
import { join } from "path";

const REPO_ROOT = join(import.meta.dir, "..", "..");
let out = "";

beforeAll(() => {
  const run = Bun.spawnSync([process.execPath, "test", "./lib/__tests__/fixtures/home-guard-fixture.ts"], {
    cwd: REPO_ROOT,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  out = run.stdout.toString() + run.stderr.toString();
});

test("the preload guard fails the test that breaks HOME, not the next one", () => {
  expect(out).toContain('After this test: HOME is "undefined"');
  expect(out).toContain("(fail) breaks HOME");
  expect(out).not.toContain("(fail) runs next");
});

test("a HOME broken outside any test fails the next test and is repaired before the one after", () => {
  expect(out).toContain('Before this test started: HOME is "relative/home"');
  expect(out).toContain("(fail) starts after the afterAll");
  expect(out).not.toContain("(fail) starts after the repair");
  expect(out).toMatch(/^ 3 pass\n 2 fail$/m);
});
