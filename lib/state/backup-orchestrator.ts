import { join, basename } from "path";
import { mkdirSync, existsSync, readdirSync, statSync, unlinkSync, rmSync, writeFileSync, readFileSync } from "fs";
import { mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { Database } from "bun:sqlite";
import { createHash } from "crypto";
import { mattstackHome } from "../rt-paths";
import {
  snapshotAll,
  backupDestDir,
  recipientsPath,
} from "./backup-sources";
import { backupPipeline } from "./backup-pipeline";

declare const RT_VERSION: string | undefined;

function rtVersion(): string {
  return typeof RT_VERSION !== "undefined" ? RT_VERSION : "source";
}

function readSchemaVersion(dbPath: string): number | null {
  if (!existsSync(dbPath)) return null;
  try {
    const db = new Database(dbPath, { readonly: true });
    try {
      const row = db.query("PRAGMA user_version").get() as { user_version: number } | null;
      return row?.user_version ?? null;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

function hashFile(path: string): string {
  const content = readFileSync(path);
  return createHash("sha256").update(content).digest("hex");
}

function readLatestManifest(): BackupManifest | null {
  const baseDir = backupDestDir();
  if (!existsSync(baseDir)) return null;
  const manifests = readdirSync(baseDir)
    .filter((f) => f.startsWith("manifest-") && f.endsWith(".json"))
    .sort()
    .reverse();
  if (manifests.length === 0) return null;
  try {
    return JSON.parse(readFileSync(join(baseDir, manifests[0]!), "utf-8"));
  } catch {
    return null;
  }
}

export interface BackupManifest {
  timestamp: string;
  rtVersion: string;
  sources: Array<{
    app: string;
    sourcePath: string;
    schemaVersion: number | null;
    contentHash: string;
    file: string;
    sizeBytes: number;
  }>;
}

export interface BackupResult {
  backed: Array<{ app: string; path: string; sizeBytes: number; contentHash: string }>;
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
    const snapshotResult = await snapshotAll(tmpDir);
    result.errors.push(...snapshotResult.errors);
    const ts = timestamp();

    const prevManifest = readLatestManifest();
    const prevHashes = new Map(
      prevManifest?.sources.map((s) => [s.sourcePath, s.contentHash]) ?? [],
    );

    for (const { source, snapshotPath } of snapshotResult.snapshots) {
      const appDir = join(backupDestDir(), source.app);
      mkdirSync(appDir, { recursive: true });

      const contentHash = hashFile(snapshotPath);
      if (prevHashes.get(source.sourcePath) === contentHash) {
        result.skipped.push(`${source.app}/${basename(source.sourcePath)}: unchanged`);
        continue;
      }

      const baseName = source.sourcePath.replace(/\//g, "-").replace(/\.[^.]+$/, "");
      const destName = `${baseName}-${ts}${source.ext}.zst.age`;
      const destPath = join(appDir, destName);

      try {
        await backupPipeline(snapshotPath, destPath, recip);
        const size = statSync(destPath).size;
        result.backed.push({ app: source.app, path: destPath, sizeBytes: size, contentHash });
      } catch (err) {
        result.errors.push(
          `${source.app}/${basename(source.sourcePath)}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    if (result.backed.length > 0) {
      const manifest: BackupManifest = {
        timestamp: ts,
        rtVersion: rtVersion(),
        sources: result.backed.map((b) => {
          const filePrefix = basename(b.path).split("-" + ts)[0];
          const snap = snapshotResult.snapshots.find((s) => {
            const prefix = s.source.sourcePath.replace(/\//g, "-").replace(/\.[^.]+$/, "");
            return prefix === filePrefix;
          });
          const source = snap?.source;
          return {
            app: b.app,
            sourcePath: source?.sourcePath ?? "",
            schemaVersion: source?.type === "sqlite" && snap ? readSchemaVersion(snap.snapshotPath) : null,
            contentHash: b.contentHash,
            file: basename(b.path),
            sizeBytes: b.sizeBytes,
          };
        }),
      };
      writeFileSync(
        join(backupDestDir(), `manifest-${ts}.json`),
        JSON.stringify(manifest, null, 2) + "\n",
      );
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

  for (const file of readdirSync(baseDir)) {
    if (!file.startsWith("manifest-") || !file.endsWith(".json")) continue;
    const filePath = join(baseDir, file);
    const mtime = statSync(filePath).mtimeMs;
    if (mtime < cutoff) {
      unlinkSync(filePath);
      removed.push(filePath);
    }
  }

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

  if (removed.length > 0) {
    const homeRepo = join(mattstackHome(), "user");
    const gitLfs = Bun.which("git-lfs", { PATH: process.env.PATH });
    if (gitLfs && existsSync(join(homeRepo, ".git"))) {
      const proc = Bun.spawn(["git", "lfs", "prune"], {
        cwd: homeRepo,
        stdout: "ignore",
        stderr: "pipe",
        env: { ...process.env },
      });
      const timeout = setTimeout(() => proc.kill(), 30_000);
      await proc.exited;
      clearTimeout(timeout);
    }
  }

  return { removed };
}
