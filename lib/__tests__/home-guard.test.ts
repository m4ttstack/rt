import { beforeAll, expect, test } from "bun:test";
import { join } from "path";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const ALREADY_BROKEN = "HOME was already broken when this test started (an afterAll, or an afterEach that threw, earlier)";
let out = "";

beforeAll(() => {
  const run = Bun.spawnSync(
    [process.execPath, "test", "./lib/__tests__/fixtures/home-guard-first-file.ts", "./lib/__tests__/fixtures/home-guard-second-file.ts"],
    { cwd: REPO_ROOT, env: process.env, stdout: "pipe", stderr: "pipe" },
  );
  out = run.stdout.toString() + run.stderr.toString();
});

test("the preload guard fails the test that breaks HOME, not the next one", () => {
  expect(out).toContain('After this test: HOME is "undefined"');
  expect(out).toContain("(fail) breaks HOME");
  expect(out).not.toContain("(fail) runs next");
});

test("a HOME broken outside any test fails the next test once and is repaired before it runs", () => {
  expect(out).toContain(`${ALREADY_BROKEN}: HOME is "relative/home"`);
  expect(out).toContain("(fail) starts after the afterAll");
  expect(out).not.toContain("(fail) starts after the repair");
});

test("a HOME broken by an earlier file costs one failure, not one per test of a describe that saves HOME", () => {
  expect(out).toContain(`${ALREADY_BROKEN}: HOME is unset`);
  expect(out).toContain("(fail) a describe that saves HOME in its own beforeEach > first test");
  expect(out).not.toContain("(fail) a describe that saves HOME in its own beforeEach > second test");
  expect(out).not.toContain("(fail) a describe that saves HOME in its own beforeEach > third test");
});
