#!/usr/bin/env bun
/**
 * Rebuild /Applications/mattstack-dev.app from a pushed ref of m4ttstack/rt
 * and relaunch it: the dev-bundle leg of `rt release update-machine`, alone.
 *
 *   bun scripts/build-dev-app.ts [--ref <branch|tag|sha>] [--yes]
 *
 * --ref defaults to main. Without --yes it prints what it would do and
 * exits. The build runs in a scratch clone, never in a checkout's rt-tray/,
 * so the ref must be pushed. The running dev app is killed, moved aside,
 * replaced and reopened, then the deck helper is kickstarted so it runs the
 * new bundle's Helpers/deck.
 */
import { rmSync } from "fs";
import { createRealUpdateMachineSeams } from "../commands/release.ts";
import { UserActionableError } from "../lib/setup/errors.ts";
import { assertDevAppRef, runDevAppRebuild } from "../lib/release/update-machine.ts";

const USAGE = "usage: bun scripts/build-dev-app.ts [--ref <branch|tag|sha>] [--yes]";

// Every argument is accounted for: an unrecognized one (a typo'd flag) would
// otherwise let a --yes run rebuild main instead of the ref that was meant.
function parseArgs(argv: string[]): { ref: string; yes: boolean } | null {
  let ref = "main";
  let yes = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--yes") yes = true;
    else if (a === "--ref" && argv[i + 1] !== undefined && !argv[i + 1]!.startsWith("--")) ref = argv[++i]!;
    else if (a.startsWith("--ref=")) ref = a.slice("--ref=".length);
    else return null;
  }
  return { ref, yes };
}

const parsed = parseArgs(process.argv.slice(2));
if (!parsed) {
  console.error(USAGE);
  process.exit(2);
}
const { ref, yes } = parsed;
try {
  assertDevAppRef(ref);
} catch (err) {
  console.error(`✗ ${(err as Error).message}`);
  process.exit(2);
}

if (!yes) {
  console.log(
    `would rebuild /Applications/mattstack-dev.app from m4ttstack/rt ${ref} in a scratch clone, kill and replace the running dev app, relaunch it, and restart the deck helper; pass --yes to do it`,
  );
  process.exit(0);
}

const seams = await createRealUpdateMachineSeams({});
let code = 1;
try {
  const { sha, result } = await runDevAppRebuild(seams, ref);
  console.log(`${result.status === "ok" ? "✓" : "✗"} ${result.label} (${ref} at ${sha.slice(0, 12)}): ${result.detail}`);
  code = result.status === "ok" ? 0 : 1;
} catch (err) {
  if (!(err instanceof UserActionableError)) throw err;
  console.error(`✗ ${err.message}`);
} finally {
  rmSync(seams.workDir, { recursive: true, force: true });
}
process.exit(code);
