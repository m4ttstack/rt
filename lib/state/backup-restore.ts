import { basename, dirname, join } from "path";
import { existsSync, readdirSync, mkdirSync, renameSync, rmSync, copyFileSync } from "fs";
import { mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { Database } from "bun:sqlite";
import { mattstackHome } from "../rt-paths";
import { quickCheck } from "./db";
import { restorePipeline, restorePipelineFromStdin } from "./backup-pipeline";
import { backupDestDir, BACKUP_SOURCES, resolveSourcePath, type BackupSource } from "./backup-sources";

export interface RestoreOptions {
  identityPath?: string;
  identityKey?: string;
  only?: string;
  at?: string;
  dryRun?: boolean;
  force?: boolean;
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

function checkHolders(filePath: string): string[] {
  if (!existsSync(filePath)) return [];
  const proc = Bun.spawnSync(["lsof", "-t", filePath], { stderr: "pipe" });
  if (proc.exitCode !== 0) return [];
  const pids = proc.stdout.toString().trim();
  return pids ? pids.split("\n").map((p) => p.trim()).filter(Boolean) : [];
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
        if (opts.identityKey) {
          await restorePipelineFromStdin(backupFile, restoredPath, opts.identityKey);
        } else if (opts.identityPath) {
          await restorePipeline(backupFile, restoredPath, opts.identityPath);
        } else {
          result.errors.push(`${source.app}: no identity key or path provided`);
          continue;
        }

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

          if (!opts.force) {
            const holders = checkHolders(targetPath);
            if (holders.length > 0) {
              result.errors.push(`${source.app}: ${targetPath} is held open by pid(s) ${holders.join(", ")}. Stop those processes first, or pass --force.`);
              continue;
            }
          }

          mkdirSync(dirname(targetPath), { recursive: true });
          for (const ext of ["-wal", "-shm"]) {
            const sidecar = targetPath + ext;
            if (existsSync(sidecar)) rmSync(sidecar);
          }
          const tmpTarget = join(dirname(targetPath), `.${basename(targetPath)}.restore-tmp`);
          copyFileSync(restoredPath, tmpTarget);
          renameSync(tmpTarget, targetPath);
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

export async function pullHomeRepo(): Promise<{ pullOk: boolean; lfsOk: boolean }> {
  const homeRepo = join(mattstackHome(), "user");
  const result = { pullOk: true, lfsOk: true };

  let proc = Bun.spawnSync(["git", "pull", "--ff-only"], {
    cwd: homeRepo,
    stderr: "pipe",
    env: { ...process.env },
  });
  if (proc.exitCode !== 0) {
    console.error(`git pull failed (exit ${proc.exitCode}), continuing with local backups`);
    result.pullOk = false;
  }

  const gitLfs = Bun.which("git-lfs", { PATH: process.env.PATH });
  if (gitLfs) {
    proc = Bun.spawnSync(["git", "lfs", "pull"], {
      cwd: homeRepo,
      stderr: "pipe",
      env: { ...process.env },
    });
    if (proc.exitCode !== 0) {
      console.error(`git lfs pull failed (exit ${proc.exitCode}), continuing with local backups`);
      result.lfsOk = false;
    }
  }

  return result;
}
