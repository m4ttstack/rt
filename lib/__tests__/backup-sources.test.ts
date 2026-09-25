import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Database } from "bun:sqlite";
import { restoreHome } from "./home-env.ts";

describe("backup-sources", () => {
  let home: string;
  let origHome: string | undefined;

  beforeEach(() => {
    origHome = process.env.HOME;
    home = mkdtempSync(join(tmpdir(), "bs-test-"));
    process.env.HOME = home;

    // Set up the mattstack directory structure with real DBs
    const ms = join(home, ".mattstack");
    mkdirSync(join(ms, "rt"), { recursive: true });
    mkdirSync(join(ms, "board"), { recursive: true });
    mkdirSync(join(ms, "gitq", "stacks"), { recursive: true });

    // Create minimal SQLite DBs
    for (const path of [
      join(ms, "rt", "state.db"),
      join(ms, "rt", "gates.db"),
      join(ms, "board", "state.db"),
    ]) {
      const db = new Database(path);
      db.run("CREATE TABLE test (id INTEGER PRIMARY KEY)");
      db.run("INSERT INTO test VALUES (1)");
      db.close();
    }

    // Create gitq stack files
    writeFileSync(
      join(ms, "gitq", "stacks", "abc123.json"),
      JSON.stringify({ repoPath: "/tmp/repo", stacks: [] }),
    );
  });

  afterEach(() => {
    restoreHome(origHome);
    rmSync(home, { recursive: true, force: true });
  });

  it("snapshotAll produces one file per source", async () => {
    const { snapshotAll } = await import("../state/backup-sources");
    const destDir = join(home, "snapshots");
    mkdirSync(destDir, { recursive: true });

    const { snapshots } = await snapshotAll(destDir);

    expect(snapshots.length).toBe(4); // state.db, gates.db, board/state.db, gitq/stacks
    for (const r of snapshots) {
      expect(existsSync(r.snapshotPath)).toBe(true);
    }
  });

  it("SQLite snapshots pass integrity check", async () => {
    const { snapshotAll } = await import("../state/backup-sources");
    const destDir = join(home, "snapshots");
    mkdirSync(destDir, { recursive: true });

    const { snapshots } = await snapshotAll(destDir);
    const sqliteResults = snapshots.filter((r) => r.source.type === "sqlite");

    for (const r of sqliteResults) {
      const db = new Database(r.snapshotPath, { readonly: true });
      const check = db.query("PRAGMA quick_check").all();
      db.close();
      expect(check).toEqual([{ quick_check: "ok" }]);
    }
  });

  it("gitq snapshot is a tar containing the stacks", async () => {
    const { snapshotAll } = await import("../state/backup-sources");
    const destDir = join(home, "snapshots");
    mkdirSync(destDir, { recursive: true });

    const { snapshots } = await snapshotAll(destDir);
    const gitqResult = snapshots.find((r) => r.source.app === "gitq");
    expect(gitqResult).toBeTruthy();
    expect(gitqResult!.snapshotPath).toEndWith(".tar");
  });

  it("skips sources whose paths do not exist", async () => {
    // Remove board dir
    rmSync(join(home, ".mattstack", "board"), { recursive: true, force: true });

    const { snapshotAll } = await import("../state/backup-sources");
    const destDir = join(home, "snapshots");
    mkdirSync(destDir, { recursive: true });

    const { snapshots } = await snapshotAll(destDir);
    expect(snapshots.length).toBe(3); // no board
  });
});
