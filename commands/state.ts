/**
 * rt state -- backup/restore rt's own state.db (R055).
 *
 *   rt state backup [--json]
 *   rt state restore <copy> [--json]
 *   rt state restore --from-backup [--only <app>] [--at <ts>] [--identity <path>] [--dry-run] [--json]
 *
 * `backup` writes a stamped VACUUM INTO copy under stateBackupsDir() and
 * prunes copies past the retention window. `restore` overwrites the live
 * state.db from a stamped copy (by filename or absolute path) after an
 * integrity check on the source; run it with the daemon stopped.
 *
 * `restore --from-backup` is the reverse of the encrypted pipeline in
 * backup-orchestrator.ts: pull the home repo (git + LFS), decrypt and
 * decompress the latest backup per source in BACKUP_SOURCES, integrity
 * check, and place. `--identity` supplies the team key on a machine whose
 * keychain has no age key yet (machine-loss recovery); without it, the
 * keychain key is used.
 */

import { Database } from "bun:sqlite";
import { copyFileSync, existsSync, mkdirSync, unlinkSync } from "fs";
import { dirname, join } from "path";
import type { CommandContext } from "../lib/command-tree.ts";
import { isDaemonRunning } from "../lib/daemon-client.ts";
import { flagValue } from "../lib/cli-args.ts";
import {
  backupTo,
  closeStateDb,
  getStateDb,
  listStateBackups,
  pruneStateBackups,
  quickCheck,
  stampedBackupPath,
  stateBackupsDir,
  stateDbPath,
} from "../lib/state/index.ts";
import { isBackupConfigured, pruneOldBackups, runFullBackup } from "../lib/state/backup-orchestrator.ts";
import { pullHomeRepo, restoreFromBackup } from "../lib/state/backup-restore.ts";
import { createRealAgeKeySeam, readAgeKey } from "../lib/home/age-key.ts";

function fail(msg: string): never {
  console.error(`rt state: ${msg}`);
  process.exit(1);
}

function copyArg(args: string[]): string | undefined {
  return args.find((a) => !a.startsWith("--"));
}

async function pickBackup(names: readonly string[]): Promise<string | null> {
  const { filterableSelect } = await import("../lib/pick-wrappers.ts");
  return filterableSelect({
    message: "Restore which state.db backup?",
    options: names.map((name) => ({ value: name, label: name })),
    stderr: true,
  });
}

/** The positional, or a TTY pick over existing stamped copies; the existing `fail` otherwise (no TTY, --json, RT_BATCH, or nothing to pick from). */
async function requireCopy(args: string[], usage: string): Promise<string> {
  const c = copyArg(args);
  if (c) return c;
  const names = listStateBackups();
  if (names.length > 0 && process.stdin.isTTY && !args.includes("--json") && !process.env.RT_BATCH) {
    const picked = await pickBackup(names);
    if (!picked) process.exit(0);
    return picked;
  }
  fail(usage);
}

export async function stateBackup(args: string[], _ctx: CommandContext = {}): Promise<void> {
  const json = args.includes("--json");
  const local = args.includes("--local");

  if (local) {
    const path = stampedBackupPath();
    backupTo(getStateDb(), path);
    const { removed } = pruneStateBackups();

    if (json) {
      console.log(JSON.stringify({ ok: true, path, pruned: removed }));
      return;
    }
    console.log(`rt state backup: wrote ${path}`);
    if (removed.length > 0) console.log(`rt state backup: pruned ${removed.length} old backup(s)`);
    return;
  }

  if (!isBackupConfigured()) {
    console.error("Backup not configured. Run `rt state backup init` to set up encrypted backup.");
    console.error("Use --local for a local-only unencrypted backup.");
    process.exit(1);
  }

  try {
    const result = await runFullBackup();

    if (result.backed.length === 0 && result.skipped.length === 0 && result.errors.length > 0) {
      if (!json) {
        console.error(`All sources failed: ${result.errors.join(", ")}`);
        console.error("Falling back to local-only backup");
      }
      const path = stampedBackupPath();
      backupTo(getStateDb(), path);
      const { removed } = pruneStateBackups();
      if (json) {
        console.log(JSON.stringify({ ok: true, fallback: "local", path, pruned: removed, errors: result.errors }));
      }
      return;
    }

    const { removed } = await pruneOldBackups();

    if (json) {
      console.log(JSON.stringify({ ...result, pruned: removed.length }));
    } else {
      for (const b of result.backed) {
        console.log(`  ${b.app}: ${b.sizeBytes} bytes`);
      }
      if (result.errors.length > 0) {
        console.error(`Errors: ${result.errors.join(", ")}`);
      }
      if (removed.length > 0) {
        console.log(`Pruned ${removed.length} old backup(s)`);
      }
    }
  } catch (err) {
    if (!json) {
      console.error(`Encrypted backup failed: ${err instanceof Error ? err.message : err}`);
      console.error("Falling back to local-only backup");
    }
    const path = stampedBackupPath();
    backupTo(getStateDb(), path);
    const { removed } = pruneStateBackups();
    if (json) {
      console.log(JSON.stringify({ ok: true, fallback: "local", path, pruned: removed, error: String(err) }));
    }
  }
}

/**
 * `--from-backup` is a distinct pipeline from the plain positional-copy
 * restore above (pull, decrypt, decompress, integrity check, place per
 * source in BACKUP_SOURCES) rather than a variant of it, so it returns
 * before any of the stamped-local-copy logic below runs.
 */
async function stateRestoreFromBackup(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const force = args.includes("--force");
  const dryRun = args.includes("--dry-run");
  const only = flagValue(args, "--only");
  const at = flagValue(args, "--at");
  const identityFlag = flagValue(args, "--identity");

  if (!force && (await isDaemonRunning())) {
    fail("the daemon is running. Stop it first (rt daemon stop) or pass --force to override");
  }

  let identityPath: string | undefined;
  let identityKey: string | undefined;

  if (identityFlag) {
    identityPath = identityFlag;
  } else {
    const keyResult = await readAgeKey(createRealAgeKeySeam());
    if (!("key" in keyResult)) {
      console.error("rt state restore: no age key found in the keychain.");
      console.error("On a new machine, pass --identity <path-to-team-key> to decrypt with the team key.");
      process.exit(1);
    }
    identityKey = keyResult.key;
  }

  if (!dryRun) {
    console.log("Pulling latest backups from home repo...");
    await pullHomeRepo();
    closeStateDb();
  }

  const result = await restoreFromBackup({
    identityPath,
    identityKey,
    only,
    at,
    dryRun,
    force,
  });

  if (json) {
    console.log(JSON.stringify({ ok: result.errors.length === 0, dryRun, ...result }));
    if (result.errors.length > 0) process.exitCode = 1;
    return;
  }

  if (dryRun) console.log("Dry run. Would restore:");
  for (const r of result.restored) console.log(`  ${r.app} -> ${r.targetPath}`);
  for (const s of result.skipped) console.log(`  skipped: ${s}`);
  for (const e of result.errors) console.error(`  error: ${e}`);
  if (result.errors.length > 0) process.exitCode = 1;
}

export async function stateRestore(args: string[], _ctx: CommandContext = {}): Promise<void> {
  if (args.includes("--from-backup")) {
    return stateRestoreFromBackup(args);
  }

  const json = args.includes("--json");
  const force = args.includes("--force");

  // state.db is WAL-mode and shared live with the daemon: copyFileSync over
  // it plus deleting its -wal/-shm sidecars while the daemon holds it open
  // can corrupt the live db, not just this CLI's view of it. A deterministic
  // refusal, never an interactive prompt, so non-TTY/agent callers get a
  // clean nonzero exit instead of a hang.
  if (!force && (await isDaemonRunning())) {
    fail("the daemon is running; state.db is shared with it. Stop it first (rt daemon stop) or pass --force to override");
  }

  const copy = await requireCopy(args, "usage: rt state restore <copy> [--json]");

  const source = existsSync(copy) ? copy : join(stateBackupsDir(), copy);
  if (!existsSync(source)) fail(`backup not found: ${copy}`);

  const probe = new Database(source, { readonly: true });
  let problems: string[];
  try {
    problems = quickCheck(probe);
  } finally {
    probe.close();
  }
  if (problems.length > 0) fail(`${source} fails integrity check: ${problems.join("; ")}`);

  closeStateDb();
  const dest = stateDbPath();
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(source, dest);
  for (const sidecar of [`${dest}-wal`, `${dest}-shm`]) {
    try {
      unlinkSync(sidecar);
    } catch {
      // sidecar absent: a plain copy (no WAL) leaves nothing to clean up
    }
  }

  if (json) {
    console.log(JSON.stringify({ ok: true, restored: dest, from: source }));
    return;
  }
  console.log(`rt state restore: restored state.db from ${source}`);
}
