import { join, basename } from "path";
import { mkdirSync, existsSync, readdirSync, statSync, unlinkSync, rmSync } from "fs";
import { mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { mattstackHome } from "../rt-paths";
import {
  snapshotAll,
  backupDestDir,
  recipientsPath,
  type BackupSource,
} from "./backup-sources";
import { backupPipeline } from "./backup-pipeline";

export interface BackupResult {
  backed: Array<{ app: string; path: string; sizeBytes: number }>;
  skipped: string[];
  errors: string[];
}

export function isBackupConfigured(): boolean {
  return existsSync(recipientsPath());
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export async function runFullBackup(): Promise<BackupResult> {
  const result: BackupResult = { backed: [], skipped: [], errors: [] };
  const recip = recipientsPath();

  if (!existsSync(recip)) {
    throw new Error(
      "Backup not configured. Run `rt state backup init` first.",
    );
  }

  const tmpDir = await mkdtemp(join(tmpdir(), "state-backup-"));

  try {
    const snapshots = await snapshotAll(tmpDir);
    const ts = timestamp();

    for (const { source, snapshotPath } of snapshots) {
      const appDir = join(backupDestDir(), source.app);
      mkdirSync(appDir, { recursive: true });

      const baseName = source.sourcePath.replace(/\//g, "-").replace(/\.[^.]+$/, "");
      const destName = `${baseName}-${ts}${source.ext}.zst.age`;
      const destPath = join(appDir, destName);

      try {
        await backupPipeline(snapshotPath, destPath, recip);
        const size = statSync(destPath).size;
        result.backed.push({ app: source.app, path: destPath, sizeBytes: size });
      } catch (err) {
        result.errors.push(
          `${source.app}/${basename(source.sourcePath)}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }

  return result;
}

const RETENTION_MS_PER_DAY = 24 * 60 * 60 * 1000;

export async function pruneOldBackups(
  retentionDays: number = 7,
): Promise<{ removed: string[] }> {
  const removed: string[] = [];
  const cutoff = Date.now() - retentionDays * RETENTION_MS_PER_DAY;
  const baseDir = backupDestDir();

  for (const app of ["rt", "board", "gitq"]) {
    const appDir = join(baseDir, app);
    if (!existsSync(appDir)) continue;

    for (const file of readdirSync(appDir)) {
      if (!file.endsWith(".zst.age")) continue;
      const filePath = join(appDir, file);
      const mtime = statSync(filePath).mtimeMs;
      if (mtime < cutoff) {
        unlinkSync(filePath);
        removed.push(filePath);
      }
    }
  }

  // Prune local LFS cache for orphaned objects
  if (removed.length > 0) {
    const homeRepo = join(mattstackHome(), "user");
    if (existsSync(join(homeRepo, ".git"))) {
      Bun.spawnSync(["git", "lfs", "prune"], { cwd: homeRepo, stderr: "pipe" });
    }
  }

  return { removed };
}
