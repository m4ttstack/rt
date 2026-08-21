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
 * (src/config.ts's RT_SECRETS_PATH, src/manifest-bindings.ts's default,
 * src/triage/notify.ts's TRAY_SOCK, src/herdr.ts's HERDR_BIN/SOCKET_PATH)
 * would land on the REAL home directory, not this fake one, no matter how
 * early this preload runs. Those call sites are unexercised by the current
 * suite (every test that touches them passes an explicit path/home override
 * instead), which is the only reason this preload is sufficient today -- a
 * new test that calls one of them for real must pass its own override, not
 * rely on this file.
 */
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

process.env.HOME = mkdtempSync(join(tmpdir(), "mr-board-test-home-"));
