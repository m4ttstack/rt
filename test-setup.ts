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
import { afterAll, afterEach, beforeEach } from "bun:test";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "fs";
import { spawn } from "child_process";
import { tmpdir } from "os";
import { join } from "path";
import { guardTestDaemonEnv } from "./packages/rt-client/src/test-isolation.ts";
import { homeProblem } from "./lib/__tests__/home-env.ts";

// Before the HOME repoint, while HOME still names the real home: strips
// ambient live-daemon pointers (RT_DAEMON_SOCK is set in herdr panes and
// wins over HOME inside rtCommand) and forbids the real rt.sock for the
// whole run, including children spawned with a process.env spread.
guardTestDaemonEnv();

// `gh auth token` honors GH_TOKEN and the macOS keyring regardless of HOME, so
// the GitHub token fallback (lib/github-token.ts) needs its own off switch.
process.env.RT_GH_TOKEN_FALLBACK = "off";

// A pane spawned under a live daemon inherits its launchd MATTSTACK_FLAVOR,
// and a source run is dev by build; pin the prod app's flavor, the one every
// test assumes unless it sets its own.
process.env.MATTSTACK_FLAVOR = "prod";

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
  removeTree(join(testRoot, name));
}
const runTmp = mkdtempSync(join(testRoot, `${process.pid}-run-`));
const home = mkdtempSync(join(testRoot, `${process.pid}-home-`));
const socketDir = mkdtempSync(join(testRoot, `${process.pid}-sock-`));
process.env.TMPDIR = runTmp;
process.env.HOME = home;
process.env.RT_TEST_SOCKET_DIR = socketDir;
// A whole run's tree takes longer to delete than bun's 5s hook timeout, so
// a detached rm does it after the process exits. Go writes its module cache
// read-only, so a go build under this HOME needs the chmod first.
afterAll(() => {
  spawn("sh", ["-c", 'chmod -R u+w "$@" 2>/dev/null; exec rm -rf "$@"', "sh", runTmp, home, socketDir], {
    detached: true,
    stdio: "ignore",
  }).unref();
});

// A HOME left unset, "undefined" or relative sends every later HOME-derived
// path into the cwd (the repo checkout) or, via os.homedir(), the real home.
// This afterEach runs after the test's own afterEach hooks, so it fails the
// test that broke HOME. bun skips the remaining afterEach hooks once one
// throws, and an afterAll can break HOME too, so the beforeEach twin repairs
// what slipped past before the test runs. It must not throw: bun would then
// skip the file's beforeEach but still run its afterEach, which restores a
// HOME it never saved and fails every later test in the describe. It leaves
// the problem for this afterEach to report instead.
let brokenBeforeTest: string | null = null;
function repairHome(): string | null {
  const problem = homeProblem(process.env.HOME);
  if (problem) process.env.HOME = home;
  return problem;
}
beforeEach(() => {
  brokenBeforeTest = repairHome();
});
afterEach(() => {
  const inherited = brokenBeforeTest;
  brokenBeforeTest = null;
  const problem = repairHome();
  if (problem) throw new Error(`After this test: ${problem}. Restore it with restoreHome() from lib/__tests__/home-env.ts`);
  if (inherited) {
    throw new Error(`HOME was already broken when this test started (an afterAll, or an afterEach that threw, earlier): ${inherited}`);
  }
});

function removeTree(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {
    makeDirsWritable(path);
    rmSync(path, { recursive: true, force: true });
  }
}

function makeDirsWritable(path: string): void {
  if (!lstatSync(path).isDirectory()) return;
  chmodSync(path, 0o700);
  for (const name of readdirSync(path)) makeDirsWritable(join(path, name));
}

function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}
