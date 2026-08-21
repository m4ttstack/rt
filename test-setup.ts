/**
 * bun test preload (bunfig.toml). deck.platform (and deck.apps/deck.access,
 * later tasks) resolve through rt-client, which reads process.env.HOME at
 * call time -- a test file that never fakes HOME reads and writes the
 * developer's real ~/.mattstack. Repointing HOME before any module loads
 * makes that whole tree throwaway by default; a test file that fakes its own
 * HOME (for deterministic per-file store state) still overrides this.
 *
 * Safe for test/e2e.smoke.test.ts too, unconditionally: Bun resolves
 * os.homedir() once at process start, before this preload runs, so mutating
 * process.env.HOME here (or anywhere later) never moves the real
 * ~/Library/LaunchAgents path that test checks against -- only rt-client's
 * own env-based store paths move. That file sets its own HOME to isolate
 * rt-client the same way; launchd stays real either way.
 */
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

process.env.HOME = mkdtempSync(join(tmpdir(), "local-test-home-"));
