import { homedir } from 'os';
import { join, resolve } from 'path';

/**
 * True when running as a bun-compiled standalone binary: import.meta.dir then
 * lives inside the embedded read-only /$bunfs filesystem, so nothing derived
 * from it is readable from disk or writable at all.
 */
export const IS_COMPILED = import.meta.dir.includes('$bunfs');

/**
 * Where the board's mutable companions live: config.json, .env, state/.
 *
 * Compiled (the distributed form) follows the mattstack runtime-state rule —
 * plain files under ~/.mattstack/<app>/ — rather than the process's cwd: a
 * launcher that forgets to set a working directory would otherwise point the
 * board at "/" and every state write would fail. From a checkout it stays the
 * repo root, so a dev checkout keeps its existing config.json and state/ in
 * place. BOARD_APP_ROOT overrides both (the bundle can pin an explicit home)
 * and only has to be set where the server runs: a launched pane derives the
 * board's root from the state path it is handed, not from its own environment.
 * The override is normalized because that derivation is, and the two are
 * compared by string equality; a trailing slash must not split them.
 * HOME is read at call time — Bun freezes os.homedir() at process start.
 */
function appRoot(): string {
  const override = process.env.BOARD_APP_ROOT;
  if (override) return resolve(override);
  if (!IS_COMPILED) return join(import.meta.dir, '..');
  return join(process.env.HOME ?? homedir(), '.mattstack', 'board');
}

export const APP_ROOT = appRoot();
