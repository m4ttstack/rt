/**
 * rt settings schema lock|diff: the lock file that pins every composite
 * key's JSON Schema. Dev-time verbs; they load zod, which the rest of rt
 * never does.
 */

import { existsSync, writeFileSync } from "fs";
import { buildLock, LOCK_PATH as DEFAULT_LOCK_PATH } from "../lib/settings/schema-lock.ts";

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
