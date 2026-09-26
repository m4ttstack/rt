import { realpathSync } from 'fs';
import { isAbsolute } from 'path';

import { runModeFromEnv, type RunMode } from '../api/state.ts';

export type DeployMode =
  | { kind: 'install' }
  | { kind: 'restart' }
  | { kind: 'refuse'; message: string };

/** A helper-owned deck lives inside a signed bundle, so deploy can never
    write a binary there; only a source-run deck (the dev bundle's shim) has
    something to make live, by restarting. A deploy the serving deck spawned
    inherits its DECK_RUN_MODE; one run from a terminal reads api.json. */
export function deployMode(
  helperOwned: boolean,
  env: Record<string, string | undefined>,
  recorded: { runMode: RunMode; runReason?: string } | null
): DeployMode {
  if (!helperOwned) return { kind: 'install' };
  const { runMode, runReason } = env.DECK_RUN_MODE
    ? runModeFromEnv(env)
    : (recorded ?? { runMode: 'standalone' as const });
  if (runMode === 'source') return { kind: 'restart' };
  if (runMode === 'pinned') {
    return {
      kind: 'refuse',
      message: `deck is running the pinned release because ${runReason ?? 'the dev shim could not run source'}; fix the checkout or bun, then restart deck`,
    };
  }
  return {
    kind: 'refuse',
    message:
      "the mattstack app owns deck here and its helper runs the bundle's pinned release, so `bun run deploy` has nothing to replace (in the dev app, the last `deck-dev-shim:` line in ~/.mattstack/deck/logs/deck.err.log says why source is not running; an older pinned release records no runMode, so this can also mean the shim fell back to the pin)",
  };
}

/** `thisDeckDir` is already realpath'd by the caller (it names the checkout
    the running process lives in, which always exists); `linkedDeckDir` is
    the raw dev.workingDirectory from the registry, resolved here so a stale
    or relative value refuses rather than throws. A restart against a source
    checkout deck does not serve installs into the wrong tree and reports
    success anyway. */
export function linkedCheckoutMismatch(
  thisDeckDir: string,
  linkedDeckDir: string | null | undefined
): string | null {
  const refuse = (linked: string) =>
    `deck serves ${linked}, not this checkout (${thisDeckDir}); deploy from there, or run \`deck register --dir ${thisDeckDir}\` first`;

  if (!linkedDeckDir) return refuse('no linked checkout');
  if (!isAbsolute(linkedDeckDir)) return refuse(linkedDeckDir);

  let resolvedLinked: string;
  try {
    resolvedLinked = realpathSync(linkedDeckDir);
  } catch {
    return refuse(linkedDeckDir);
  }
  return resolvedLinked === thisDeckDir ? null : refuse(linkedDeckDir);
}

export type RestartHealthzVerdict =
  | { kind: 'match'; runMode: string | null }
  | { kind: 'no-pid-header' }
  | { kind: 'pid-mismatch' };

/** Only decks built with the runMode headers ever send `x-deck-pid`; the
    only pin today (deck 1.0.6) predates them, so an ok response with no
    header at all is that pin actually serving, not a process to keep
    waiting on. A present header that names a different pid is the real
    "something else answered" case, worth retrying against the deadline. */
export function restartHealthzVerdict(
  headers: { get(name: string): string | null },
  expectedPid: number
): RestartHealthzVerdict {
  const pidHeader = headers.get('x-deck-pid');
  if (pidHeader === null) return { kind: 'no-pid-header' };
  if (pidHeader !== String(expectedPid)) return { kind: 'pid-mismatch' };
  return { kind: 'match', runMode: headers.get('x-deck-run-mode') };
}
