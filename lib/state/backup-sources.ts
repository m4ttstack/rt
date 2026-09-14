import { join } from "path";
import { existsSync, mkdirSync } from "fs";
import { spawn } from "bun";
import { Database } from "bun:sqlite";
import { mattstackHome } from "../rt-paths";

export interface BackupSource {
  app: string;
  type: "sqlite" | "dir";
  sourcePath: string;
  ext: string;
}

export const BACKUP_SOURCES: BackupSource[] = [
  { app: "rt", type: "sqlite", sourcePath: "rt/state.db", ext: ".db" },
  { app: "rt", type: "sqlite", sourcePath: "rt/gates.db", ext: ".db" },
  { app: "board", type: "sqlite", sourcePath: "board/state.db", ext: ".db" },
  { app: "gitq", type: "dir", sourcePath: "gitq/stacks", ext: ".tar" },
];

export function backupDestDir(): string {
  return join(mattstackHome(), "user", "state-backups");
}

export function recipientsPath(): string {
  return join(backupDestDir(), "recipients.txt");
}

export function resolveSourcePath(source: BackupSource): string {
  return join(mattstackHome(), source.sourcePath);
}

export async function snapshotSource(
  source: BackupSource,
  destDir: string,
): Promise<string> {
  const fullPath = resolveSourcePath(source);
  const baseName = source.sourcePath.replace(/\//g, "-").replace(/\.[^.]+$/, "");
  const destPath = join(destDir, `${baseName}${source.ext}`);

  if (source.type === "sqlite") {
    const db = new Database(fullPath, { readonly: true });
    try {
      db.query("VACUUM INTO ?").run(destPath);
    } finally {
      db.close();
    }
  } else {
    const proc = spawn(["tar", "-cf", destPath, "-C", fullPath, "."], {
      stdout: "ignore",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`tar failed (exit ${exitCode}): ${stderr}`);
    }
  }

  return destPath;
}

export interface SnapshotResult {
  snapshots: Array<{ source: BackupSource; snapshotPath: string }>;
  errors: string[];
}

export async function snapshotAll(destDir: string): Promise<SnapshotResult> {
  mkdirSync(destDir, { recursive: true });
  const snapshots: Array<{ source: BackupSource; snapshotPath: string }> = [];
  const errors: string[] = [];

  for (const source of BACKUP_SOURCES) {
    const fullPath = resolveSourcePath(source);
    if (!existsSync(fullPath)) continue;

    try {
      const snapshotPath = await snapshotSource(source, destDir);
      snapshots.push({ source, snapshotPath });
    } catch (err) {
      errors.push(`${source.app}/${source.sourcePath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { snapshots, errors };
}
