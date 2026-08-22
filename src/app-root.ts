import { join } from "path";

/**
 * True when running as a bun-compiled standalone binary: import.meta.dir then
 * lives inside the embedded read-only /$bunfs filesystem, so nothing derived
 * from it is readable from disk or writable at all.
 */
export const IS_COMPILED = import.meta.dir.includes("$bunfs");

/**
 * Where the board's mutable companions (.env, state/) live. From a checkout
 * that is the repo root, as always. The compiled binary has no repo — its
 * working directory is the app root, so the launcher (launchd via the deck
 * record, or a shell) picks the state home by picking the cwd.
 */
export const APP_ROOT = IS_COMPILED ? process.cwd() : join(import.meta.dir, "..");
