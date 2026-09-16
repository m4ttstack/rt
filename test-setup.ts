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
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { guardTestDaemonEnv } from "./packages/rt-client/src/test-isolation.ts";

// Before the HOME repoint, while HOME still names the real home: strips
// ambient live-daemon pointers (RT_DAEMON_SOCK is set in herdr panes and
// wins over HOME inside rtCommand) and forbids the real rt.sock for the
// whole run, including children spawned with a process.env spread.
guardTestDaemonEnv();

process.env.HOME = mkdtempSync(join(tmpdir(), "rt-test-home-"));
