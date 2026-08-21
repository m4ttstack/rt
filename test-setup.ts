/**
 * bun test preload (bunfig.toml). deck.platform (and deck.apps/deck.access,
 * later tasks) resolve through rt-client, which reads process.env.HOME at
 * call time -- a test file that never fakes HOME reads and writes the
 * developer's real ~/.mattstack. Repointing HOME before any module loads
 * makes that whole tree throwaway by default; a test file that fakes its own
 * HOME (for deterministic per-file store state) still overrides this.
 *
 * Exempt under LOCAL_E2E=1: test/e2e.smoke.test.ts drives real launchd
 * in-process (no subprocess boundary to carry a separate HOME across), so it
 * needs the genuine ~/Library/LaunchAgents this preload would otherwise hide.
 */
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

if (process.env.LOCAL_E2E !== "1") {
  process.env.HOME = mkdtempSync(join(tmpdir(), "local-test-home-"));
}
