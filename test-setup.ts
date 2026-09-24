/**
 * bun test preload (bunfig.toml). Every rt path resolves through
 * process.env.HOME at call time (rt-paths.ts), but a lazy singleton like
 * getDaemonLogger binds to whatever HOME is at its FIRST call — and unit
 * tests that never fake HOME were landing mock errors in the developer's
 * real ~/.mattstack/rt/logs/daemon.*.log. Repointing HOME before any module loads
 * makes the whole ~/.mattstack/rt tree throwaway for every test process. Tests that
 * fake HOME per-test keep doing so on top of this; e2e fixtures pass their
 * own explicit HOME when spawning the binary, so this never reaches them.
 */
import { afterAll } from "bun:test";
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "fs";
import { spawn } from "child_process";
import { tmpdir } from "os";
import { join } from "path";
import { guardTestDaemonEnv } from "./packages/rt-client/src/test-isolation.ts";

// Before the HOME repoint, while HOME still names the real home: strips
// ambient live-daemon pointers (RT_DAEMON_SOCK is set in herdr panes and
// wins over HOME inside rtCommand) and forbids the real rt.sock for the
// whole run, including children spawned with a process.env spread.
guardTestDaemonEnv();

// `gh auth token` honors GH_TOKEN and the macOS keyring regardless of HOME, so
// the GitHub token fallback (lib/github-token.ts) needs its own off switch.
process.env.RT_GH_TOKEN_FALLBACK = "off";

// Every run gets its own directory under one shared parent, and TMPDIR
// points into it, so nothing a test (or a child it spawns) makes under
// tmpdir() lands in the machine's TMPDIR: hundreds of thousands of leftover
// mkdtemp dirs there once made every file create on the machine slow. HOME
// and the termwright socket dir are siblings, not nested: a per-test home
// under TMPDIR is already too deep for a Unix socket path (macOS caps it
// at 104 bytes; e2e/socket-path.ts). bun test never fires process "exit",
// so removal is a global afterAll; a run killed before it leaves its dirs
// behind, and the next start sweeps every dir whose run pid is gone.
const testRoot = join(tmpdir(), "rt-tests");
mkdirSync(testRoot, { recursive: true, mode: 0o700 });
const rootStat = lstatSync(testRoot);
if (!rootStat.isDirectory() || rootStat.uid !== process.getuid?.()) {
  throw new Error(`${testRoot} is not a directory this user owns; refusing to sweep it`);
}
for (const name of readdirSync(testRoot)) {
  const pid = Number(name.split("-")[0]);
  if (Number.isInteger(pid) && pid > 0 && pidIsAlive(pid)) continue;
  rmSync(join(testRoot, name), { recursive: true, force: true });
}
const runTmp = mkdtempSync(join(testRoot, `${process.pid}-run-`));
const home = mkdtempSync(join(testRoot, `${process.pid}-home-`));
const socketDir = mkdtempSync(join(testRoot, `${process.pid}-sock-`));
process.env.TMPDIR = runTmp;
process.env.HOME = home;
process.env.RT_TEST_SOCKET_DIR = socketDir;
// A whole run's tree takes longer to delete than bun's 5s hook timeout, so
// a detached rm does it after the process exits.
afterAll(() => {
  spawn("rm", ["-rf", runTmp, home, socketDir], { detached: true, stdio: "ignore" }).unref();
});

function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}
