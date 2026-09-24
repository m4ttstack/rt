#!/usr/bin/env bun
/**
 * Rebuild the dev app, two ways:
 *
 *   bun scripts/build-dev-app.ts --local [--yes]
 *     Build this working tree (uncommitted changes included) and stage it.
 *     The running mattstack-dev shows "New build · Restart"; clicking it swaps
 *     the staged build into /Applications and relaunches.
 *
 *   bun scripts/build-dev-app.ts [--ref <branch|tag|sha>] [--yes]
 *     Rebuild /Applications/mattstack-dev.app from a pushed ref of
 *     m4ttstack/rt (default main) and relaunch it now: the dev-bundle leg of
 *     `rt release update-machine`, alone.
 *
 * Without --yes either form prints what it would do and exits. Builds run in
 * a scratch copy, never in a checkout's rt-tray/.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { homedir, tmpdir } from "os";
import { dirname, join } from "path";
import { createRealUpdateMachineSeams } from "../commands/release.ts";
import { UserActionableError } from "../lib/setup/errors.ts";
import { runCapture } from "../lib/subprocess.ts";
import { devAppStagePaths, stageLocalDevApp } from "../lib/release/dev-app-stage.ts";
import { assertDevAppRef, runDevAppRebuild } from "../lib/release/update-machine.ts";

const USAGE = "usage: bun scripts/build-dev-app.ts [--local | --ref <branch|tag|sha>] [--yes]";

// Every argument is accounted for: an unrecognized one (a typo'd flag) would
// otherwise let a --yes run rebuild main instead of the ref that was meant.
function parseArgs(argv: string[]): { ref: string | null; local: boolean; yes: boolean } | null {
  let ref: string | null = null;
  let local = false;
  let yes = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--yes") yes = true;
    else if (a === "--local") local = true;
    else if (a === "--ref" && argv[i + 1] !== undefined && !argv[i + 1]!.startsWith("--")) ref = argv[++i]!;
    else if (a.startsWith("--ref=")) ref = a.slice("--ref=".length);
    else return null;
  }
  if (local && ref !== null) return null;
  return { ref, local, yes };
}

const parsed = parseArgs(process.argv.slice(2));
if (!parsed) {
  console.error(USAGE);
  process.exit(2);
}

if (parsed.local) {
  if (!parsed.yes) {
    console.log(
      `would build this working tree (uncommitted changes included) and stage it at ${devAppStagePaths(homedir()).stagedDir}; mattstack-dev then offers "New build · Restart"; pass --yes to do it`,
    );
    process.exit(0);
  }
  const scratch = mkdtempSync(join(tmpdir(), "rt-dev-app-local-"));
  let code = 1;
  try {
    const { stamp, stagedPath } = await stageLocalDevApp(
      {
        home: homedir(),
        now: () => new Date(),
        scratchDir: () => scratch,
        pathExists: existsSync,
        writeFile: (path, content) => {
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, content);
        },
        // The build step streams, so a terminal or the tray's build log shows
        // progress for the minutes it runs; its errors are already on screen.
        exec: async (argv, opts) => {
          if (!argv.includes("rt-tray/build.sh")) return runCapture(argv, { stderr: "pipe", timeoutMs: 600_000, ...opts });
          const proc = Bun.spawn(argv, { cwd: opts?.cwd, stdout: "inherit", stderr: "inherit" });
          return { stdout: "", stderr: "", exitCode: await proc.exited };
        },
      },
      process.cwd(),
    );
    console.log(`✓ staged ${stagedPath} (${stamp}); restart it from mattstack-dev's "New build · Restart"`);
    code = 0;
  } catch (err) {
    if (!(err instanceof UserActionableError)) throw err;
    console.error(`✗ ${err.message}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  process.exit(code);
}

const ref = parsed.ref ?? "main";
try {
  assertDevAppRef(ref);
} catch (err) {
  console.error(`✗ ${(err as Error).message}`);
  process.exit(2);
}

if (!parsed.yes) {
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
