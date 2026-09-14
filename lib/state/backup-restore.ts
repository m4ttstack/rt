/**
 * The reverse of backup-orchestrator's runFullBackup: pull the home repo,
 * decrypt+decompress the latest backup per source, integrity-check it, and
 * place it back at its live path.
 *
 * The `rt/` backup directory holds files for two distinct sources
 * (state.db and gates.db) sharing one app name, so `findLatestBackup` must
 * filter by the source's own filename prefix, not just its app directory --
 * a bare lexicographic "last file wins" pick can hand gates.db's slot
 * state.db's content or vice versa.
 */

import { dirname, join } from "path";
import { existsSync, readdirSync, mkdirSync, copyFileSync, rmSync } from "fs";
import { mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { Database } from "bun:sqlite";
import { mattstackHome } from "../rt-paths";
import { quickCheck } from "./db";
import { restorePipeline } from "./backup-pipeline";
import { backupDestDir, BACKUP_SOURCES, resolveSourcePath, type BackupSource } from "./backup-sources";

export interface RestoreOptions {
  identityPath: string;
  only?: string;
  at?: string;
  dryRun?: boolean;
}

export interface RestoreResult {
  restored: Array<{ app: string; targetPath: string }>;
  skipped: string[];
  errors: string[];
}

function sourcePrefixFor(source: BackupSource): string {
  return source.sourcePath.replace(/\//g, "-").replace(/\.[^.]+$/, "");
}

function findLatestBackup(appDir: string, sourcePrefix: string, atTimestamp?: string): string | null {
  if (!existsSync(appDir)) return null;
  const files = readdirSync(appDir)
    .filter((f) => f.endsWith(".zst.age") && f.startsWith(`${sourcePrefix}-`))
    .sort()
    .reverse();

  if (atTimestamp) {
    const match = files.find((f) => f.includes(atTimestamp));
    return match ? join(appDir, match) : null;
  }

  return files.length > 0 ? join(appDir, files[0]!) : null;
}

export async function restoreFromBackup(opts: RestoreOptions): Promise<RestoreResult> {
  const result: RestoreResult = { restored: [], skipped: [], errors: [] };
  const baseDir = backupDestDir();
  const tmpDir = await mkdtemp(join(tmpdir(), "state-restore-"));

  try {
    const sources = opts.only ? BACKUP_SOURCES.filter((s) => s.app === opts.only) : BACKUP_SOURCES;

    for (const source of sources) {
      const appDir = join(baseDir, source.app);
      const sourcePrefix = sourcePrefixFor(source);
      const backupFile = findLatestBackup(appDir, sourcePrefix, opts.at);

      if (!backupFile) {
        result.skipped.push(`${source.app}: no backup found`);
        continue;
      }

      const targetPath = resolveSourcePath(source);

      if (opts.dryRun) {
        result.restored.push({ app: source.app, targetPath });
        continue;
      }

      const restoredPath = join(tmpDir, `${sourcePrefix}${source.ext}`);

      try {
        await restorePipeline(backupFile, restoredPath, opts.identityPath);

        if (source.type === "sqlite") {
          const db = new Database(restoredPath, { readonly: true });
          let problems: string[];
          try {
            problems = quickCheck(db);
          } finally {
            db.close();
          }
          if (problems.length > 0) {
            result.errors.push(`${source.app}: integrity check failed: ${problems.join("; ")}`);
            continue;
          }

          mkdirSync(dirname(targetPath), { recursive: true });
          copyFileSync(restoredPath, targetPath);
          for (const ext of ["-wal", "-shm"]) {
            const sidecar = targetPath + ext;
            if (existsSync(sidecar)) rmSync(sidecar);
          }
          result.restored.push({ app: source.app, targetPath });
        } else {
          mkdirSync(targetPath, { recursive: true });
          const proc = Bun.spawnSync(["tar", "-xf", restoredPath, "-C", targetPath]);
          if (proc.exitCode !== 0) {
            result.errors.push(`${source.app}: tar extract failed: ${proc.stderr.toString()}`);
            continue;
          }
          result.restored.push({ app: source.app, targetPath });
        }
      } catch (err) {
        result.errors.push(`${source.app}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }

  return result;
}

/**
 * A new machine has no home repo checkout yet in most flows this ships
 * behind, but `rt home init` is the thing that clones it; this only pulls
 * an existing checkout current so the backup files it reads are the
 * latest, LFS objects included.
 */
export async function pullHomeRepo(): Promise<void> {
  const homeRepo = join(mattstackHome(), "user");

  let proc = Bun.spawnSync(["git", "pull", "--ff-only"], { cwd: homeRepo, stderr: "pipe" });
  if (proc.exitCode !== 0) {
    throw new Error(`git pull failed: ${proc.stderr.toString()}`);
  }

  proc = Bun.spawnSync(["git", "lfs", "pull"], { cwd: homeRepo, stderr: "pipe" });
  if (proc.exitCode !== 0) {
    throw new Error(`git lfs pull failed: ${proc.stderr.toString()}`);
  }
}
