import { expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";

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

// A run killed before its afterAll leaves its dirs behind, and a Go build
// under that run's HOME leaves a module cache whose dirs are read-only. The
// next run's preload must still sweep it, or every test in that run fails
// before starting.
test("a dead run's dir holding a read-only Go module cache is swept by the next run", async () => {
  const testRoot = dirname(tmpdir());
  const dead = Bun.spawn(["true"]);
  await dead.exited;
  const stale = join(testRoot, `${dead.pid}-home-sweep-probe`);
  const modDir = join(stale, "go", "pkg", "mod", "example.com", "m@v1.0.0");
  mkdirSync(modDir, { recursive: true });
  writeFileSync(join(modDir, "go.mod"), "module example.com/m\n");
  chmodSync(modDir, 0o555);
  chmodSync(dirname(modDir), 0o555);
  try {
    const proc = Bun.spawn(["bun", "test", PROBE], {
      cwd: REPO_ROOT,
      env: { ...process.env, TMPDIR: dirname(testRoot) },
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
    expect(existsSync(stale)).toBe(false);
  } finally {
    if (existsSync(stale)) {
      Bun.spawnSync(["chmod", "-R", "u+w", stale]);
      rmSync(stale, { recursive: true, force: true });
    }
  }
}, 30_000);
