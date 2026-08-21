import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// `homedir()` alone is frozen to whatever HOME was at process start -- Bun
// does not track later mutations of process.env.HOME through it, so a
// test's HOME fake (or any late reassignment) never moves it. `process.env.HOME
// ?? homedir()` reads the live env var first, per rt-client's paths.ts
// convention, falling back to `homedir()` only when HOME is unset entirely.
export function stateDir(): string {
  return process.env.LOCAL_STATE_DIR ?? join(process.env.HOME ?? homedir(), ".mattstack", "deck");
}

/** Where state lived before the Local -> Deck rename. Adoption source only. */
export function legacyStateDir(): string {
  return process.env.LOCAL_LEGACY_STATE_DIR ?? join(process.env.HOME ?? homedir(), ".mattstack", "local");
}

/**
 * Local -> Deck rename (ruled): a machine that ran the platform before this
 * rename has its whole state (registry, settings, logs, api.json) under the
 * pre-rename directory. Adopt it once, at boot, before anything reads or
 * writes stateDir() -- called from boot-env.ts, which is why this has to be
 * a plain function rather than something baked into stateDir() itself:
 * stateDir() is called many times over a process's life and must stay a
 * cheap, pure path computation, not repeat a filesystem check on every call.
 *
 * A rename is the simplest safe move here: both dirs are always siblings
 * under ~/.mattstack, i.e. the same filesystem, so it's atomic. Never
 * overwrites: a no-op whenever the new dir already exists, the legacy dir
 * doesn't, or they resolve to the same path.
 */
export function adoptLegacyStateDir(): void {
  const newDir = stateDir();
  const legacyDir = legacyStateDir();
  if (newDir === legacyDir) return;
  if (existsSync(newDir) || !existsSync(legacyDir)) return;
  renameSync(legacyDir, newDir);
}

export function logsDir(): string {
  return join(stateDir(), "logs");
}

/** Where the CLI finds a running platform. Written at serve boot. */
export function writeApiInfo(port: number): void {
  mkdirSync(stateDir(), { recursive: true });
  writeFileSync(join(stateDir(), "api.json"), JSON.stringify({ port, pid: process.pid }));
}

export function readApiInfo(): { port: number } | null {
  try {
    const parsed = JSON.parse(readFileSync(join(stateDir(), "api.json"), "utf8"));
    return Number.isInteger(parsed.port) ? { port: parsed.port } : null;
  } catch {
    return null;
  }
}
