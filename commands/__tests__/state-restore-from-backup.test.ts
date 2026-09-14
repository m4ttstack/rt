import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, realpathSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Database } from "bun:sqlite";
import { spawn } from "bun";

describe("state restore --from-backup", () => {
  let home: string;
  let origHome: string;

  beforeEach(async () => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "sr-test-")));
    origHome = process.env.HOME!;
    process.env.HOME = home;

    const ms = join(home, ".mattstack");

    // Create a state DB with known content
    mkdirSync(join(ms, "rt"), { recursive: true });
    const db = new Database(join(ms, "rt", "state.db"));
    db.run("CREATE TABLE t (v TEXT)");
    db.run("INSERT INTO t VALUES ('original')");
    db.close();

    // Set up backup with recipients
    mkdirSync(join(ms, "user", "state-backups", "rt"), { recursive: true });

    const keygen = spawn(["age-keygen"], { stdout: "pipe", stderr: "pipe" });
    const keyOutput = await new Response(keygen.stdout).text();
    await keygen.exited;
    writeFileSync(join(home, "test-key.txt"), keyOutput, { mode: 0o600 });

    const pubKey = keyOutput
      .split("\n")
      .find((l: string) => l.startsWith("# public key:"))
      ?.replace("# public key: ", "")
      .trim();
    writeFileSync(join(ms, "user", "state-backups", "recipients.txt"), pubKey! + "\n");

    // Run a backup
    const { runFullBackup } = await import("../../lib/state/backup-orchestrator");
    await runFullBackup();

    // Corrupt the original DB to prove restore works
    const corrupt = new Database(join(ms, "rt", "state.db"));
    corrupt.run("DROP TABLE t");
    corrupt.run("CREATE TABLE t (v TEXT)");
    corrupt.run("INSERT INTO t VALUES ('corrupted')");
    corrupt.close();
  });

  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  it("restores the state DB from the most recent backup", async () => {
    const { restoreFromBackup } = await import("../../lib/state/backup-restore");
    const result = await restoreFromBackup({
      identityPath: join(home, "test-key.txt"),
    });

    expect(result.restored.length).toBeGreaterThan(0);
    expect(result.errors).toEqual([]);

    // Verify the original data is back
    const db = new Database(join(home, ".mattstack", "rt", "state.db"), { readonly: true });
    const rows = db.query("SELECT v FROM t").all() as Array<{ v: string }>;
    db.close();
    expect(rows[0]!.v).toBe("original");
  });

  it("restores gates.db independently of state.db (source-prefix filtering)", async () => {
    // Seed a gates.db too, and re-run backup so both sources exist.
    const gatesDb = new Database(join(home, ".mattstack", "rt", "gates.db"));
    gatesDb.run("CREATE TABLE g (v TEXT)");
    gatesDb.run("INSERT INTO g VALUES ('gates-original')");
    gatesDb.close();

    const { runFullBackup } = await import("../../lib/state/backup-orchestrator");
    await runFullBackup();

    const { restoreFromBackup } = await import("../../lib/state/backup-restore");
    const result = await restoreFromBackup({
      identityPath: join(home, "test-key.txt"),
    });

    expect(result.errors).toEqual([]);

    // The second runFullBackup snapshots the db as it stood at that point
    // (post-corruption, in beforeEach) -- restoring the latest backup
    // legitimately reproduces that, not the older "original" snapshot. The
    // real assertion here is the one below: gates.db must come back with
    // its own content, not state.db's, proving the prefix filter works.
    const stateDb = new Database(join(home, ".mattstack", "rt", "state.db"), { readonly: true });
    const stateRows = stateDb.query("SELECT v FROM t").all() as Array<{ v: string }>;
    stateDb.close();
    expect(stateRows[0]!.v).toBe("corrupted");

    const restoredGates = new Database(join(home, ".mattstack", "rt", "gates.db"), { readonly: true });
    const gatesRows = restoredGates.query("SELECT v FROM g").all() as Array<{ v: string }>;
    restoredGates.close();
    expect(gatesRows[0]!.v).toBe("gates-original");
  });

  it("--only filters to a single app", async () => {
    const { restoreFromBackup } = await import("../../lib/state/backup-restore");
    const result = await restoreFromBackup({
      identityPath: join(home, "test-key.txt"),
      only: "board",
    });

    expect(result.restored).toEqual([]);
    expect(result.skipped.some((s) => s.startsWith("board:"))).toBe(true);
  });

  it("--dry-run does not modify the live db", async () => {
    const { restoreFromBackup } = await import("../../lib/state/backup-restore");
    const result = await restoreFromBackup({
      identityPath: join(home, "test-key.txt"),
      dryRun: true,
    });

    expect(result.restored.length).toBeGreaterThan(0);

    const db = new Database(join(home, ".mattstack", "rt", "state.db"), { readonly: true });
    const rows = db.query("SELECT v FROM t").all() as Array<{ v: string }>;
    db.close();
    expect(rows[0]!.v).toBe("corrupted");
  });

  it("reports no backup found when nothing is present for a source", async () => {
    const { restoreFromBackup } = await import("../../lib/state/backup-restore");
    const result = await restoreFromBackup({
      identityPath: join(home, "test-key.txt"),
      only: "gitq",
    });

    expect(result.skipped).toEqual(["gitq: no backup found"]);
  });

  it("restores via stdin identity key (no key on disk)", async () => {
    const { restoreFromBackup } = await import("../../lib/state/backup-restore");
    const keyContent = readFileSync(join(home, "test-key.txt"), "utf-8");

    const result = await restoreFromBackup({
      identityKey: keyContent,
      only: "rt",
    });

    expect(result.errors).toEqual([]);
    expect(result.restored.length).toBeGreaterThan(0);
  });

  it("refuses restore when target is held open by another process", async () => {
    const dbPath = join(home, ".mattstack", "rt", "state.db");
    const holder = new Database(dbPath);

    try {
      const { restoreFromBackup } = await import("../../lib/state/backup-restore");
      const result = await restoreFromBackup({
        identityPath: join(home, "test-key.txt"),
        only: "rt",
      });

      const holderError = result.errors.find((e) => e.includes("held open"));
      expect(holderError).toBeTruthy();
    } finally {
      holder.close();
    }
  });
});
