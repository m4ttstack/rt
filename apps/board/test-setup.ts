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
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

import { guardTestDaemonEnv } from '@mattstack/rt-client';

// Before the HOME repoint, while HOME still names the real home: an ambient
// RT_DAEMON_SOCK (herdr panes) wins over HOME inside rtCommand, so without
// this scrub the suite dispatches at the developer's LIVE rt daemon. Also
// arms RT_TEST_FORBID_SOCKS, which makes rtCommand throw on a live socket.
guardTestDaemonEnv();

process.env.HOME = mkdtempSync(join(tmpdir(), 'mr-board-test-home-'));

/**
 * Same hazard, second root: the board writes every state file (review,
 * respond and doctor state, the agent-status cursor) under APP_ROOT, which
 * from a checkout is the repo itself. A test that boots the real server
 * without overriding this writes into the repo's own state/, which a
 * developer's live board reads. Repointing the root by default makes that
 * impossible rather than merely discouraged; a test that needs the repo's
 * own state/ must now say so explicitly.
 */
process.env.BOARD_APP_ROOT = mkdtempSync(join(tmpdir(), 'mr-board-test-root-'));

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
