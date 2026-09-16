import { expect, test } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const PROBE = join("lib", "__tests__", "env-scrub-probe.test.ts");

// The herdr-pane scenario end to end: a `bun test` run started with
// RT_DAEMON_SOCK in its environment must scrub the variable before any test
// runs and put its value on the forbidden-socket list.
test("an ambient RT_DAEMON_SOCK is scrubbed and forbidden for a bun test run", async () => {
  const fakeLiveSock = join(tmpdir(), `rt-fake-live-${process.pid}.sock`);
  const proc = Bun.spawn(["bun", "test", PROBE], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      RT_DAEMON_SOCK: fakeLiveSock,
      PROBE_EXPECT_FORBIDDEN: fakeLiveSock,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`probe run failed (exit ${exitCode})\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  }
  expect(exitCode).toBe(0);
}, 30_000);
