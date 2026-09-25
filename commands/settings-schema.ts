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
function lockAtRef(ref: string): Lock | Error {
  const verify = spawnSync("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { cwd: REPO_ROOT, encoding: "utf8" });
  if (verify.status !== 0) return new Error(`unknown git ref ${ref} (run git fetch origin?)`);
  const show = spawnSync("git", ["show", `${ref}:${LOCK_REL}`], { cwd: REPO_ROOT, encoding: "utf8" });
  return show.status === 0 ? (JSON.parse(show.stdout) as Lock) : {};
}

export async function settingsSchemaDiff(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const against = flagValue(args, "--against");
  const prev = against !== undefined
    ? (existsSync(against) ? (JSON.parse(readFileSync(against, "utf8")) as Lock) : {})
    : lockAtRef(flagValue(args, "--against-ref") ?? "origin/main");
  if (prev instanceof Error) {
    console.error(`rt settings schema diff: ${prev.message}`);
    process.exitCode = 1;
    return;
  }

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
