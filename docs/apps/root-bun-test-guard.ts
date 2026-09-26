/**
 * Preload for a bare `bun test` run at the repo root (root bunfig.toml).
 * Bun reads bunfig.toml from the cwd only, so every app and package script
 * cds in and gets its own preload; this file runs only for the unsanctioned
 * root invocation, which discovers every app's tests with none of their
 * preloads. Those suites rely on their preload to repoint HOME and the board's
 * state root, so without this a root run reads and writes the developer's live
 * ~/.mattstack and the board's live state/. Tests may still fail from the root;
 * this only guarantees they fail without touching live state.
 */
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll } from 'bun:test';

import { guardTestDaemonEnv } from '@mattstack/rt-client';

// Must run while HOME still names the real home: an ambient RT_DAEMON_SOCK
// outranks HOME, so the scrub has to happen before the repoint below.
guardTestDaemonEnv();

const testHome = mkdtempSync(join(tmpdir(), 'mattstack-apps-root-test-home-'));
const testBoardRoot = mkdtempSync(
  join(tmpdir(), 'mattstack-apps-root-test-board-')
);
process.env.HOME = testHome;
process.env.BOARD_APP_ROOT = testBoardRoot;

// Not process.on('exit'): bun test fires neither exit nor beforeExit. A
// preload's afterAll runs once, after every file.
afterAll(() => {
  rmSync(testHome, { recursive: true, force: true });
  rmSync(testBoardRoot, { recursive: true, force: true });
});
