/**
 * rt settings schema lock|diff: the lock file that pins every composite
 * key's JSON Schema. Dev-time verbs; they load zod, which the rest of rt
 * never does.
 */

import { spawnSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { buildLock, checkLockAgainst, classifyLockDiff, LOCK_PATH as DEFAULT_LOCK_PATH, readBreakingChanges, type Lock } from "../lib/settings/schema-lock.ts";

const LOCK_REL = "packages/rt-client/src/settings/schema.lock.json";
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

function flagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

export async function settingsSchemaLock(args: string[], deps: { lockPath?: string } = {}): Promise<void> {
  const LOCK_PATH = deps.lockPath ?? DEFAULT_LOCK_PATH;
  const out = flagValue(args, "--out") ?? LOCK_PATH;
  // A compiled rt resolves LOCK_PATH inside its own bundle (/$bunfs/...), where the lock
  // file is absent and nothing can be written; from source the committed file exists.
  if (out === LOCK_PATH && (LOCK_PATH.startsWith("/$bunfs/") || !existsSync(LOCK_PATH))) {
    console.error("rt settings schema lock: run from source (bun run cli.ts settings schema lock); the compiled binary has no checkout to write into");
    process.exitCode = 1;
    return;
  }
  writeFileSync(out, `${JSON.stringify(buildLock(), null, 2)}\n`);
  console.log(out);
}

/** A ref with no lock file is `{}`; a ref git cannot resolve is an error, never a silent pass. */
function lockAtRef(ref: string, repoRoot: string): Lock | Error {
  const verify = spawnSync("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { cwd: repoRoot, encoding: "utf8" });
  if (verify.status !== 0) return new Error(`unknown git ref ${ref} (run git fetch origin?)`);
  const show = spawnSync("git", ["show", `${ref}:${LOCK_REL}`], { cwd: repoRoot, encoding: "utf8" });
  return show.status === 0 ? (JSON.parse(show.stdout) as Lock) : {};
}

function lockAtPath(path: string): Lock {
  if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8")) as Lock;
  console.error(`rt settings schema diff: ${path} does not exist; diffing against an empty lock`);
  return {};
}

export async function settingsSchemaDiff(args: string[], deps: { repoRoot?: string } = {}): Promise<void> {
  const repoRoot = deps.repoRoot ?? REPO_ROOT;
  const fail = (message: string) => {
    console.error(`rt settings schema diff: ${message}`);
    process.exitCode = 1;
  };
  // A compiled rt diffs its own bundled registry and has no checkout for git to read.
  if (repoRoot.startsWith("/$bunfs/")) return fail("run from source (bun run cli.ts settings schema diff); the compiled binary has no checkout to diff");
  const json = args.includes("--json");
  const against = flagValue(args, "--against");
  const againstRef = flagValue(args, "--against-ref");
  if (against !== undefined && againstRef !== undefined) return fail("pass --against <file> or --against-ref <ref>, not both");
  const prev = against !== undefined ? lockAtPath(against) : lockAtRef(againstRef ?? "origin/main", repoRoot);
  if (prev instanceof Error) return fail(prev.message);

  const next = buildLock();
  const changes = classifyLockDiff(prev, next);
  const { ok, problems } = checkLockAgainst(prev, next, readBreakingChanges());
  if (json) {
    console.log(JSON.stringify({ ok, changes, problems }, null, 2));
  } else if (changes.length === 0) {
    console.log("no schema changes");
  } else {
    for (const c of changes) console.log(`${c.kind.padEnd(8)} ${c.key}  ${c.detail}`);
    for (const p of problems) console.log(`problem: ${p}`);
  }
  if (!ok) process.exitCode = 1;
}
