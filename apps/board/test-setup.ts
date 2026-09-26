/**
 * bun test preload (bunfig.toml). @mattstack/rt-client's settings resolver
 * (used by the board's secrets loaders, and by the settings migration this
 * preload guards) reads process.env.HOME at call time -- a test file that
 * never fakes HOME reads and writes the developer's real ~/.mattstack.
 * Repointing HOME before any module loads makes that whole tree throwaway by
 * default; a test file that fakes its own HOME (for deterministic per-file
 * store state) still overrides this.
 *
 * Belt and braces: `os.homedir()` is frozen at process start -- any code path
 * that still falls through to bare `homedir()` instead of `process.env.HOME`
 * (src/manifest-bindings.ts's default, src/triage/notify.ts's TRAY_SOCK,
 * src/herdr.ts's HERDR_BIN/SOCKET_PATH) would land on the REAL home
 * directory, not this fake one, no matter how early this preload runs.
 * Those call sites are unexercised by the current suite (every test that
 * touches them passes an explicit path/home override instead), which is the
 * only reason this preload is sufficient today -- a new test that calls one
 * of them for real must pass its own override, not rely on this file.
 */
import { spawn } from 'child_process';
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll } from 'bun:test';

import { guardTestDaemonEnv } from '@mattstack/rt-client';

// Before the HOME repoint, while HOME still names the real home: an ambient
// RT_DAEMON_SOCK (herdr panes) wins over HOME inside rtCommand, so without
// this scrub the suite dispatches at the developer's LIVE rt daemon. Also
// arms RT_TEST_FORBID_SOCKS, which makes rtCommand throw on a live socket.
guardTestDaemonEnv();

// Every run gets its own directories under one shared parent, and TMPDIR
// points into the run's, so nothing a test (or a child it spawns) makes
// under tmpdir() lands in the machine's TMPDIR: hundreds of thousands of
// leftover mkdtemp dirs there once made every file create on the machine
// slow. HOME is a sibling, not nested, to keep socket paths under it inside
// macOS's 104 bytes. bun test never fires process "exit", so removal starts in
// a global afterAll; a run killed before it leaves its dirs behind, and the
// next start sweeps every dir whose run pid is gone.
const testRoot = join(tmpdir(), 'mr-board-tests');
mkdirSync(testRoot, { recursive: true, mode: 0o700 });
const rootStat = lstatSync(testRoot);
if (!rootStat.isDirectory() || rootStat.uid !== process.getuid?.()) {
  throw new Error(
    `${testRoot} is not a directory this user owns; refusing to sweep it`
  );
}
for (const name of readdirSync(testRoot)) {
  const pid = Number(name.split('-')[0]);
  if (Number.isInteger(pid) && pid > 0 && pidIsAlive(pid)) continue;
  rmSync(join(testRoot, name), { recursive: true, force: true });
}
const runTmp = mkdtempSync(join(testRoot, `${process.pid}-run-`));
const runHome = mkdtempSync(join(testRoot, `${process.pid}-home-`));
process.env.TMPDIR = runTmp;
// A whole run's tree takes longer to delete than bun's 5s hook timeout, so
// a detached rm does it after the process exits.
afterAll(() => {
  spawn('rm', ['-rf', runTmp, runHome], {
    detached: true,
    stdio: 'ignore',
  }).unref();
});

function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

process.env.HOME = runHome;

/**
 * Same hazard, second root: the board writes every state file (review,
 * respond and doctor state, the agent-status cursor) under APP_ROOT, which
 * from a checkout is the repo itself. A test that boots the real server
 * without overriding this writes into the repo's own state/, which a
 * developer's live board reads. Repointing the root by default makes that
 * impossible rather than merely discouraged; a test that needs the repo's
 * own state/ must now say so explicitly.
 */
process.env.BOARD_APP_ROOT = mkdtempSync(join(runTmp, 'mr-board-test-root-'));

/**
 * Third hazard, same shape: react-dom decides once, at first import, whether
 * the DOM it sees supports the native `input` event -- `canUseDOM` and
 * `isInputEventSupported` are computed at module top level and cached for
 * the process, never re-checked. A DOM test file that imports `react-dom`
 * (even transitively, through a component import) before calling its own
 * `GlobalRegistrator.register()` makes that first check run with no
 * `document` at all, latching `isInputEventSupported` to false for every
 * later file: typed input then only reaches React on the next unrelated
 * event (focus/keyup polling), landing state updates a whole render behind
 * a same-tick keydown. Importing `react-dom/client` here, inside a
 * register/unregister bracket, forces the real check to run once against a
 * genuine `document` before any test file's own import order can race it.
 */
GlobalRegistrator.register({ url: 'http://localhost/' });
await import('react-dom/client');
await GlobalRegistrator.unregister();
