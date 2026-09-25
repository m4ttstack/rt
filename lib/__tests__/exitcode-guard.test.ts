import { beforeAll, expect, test } from "bun:test";
import { join } from "path";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const ALREADY_SET = "process.exitCode was already";
let out = "";

beforeAll(() => {
  const run = Bun.spawnSync(
    [process.execPath, "test", "./lib/__tests__/fixtures/exitcode-guard-first-file.ts"],
    { cwd: REPO_ROOT, env: process.env, stdout: "pipe", stderr: "pipe" },
  );
  out = run.stdout.toString() + run.stderr.toString();
});

test("the preload guard fails the test that leaves process.exitCode set, not the next one", () => {
  expect(out).toContain("After this test: process.exitCode was left at 1");
  expect(out).toContain("(fail) leaves exitCode set");
  expect(out).not.toContain("(fail) runs next");
});

test("an exitCode leaked from an afterAll fails the next test once and is repaired before it runs", () => {
  expect(out).toContain(`${ALREADY_SET} 2 when this test started`);
  expect(out).toContain("(fail) starts after the afterAll");
  expect(out).not.toContain("(fail) starts after the repair");
});
