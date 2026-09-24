#!/usr/bin/env bun
/**
 * Rebuild /Applications/mattstack-dev.app from a pushed ref of m4ttstack/rt
 * and relaunch it: the dev-bundle leg of `rt release update-machine`, alone.
 *
 *   bun scripts/build-dev-app.ts [--ref <branch|tag|sha>] [--yes]
 *
 * --ref defaults to main. Without --yes it prints what it would do and
 * exits. The build runs in a scratch clone, never in a checkout's rt-tray/,
 * so the ref must be pushed. The running dev app is killed, moved aside, and
 * replaced; helper jobs it supervises (deck, the daemon) keep their current
 * process until they restart.
 */
import { rmSync } from "fs";
import { createRealUpdateMachineSeams } from "../commands/release.ts";
import { flagValue } from "../lib/cli-args.ts";
import { UserActionableError } from "../lib/setup/errors.ts";
import { runDevAppRebuild } from "../lib/release/update-machine.ts";

const USAGE = "usage: bun scripts/build-dev-app.ts [--ref <branch|tag|sha>] [--yes]";
const args = process.argv.slice(2);
let ref: string;
try {
  ref = flagValue(args, "--ref") ?? "main";
} catch {
  console.error(USAGE);
  process.exit(2);
}

if (!args.includes("--yes")) {
  console.log(
    `would rebuild /Applications/mattstack-dev.app from m4ttstack/rt ${ref} in a scratch clone, kill and replace the running dev app, and relaunch it; pass --yes to do it`,
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
