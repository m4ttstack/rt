import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Database } from "bun:sqlite";
import { spawn } from "bun";

describe("backup-orchestrator", () => {
  let home: string;
  let origHome: string;

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), "bo-test-"));
    origHome = process.env.HOME!;
    process.env.HOME = home;

    const ms = join(home, ".mattstack");

    // Create state DBs
    for (const rel of ["rt/state.db", "rt/gates.db", "board/state.db"]) {
      const p = join(ms, rel);
      mkdirSync(join(p, ".."), { recursive: true });
      const db = new Database(p);
      db.run("CREATE TABLE t (v TEXT)");
      db.run("INSERT INTO t VALUES ('data')");
      db.close();
    }

    // Create gitq stacks
    mkdirSync(join(ms, "gitq", "stacks"), { recursive: true });
    writeFileSync(join(ms, "gitq", "stacks", "s1.json"), '{"stacks":[]}');

    // Set up backup destination with recipients
    const backupDir = join(ms, "user", "state-backups");
    mkdirSync(backupDir, { recursive: true });

    // Generate a test age key pair
    const keygen = spawn(["age-keygen"], { stdout: "pipe", stderr: "pipe" });
    const keyOutput = await new Response(keygen.stdout).text();
    await keygen.exited;
    writeFileSync(join(home, "test-age-key.txt"), keyOutput);

    const pubKey = keyOutput
      .split("\n")
      .find((l: string) => l.startsWith("# public key:"))
      ?.replace("# public key: ", "")
      .trim();
    writeFileSync(join(backupDir, "recipients.txt"), pubKey! + "\n");
  });

  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  it("produces encrypted compressed backups for all sources", async () => {
    const { runFullBackup } = await import("../state/backup-orchestrator");
    const result = await runFullBackup();

    expect(result.errors).toEqual([]);
    expect(result.backed.length).toBe(4);

    for (const b of result.backed) {
      expect(existsSync(b.path)).toBe(true);
      expect(b.path).toEndWith(".zst.age");
      expect(b.sizeBytes).toBeGreaterThan(0);
    }
  });

  it("organizes output by app subdirectory", async () => {
    const { runFullBackup } = await import("../state/backup-orchestrator");
    await runFullBackup();

    const backupDir = join(home, ".mattstack", "user", "state-backups");
    expect(existsSync(join(backupDir, "rt"))).toBe(true);
    expect(existsSync(join(backupDir, "board"))).toBe(true);
    expect(existsSync(join(backupDir, "gitq"))).toBe(true);
  });

  it("prunes files older than retention period", async () => {
    const { runFullBackup, pruneOldBackups } = await import(
      "../state/backup-orchestrator"
    );
    await runFullBackup();

    // Backdate the files
    const backupDir = join(home, ".mattstack", "user", "state-backups");
    const allFiles: string[] = [];
    for (const app of ["rt", "board", "gitq"]) {
      const appDir = join(backupDir, app);
      if (!existsSync(appDir)) continue;
      for (const f of readdirSync(appDir)) {
        const p = join(appDir, f);
        allFiles.push(p);
        // Set mtime to 8 days ago
        const past = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
        Bun.spawnSync(["touch", "-t", past.toISOString().replace(/[-:T]/g, "").slice(0, 12), p]);
      }
    }

    const { removed } = await pruneOldBackups(7);
    expect(removed.length).toBe(allFiles.length);
  });

  it("skips unchanged sources on second backup", async () => {
    const { runFullBackup } = await import("../state/backup-orchestrator");
    const first = await runFullBackup();
    expect(first.backed.length).toBe(4);
    expect(first.skipped.length).toBe(0);

    const second = await runFullBackup();
    expect(second.backed.length).toBe(0);
    expect(second.skipped.length).toBe(4);
  });

  it("re-uploads a changed source even when others are unchanged", async () => {
    const { runFullBackup } = await import("../state/backup-orchestrator");
    await runFullBackup();

    const db = new Database(join(home, ".mattstack", "rt", "state.db"));
    db.run("INSERT INTO t VALUES ('changed')");
    db.close();

    const second = await runFullBackup();
    expect(second.backed.length).toBe(1);
    expect(second.backed[0].app).toBe("rt");
    expect(second.skipped.length).toBe(3);
  });

  it("re-uploads when previous .age file is missing", async () => {
    const { runFullBackup } = await import("../state/backup-orchestrator");
    await runFullBackup();

    const backupDir = join(home, ".mattstack", "user", "state-backups", "rt");
    const ageFiles = readdirSync(backupDir).filter((f) => f.endsWith(".zst.age"));
    for (const f of ageFiles) rmSync(join(backupDir, f));

    const second = await runFullBackup();
    const rtBacked = second.backed.filter((b) => b.app === "rt");
    expect(rtBacked.length).toBe(2);
  });

  it("writes manifest with schema versions", async () => {
    const { runFullBackup } = await import("../state/backup-orchestrator");
    await runFullBackup();

    const backupDir = join(home, ".mattstack", "user", "state-backups");
    const manifests = readdirSync(backupDir).filter((f) => f.startsWith("manifest-"));
    expect(manifests.length).toBe(1);

    const manifest = JSON.parse(readFileSync(join(backupDir, manifests[0]), "utf-8"));
    expect(manifest.rtVersion).toBeDefined();
    expect(manifest.sources.length).toBe(4);
    for (const s of manifest.sources) {
      expect(s.contentHash).toBeTruthy();
      if (s.sourcePath.endsWith(".db")) {
        expect(typeof s.schemaVersion).toBe("number");
      }
    }
  });

  it("never writes unencrypted intermediates to the backup destination", async () => {
    const { runFullBackup } = await import("../state/backup-orchestrator");
    await runFullBackup();

    const backupDir = join(home, ".mattstack", "user", "state-backups");
    const allFiles: string[] = [];
    for (const entry of readdirSync(backupDir, { recursive: true })) {
      allFiles.push(String(entry));
    }

    const unencrypted = allFiles.filter(
      (f) => (f.endsWith(".zst") || f.endsWith(".db")) && !f.endsWith(".zst.age"),
    );
    expect(unencrypted).toEqual([]);
  });
});
