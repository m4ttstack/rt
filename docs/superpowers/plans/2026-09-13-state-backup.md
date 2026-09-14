# State Backup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Encrypted, compressed, off-machine backup of mattstack app state (rt, board, gitq) via the home repo with Git LFS.

**Architecture:** A new backup pipeline library handles compression (zstd -19) and encryption (age with multiple recipients). A source registry knows which DBs and directories to snapshot. The daemon sweep runs the full pipeline every 4 hours, writing encrypted blobs to the LFS-tracked home repo. Restore reverses the pipeline from any machine with access to either the personal keychain or the team repo's age key.

**Tech Stack:** Bun/TypeScript, SQLite (VACUUM INTO), zstd, age, Git LFS

**Spec:** `docs/superpowers/specs/2026-09-13-state-backup-design.md`

## Global Constraints

- All git operations must run under isolated HOME in tests (existing `bunfig` preload pattern)
- `zstd` resolves via PATH (`/opt/homebrew/bin/zstd`), not bundled in mattstack.app
- `age` resolves via PATH (`Bun.which("age")`); `deps.lock` bundles `age-keygen` but not `age` itself. Init must check for `age` and error with install instructions if missing.
- `VACUUM INTO` is the SQLite backup method (Bun's `bun:sqlite` has no `.backup()`)
- Board and gitq paths derive from `mattstackHome()` (`lib/rt-paths.ts:36`), not dedicated path helpers
- New command modules must be registered in `lib/module-registry.ts` as thunks
- The home repo snapshot engine auto-commits/pushes files written to `~/.mattstack/user/`; no manual git operations needed for the backup write path
- Existing `rt state backup` and `rt state restore` behavior must be preserved behind `--local` / positional-arg paths
- Command handlers receive `(args: string[], ctx: CommandContext)` where `args` is the remaining CLI tokens. Flags are parsed via `args.includes("--flag")` and `flagValue(args, "--flag")` from `lib/cli-args.ts`. `CommandContext` is `{ identity?, autoResolved? }` (from `lib/command-tree.ts`), with no `log` property; use `console.log`/`console.error` directly.
- Every task that modifies `lib/command-tree-def.ts` must also run `bun scripts/gen-docs.ts` and commit the updated `website/docs/reference/` to keep the "Command reference is in sync" CI check green.
- CI (`checks.yml`) installs `age`, `zstd`, and `git-lfs` via the brew step added in Task 0. Tests can spawn them without guards.

---

### Task 0: CI dependencies

Add `age`, `zstd`, and `git-lfs` to the CI workflow so tests that spawn them don't ENOENT.

**Files:**
- Modify: `.github/workflows/checks.yml`

**Interfaces:**
- Consumes: nothing
- Produces: `age`, `zstd`, `git-lfs` available in CI

- [ ] **Step 1: Add brew install to checks.yml**

In `.github/workflows/checks.yml`, add a step after checkout (before tests run):

```yaml
- name: Install backup dependencies
  run: brew install age zstd git-lfs
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/checks.yml
git commit -m "ci: install age, zstd, git-lfs for state backup tests"
```

---

### Task 1: Backup pipeline library

The compress/encrypt/decrypt/decompress primitives that every other task builds on.

**Files:**
- Create: `lib/state/backup-pipeline.ts`
- Create: `lib/__tests__/backup-pipeline.test.ts`

**Interfaces:**
- Consumes: `Bun.which("age")` for age binary resolution (not bundled)
- Produces:
  - `compressFile(src: string, dest: string): Promise<void>`
  - `decompressFile(src: string, dest: string): Promise<void>`
  - `encryptFile(src: string, dest: string, recipientsPath: string): Promise<void>`
  - `decryptFile(src: string, dest: string, identityPath: string): Promise<void>`
  - `backupPipeline(src: string, dest: string, recipientsPath: string): Promise<void>` (compress then encrypt)
  - `restorePipeline(src: string, dest: string, identityPath: string): Promise<void>` (decrypt then decompress)

- [ ] **Step 1: Write failing tests for compressFile and decompressFile**

```ts
// lib/__tests__/backup-pipeline.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compressFile, decompressFile } from "../state/backup-pipeline";

describe("backup-pipeline", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "bp-test-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  describe("compressFile / decompressFile", () => {
    it("round-trips a file through zstd", async () => {
      const src = join(tmp, "input.db");
      const compressed = join(tmp, "input.db.zst");
      const restored = join(tmp, "output.db");

      const content = Buffer.alloc(4096, "abcdefghij");
      writeFileSync(src, content);

      await compressFile(src, compressed);
      expect(Bun.file(compressed).size).toBeLessThan(content.length);

      await decompressFile(compressed, restored);
      expect(readFileSync(restored)).toEqual(content);
    });

    it("rejects when source does not exist", async () => {
      await expect(
        compressFile(join(tmp, "nope"), join(tmp, "out.zst")),
      ).rejects.toThrow();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test lib/__tests__/backup-pipeline.test.ts`
Expected: FAIL with "cannot find module" or similar

- [ ] **Step 3: Implement compressFile and decompressFile**

```ts
// lib/state/backup-pipeline.ts
import { spawn } from "bun";
import { unlink } from "fs/promises";

function resolveZstd(): string {
  const path = Bun.which("zstd");
  if (!path) throw new Error("zstd not found in PATH. Install with: brew install zstd");
  return path;
}

export async function compressFile(src: string, dest: string): Promise<void> {
  const proc = spawn([resolveZstd(), "-19", "-f", "-o", dest, src], {
    stdout: "ignore",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`zstd compression failed (exit ${exitCode}): ${stderr}`);
  }
}

export async function decompressFile(src: string, dest: string): Promise<void> {
  const proc = spawn([resolveZstd(), "-d", "-f", "-o", dest, src], {
    stdout: "ignore",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`zstd decompression failed (exit ${exitCode}): ${stderr}`);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test lib/__tests__/backup-pipeline.test.ts`
Expected: PASS

- [ ] **Step 5: Write failing tests for encryptFile and decryptFile**

Add to `lib/__tests__/backup-pipeline.test.ts`:

```ts
import { encryptFile, decryptFile } from "../state/backup-pipeline";

describe("encryptFile / decryptFile", () => {
  it("round-trips a file through age", async () => {
    const src = join(tmp, "plain.txt");
    const encrypted = join(tmp, "plain.txt.age");
    const decrypted = join(tmp, "restored.txt");
    const keyFile = join(tmp, "key.txt");
    const recipientsFile = join(tmp, "recipients.txt");

    const content = "secret state data";
    writeFileSync(src, content);

    // Generate a throwaway age key pair
    const keygen = spawn(["age-keygen"], { stdout: "pipe", stderr: "pipe" });
    const keyOutput = await new Response(keygen.stdout).text();
    await keygen.exited;
    writeFileSync(keyFile, keyOutput);

    // Extract public key from comment line
    const pubKey = keyOutput
      .split("\n")
      .find((l: string) => l.startsWith("# public key:"))
      ?.replace("# public key: ", "")
      .trim();
    expect(pubKey).toBeTruthy();
    writeFileSync(recipientsFile, pubKey! + "\n");

    await encryptFile(src, encrypted, recipientsFile);
    const encryptedContent = readFileSync(encrypted);
    expect(encryptedContent.toString()).not.toContain(content);

    await decryptFile(encrypted, decrypted, keyFile);
    expect(readFileSync(decrypted, "utf-8")).toBe(content);
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `bun test lib/__tests__/backup-pipeline.test.ts`
Expected: FAIL

- [ ] **Step 7: Implement encryptFile and decryptFile**

Add to `lib/state/backup-pipeline.ts`:

```ts
function resolveAge(): string {
  const path = Bun.which("age");
  if (!path) throw new Error("age not found in PATH. Install with: brew install age");
  return path;
}

export async function encryptFile(
  src: string,
  dest: string,
  recipientsPath: string,
): Promise<void> {
  const age = resolveAge();
  const proc = spawn([age, "-R", recipientsPath, "-o", dest, src], {
    stdout: "ignore",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`age encryption failed (exit ${exitCode}): ${stderr}`);
  }
}

export async function decryptFile(
  src: string,
  dest: string,
  identityPath: string,
): Promise<void> {
  const age = resolveAge();
  const proc = spawn([age, "-d", "-i", identityPath, "-o", dest, src], {
    stdout: "ignore",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`age decryption failed (exit ${exitCode}): ${stderr}`);
  }
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `bun test lib/__tests__/backup-pipeline.test.ts`
Expected: PASS

- [ ] **Step 9: Write failing test for backupPipeline and restorePipeline**

Add to `lib/__tests__/backup-pipeline.test.ts`:

```ts
import { backupPipeline, restorePipeline } from "../state/backup-pipeline";

describe("backupPipeline / restorePipeline", () => {
  it("compress+encrypt then decrypt+decompress round-trips", async () => {
    const src = join(tmp, "state.db");
    const encrypted = join(tmp, "state.db.zst.age");
    const restored = join(tmp, "restored.db");
    const keyFile = join(tmp, "key.txt");
    const recipientsFile = join(tmp, "recipients.txt");

    const content = Buffer.alloc(8192, "statedata");
    writeFileSync(src, content);

    const keygen = spawn(["age-keygen"], { stdout: "pipe", stderr: "pipe" });
    const keyOutput = await new Response(keygen.stdout).text();
    await keygen.exited;
    writeFileSync(keyFile, keyOutput);

    const pubKey = keyOutput
      .split("\n")
      .find((l: string) => l.startsWith("# public key:"))
      ?.replace("# public key: ", "")
      .trim();
    writeFileSync(recipientsFile, pubKey! + "\n");

    await backupPipeline(src, encrypted, recipientsFile);
    expect(Bun.file(encrypted).size).toBeLessThan(content.length);

    await restorePipeline(encrypted, restored, keyFile);
    expect(readFileSync(restored)).toEqual(content);
  });
});
```

- [ ] **Step 10: Implement backupPipeline and restorePipeline**

Add to `lib/state/backup-pipeline.ts`:

```ts
export async function backupPipeline(
  src: string,
  dest: string,
  recipientsPath: string,
): Promise<void> {
  const compressed = dest.replace(/\.age$/, "");
  try {
    await compressFile(src, compressed);
    await encryptFile(compressed, dest, recipientsPath);
  } finally {
    await unlink(compressed).catch(() => {});
  }
}

export async function restorePipeline(
  src: string,
  dest: string,
  identityPath: string,
): Promise<void> {
  const compressed = src.replace(/\.age$/, "");
  try {
    await decryptFile(src, compressed, identityPath);
    await decompressFile(compressed, dest);
  } finally {
    await unlink(compressed).catch(() => {});
  }
}
```

- [ ] **Step 11: Run all tests to verify they pass**

Run: `bun test lib/__tests__/backup-pipeline.test.ts`
Expected: PASS

- [ ] **Step 12: Commit**

```bash
git add lib/state/backup-pipeline.ts lib/__tests__/backup-pipeline.test.ts
git commit -m "add backup pipeline: compress (zstd -19), encrypt (age), and round-trip primitives"
```

---

### Task 2: Multi-source backup registry

A registry that knows every backup source, how to snapshot it, and where the output goes.

**Files:**
- Create: `lib/state/backup-sources.ts`
- Create: `lib/__tests__/backup-sources.test.ts`

**Interfaces:**
- Consumes: `mattstackHome()` from `lib/rt-paths.ts:36`
- Produces:
  - `BackupSource` type: `{ app: string; type: "sqlite" | "dir"; sourcePath: string; ext: string }`
  - `BACKUP_SOURCES: BackupSource[]`
  - `snapshotSource(source: BackupSource, destDir: string): Promise<string>` (returns path to snapshot file)
  - `snapshotAll(destDir: string): Promise<Array<{ source: BackupSource; snapshotPath: string }>>`
  - `backupDestDir(): string` (returns `~/.mattstack/user/state-backups/`)
  - `recipientsPath(): string` (returns `~/.mattstack/user/state-backups/recipients.txt`)

- [ ] **Step 1: Write failing tests**

```ts
// lib/__tests__/backup-sources.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Database } from "bun:sqlite";

describe("backup-sources", () => {
  let home: string;
  let origHome: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "bs-test-"));
    origHome = process.env.HOME!;
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
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  it("snapshotAll produces one file per source", async () => {
    const { snapshotAll } = await import("../state/backup-sources");
    const destDir = join(home, "snapshots");
    mkdirSync(destDir, { recursive: true });

    const results = await snapshotAll(destDir);

    expect(results.length).toBe(4); // state.db, gates.db, board/state.db, gitq/stacks
    for (const r of results) {
      expect(existsSync(r.snapshotPath)).toBe(true);
    }
  });

  it("SQLite snapshots pass integrity check", async () => {
    const { snapshotAll } = await import("../state/backup-sources");
    const destDir = join(home, "snapshots");
    mkdirSync(destDir, { recursive: true });

    const results = await snapshotAll(destDir);
    const sqliteResults = results.filter((r) => r.source.type === "sqlite");

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

    const results = await snapshotAll(destDir);
    const gitqResult = results.find((r) => r.source.app === "gitq");
    expect(gitqResult).toBeTruthy();
    expect(gitqResult!.snapshotPath).toEndWith(".tar");
  });

  it("skips sources whose paths do not exist", async () => {
    // Remove board dir
    rmSync(join(home, ".mattstack", "board"), { recursive: true, force: true });

    const { snapshotAll } = await import("../state/backup-sources");
    const destDir = join(home, "snapshots");
    mkdirSync(destDir, { recursive: true });

    const results = await snapshotAll(destDir);
    expect(results.length).toBe(3); // no board
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test lib/__tests__/backup-sources.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement backup-sources.ts**

```ts
// lib/state/backup-sources.ts
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
  const baseName = source.sourcePath.replace(/\//g, "-");
  const destPath = join(destDir, `${baseName}${source.ext}`);

  if (source.type === "sqlite") {
    const db = new Database(fullPath, { readonly: true });
    try {
      db.query("VACUUM INTO ?").run(destPath);
    } finally {
      db.close();
    }
  } else {
    // tar the directory
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

export async function snapshotAll(
  destDir: string,
): Promise<Array<{ source: BackupSource; snapshotPath: string }>> {
  mkdirSync(destDir, { recursive: true });
  const results: Array<{ source: BackupSource; snapshotPath: string }> = [];

  for (const source of BACKUP_SOURCES) {
    const fullPath = resolveSourcePath(source);
    if (!existsSync(fullPath)) continue;

    const snapshotPath = await snapshotSource(source, destDir);
    results.push({ source, snapshotPath });
  }

  return results;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test lib/__tests__/backup-sources.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/state/backup-sources.ts lib/__tests__/backup-sources.test.ts
git commit -m "add backup source registry: snapshot all mattstack state DBs and gitq stacks"
```

---

### Task 3: Full backup orchestrator

Wires together the source registry and the pipeline to produce encrypted backups in the home repo.

**Files:**
- Create: `lib/state/backup-orchestrator.ts`
- Create: `lib/__tests__/backup-orchestrator.test.ts`

**Interfaces:**
- Consumes: `snapshotAll` from `lib/state/backup-sources.ts`, `backupPipeline` from `lib/state/backup-pipeline.ts`, `recipientsPath` and `backupDestDir` from `lib/state/backup-sources.ts`
- Produces:
  - `runFullBackup(): Promise<BackupResult>`
  - `BackupResult`: `{ backed: Array<{ app: string; path: string; sizeBytes: number }>; skipped: string[]; errors: string[] }`
  - `pruneOldBackups(retentionDays?: number): Promise<{ removed: string[] }>`
  - `isBackupConfigured(): boolean`

- [ ] **Step 1: Write failing tests**

```ts
// lib/__tests__/backup-orchestrator.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, rmSync } from "fs";
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test lib/__tests__/backup-orchestrator.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement backup-orchestrator.ts**

```ts
// lib/state/backup-orchestrator.ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test lib/__tests__/backup-orchestrator.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/state/backup-orchestrator.ts lib/__tests__/backup-orchestrator.test.ts
git commit -m "add backup orchestrator: full pipeline from snapshot to encrypted output, with retention"
```

---

### Task 4: Setup command (`rt state backup init`)

Bootstrap LFS, recipients file, verify decrypt round-trip and LFS filter configuration. Requires `rt home init` to have run (the home repo must be a git repo). The `backup` node becomes a branch with subcommands while keeping its default handler via the command tree's support for both `fn` and `subcommands` on a node (`lib/command-tree.ts:210-225`).

**Files:**
- Create: `commands/state-backup-init.ts`
- Modify: `lib/command-tree-def.ts:1356-1378` (restructure `backup` to branch with `init` subcommand)
- Modify: `lib/module-registry.ts` (register new module thunk)
- Create: `commands/__tests__/state-backup-init.test.ts`

**Interfaces:**
- Consumes: `ensureAgeKey(seams: AgeKeySeam)` and `readAgeKey(seams: AgeKeySeam)` and `createRealAgeKeySeam()` from `lib/home/age-key.ts`, `isBackupConfigured()` and `runFullBackup()` from `lib/state/backup-orchestrator.ts`, `recipientsPath()` and `backupDestDir()` from `lib/state/backup-sources.ts`, `restorePipeline()` from `lib/state/backup-pipeline.ts`
- Produces: `stateBackupInit(args: string[], ctx: CommandContext): Promise<void>` (command handler)

- [ ] **Step 1: Write failing test**

```ts
// commands/__tests__/state-backup-init.test.ts
import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdtempSync, mkdirSync, existsSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("state backup init", () => {
  let home: string;
  let origHome: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "si-test-"));
    origHome = process.env.HOME!;
    process.env.HOME = home;
    mkdirSync(join(home, ".mattstack", "user", "state-backups"), { recursive: true });
  });

  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  it("exits with error when age is missing", async () => {
    const origPath = process.env.PATH;
    process.env.PATH = "";
    const exitSpy = spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
    const errorSpy = spyOn(console, "error");

    try {
      const { stateBackupInit } = await import("../state-backup-init");
      await stateBackupInit([], {}).catch(() => {});
    } finally {
      process.env.PATH = origPath;
    }

    expect(exitSpy).toHaveBeenCalledWith(1);
    const output = errorSpy.mock.calls.flat().join(" ");
    expect(output).toContain("age not found");
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("isBackupConfigured returns true after recipients.txt exists", async () => {
    const { recipientsPath } = await import("../../lib/state/backup-sources");
    const { isBackupConfigured } = await import("../../lib/state/backup-orchestrator");

    expect(isBackupConfigured()).toBe(false);
    writeFileSync(recipientsPath(), "age1testpublickey\n");
    expect(isBackupConfigured()).toBe(true);
  });
});
```

Note: Full integration testing of `stateBackupInit` requires the macOS Keychain (for `ensureAgeKey`), a real git repo (for LFS), and `age`/`zstd`/`git-lfs` binaries. These are integration-test concerns; the unit test verifies the structural preconditions. The round-trip is exercised by Task 3's orchestrator tests.

- [ ] **Step 2: Implement state-backup-init.ts**

```ts
// commands/state-backup-init.ts
import { existsSync, writeFileSync, mkdirSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { ensureAgeKey, readAgeKey, createRealAgeKeySeam } from "../lib/home/age-key";
import { recipientsPath, backupDestDir } from "../lib/state/backup-sources";
import { runFullBackup } from "../lib/state/backup-orchestrator";
import { restorePipeline } from "../lib/state/backup-pipeline";
import { mattstackHome } from "../lib/rt-paths";
import type { CommandContext } from "../lib/command-tree";

export async function stateBackupInit(args: string[], _ctx: CommandContext): Promise<void> {
  const PATH = process.env.PATH;

  const age = Bun.which("age", { PATH });
  if (!age) {
    console.error("age not found. Install with: brew install age");
    process.exit(1);
  }

  const zstd = Bun.which("zstd", { PATH });
  if (!zstd) {
    console.error("zstd not found. Install with: brew install zstd");
    process.exit(1);
  }

  const gitLfs = Bun.which("git-lfs", { PATH });
  if (!gitLfs) {
    console.error("git-lfs not found. Install with: brew install git-lfs");
    process.exit(1);
  }

  console.log("Dependencies: age, zstd, git-lfs found");

  // 4. Init LFS in home repo
  const homeRepo = join(mattstackHome(), "user");
  const gitattributes = join(homeRepo, ".gitattributes");

  const lfsInit = Bun.spawnSync(["git", "lfs", "install"], { cwd: homeRepo });
  if (lfsInit.exitCode !== 0) {
    console.error("git lfs install failed:", lfsInit.stderr.toString());
    process.exit(1);
  }

  // 5. Add .gitattributes tracking rule (must land before first .age file)
  const trackRule = "*.age filter=lfs diff=lfs merge=lfs -text\n";
  const existing = existsSync(gitattributes) ? readFileSync(gitattributes, "utf-8") : "";
  if (!existing.includes("*.age filter=lfs")) {
    writeFileSync(gitattributes, existing + trackRule);
    console.log("Added LFS tracking for *.age to .gitattributes");
  }

  // 6. Create recipients file with personal age public key
  const recip = recipientsPath();
  mkdirSync(backupDestDir(), { recursive: true });

  const seams = createRealAgeKeySeam();
  const { publicKey } = await ensureAgeKey(seams);
  if (!existsSync(recip)) {
    writeFileSync(recip, publicKey + "\n");
    console.log("Created recipients.txt with personal age key");
  } else {
    const content = readFileSync(recip, "utf-8");
    if (!content.includes(publicKey)) {
      writeFileSync(recip, content.trimEnd() + "\n" + publicKey + "\n");
      console.log("Added personal age key to existing recipients.txt");
    }
  }

  // 7. Run first backup
  console.log("Running initial backup...");
  const result = await runFullBackup();
  for (const b of result.backed) {
    console.log(`  ${b.app}: ${b.sizeBytes} bytes`);
  }
  if (result.errors.length > 0) {
    console.error("Errors:", result.errors.join(", "));
    process.exit(1);
  }

  // 8. Verify round-trip (decrypt)
  console.log("Verifying decrypt round-trip...");
  const verifyDir = await mkdtemp(join(tmpdir(), "backup-verify-"));
  try {
    const keyResult = await readAgeKey(seams);
    if ("absent" in keyResult) throw new Error("Age key not found in keychain");

    const keyFile = join(verifyDir, "identity.txt");
    writeFileSync(keyFile, keyResult.key, { mode: 0o600 });

    const first = result.backed[0];
    const restoredPath = join(verifyDir, "verify.db");
    await restorePipeline(first.path, restoredPath, keyFile);
    console.log("Decrypt round-trip passed");
  } finally {
    rmSync(verifyDir, { recursive: true, force: true });
  }

  // 9. Verify .gitattributes LFS filter applies to .age files
  const firstBackupFile = result.backed[0]?.path;
  if (firstBackupFile) {
    const checkAttr = Bun.spawnSync(
      ["git", "check-attr", "filter", "--", firstBackupFile],
      { cwd: homeRepo },
    );
    const attrOutput = checkAttr.stdout.toString();
    if (attrOutput.includes("filter: lfs")) {
      console.log("LFS filter confirmed for .age files");
    } else {
      console.warn("Warning: .gitattributes LFS filter not applying to .age files");
      console.warn("Push verification deferred to `rt state backup status`");
    }
  }

  console.log("State backup initialized. The daemon will back up every 4 hours.");
}
```

- [ ] **Step 3: Register in command tree**

In `lib/command-tree-def.ts`, restructure `backup` to be a branch node with both a default handler and subcommands:

```ts
backup: {
  description: "Write a stamped state.db backup (VACUUM INTO) and prune backups past retention",
  module: "./commands/state.ts",
  fn: "stateBackup",
  args: [
    { name: "JSON", flag: "--json", type: "boolean", default: false, hint: "Print the outcome as JSON" },
    { name: "Local", flag: "--local", type: "boolean", default: false, hint: "Local-only VACUUM INTO backup (no compression or encryption)" },
  ],
  subcommands: {
    init: {
      description: "Set up encrypted state backup: install LFS, create recipients, verify round-trip",
      module: "./commands/state-backup-init.ts",
      fn: "stateBackupInit",
      args: [],
    },
  },
},
```

- [ ] **Step 4: Register in module registry**

Add to `lib/module-registry.ts`:

```ts
"./commands/state-backup-init.ts": () => import("../commands/state-backup-init.ts"),
```

- [ ] **Step 5: Run doc-gen and tests**

Run: `bun scripts/gen-docs.ts && bun test commands/__tests__/state-backup-init.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add commands/state-backup-init.ts commands/__tests__/state-backup-init.test.ts lib/command-tree-def.ts lib/module-registry.ts website/docs/reference/
git commit -m "add rt state backup init: bootstrap LFS, recipients, and round-trip verify"
```

---

### Task 5: Extend `rt state backup` and daemon sweep

The existing `rt state backup` runs the full pipeline by default. `--local` preserves the old local-only behavior. The daemon sweep changes from 24h to 4h and calls the orchestrator.

**Files:**
- Modify: `commands/state.ts` (`stateBackup` handler)
- Modify: `lib/daemon.ts:778-787` (update sweep interval and callback)
- Modify: `commands/__tests__/state-backup.test.ts`

**Interfaces:**
- Consumes: `runFullBackup()`, `pruneOldBackups()`, `isBackupConfigured()` from `lib/state/backup-orchestrator.ts`
- Produces: modified `stateBackup(args, ctx)` handler

- [ ] **Step 1: Update existing tests and add --local test**

The existing tests at lines 72, 79, 90, 132 of `commands/__tests__/state-backup.test.ts` call `stateBackup([])` and expect legacy VACUUM INTO behavior. Since the default path now requires encrypted backup to be configured, update these four calls to pass `["--local"]` (and `["--local", "--json"]` at line 79). Also note the file uses `test` not `it`, and new tests may need `Database` and `readdirSync` imports.

Add a new test using the existing scaffolding pattern (isolated HOME, `runCapturingExit`):

```ts
it("--local runs the legacy VACUUM INTO backup", async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "sb-local-")));
  const origHome = process.env.HOME!;
  process.env.HOME = home;

  try {
    mkdirSync(join(home, ".mattstack", "rt"), { recursive: true });
    const db = new Database(join(home, ".mattstack", "rt", "state.db"));
    db.run("CREATE TABLE t (v TEXT)");
    db.close();

    const { stateBackup } = await import("../state");
    await stateBackup(["--local"], {});

    const backupsDir = join(home, ".mattstack", "rt", "backups");
    const files = readdirSync(backupsDir);
    expect(files.some((f) => f.startsWith("state-"))).toBe(true);
  } finally {
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Modify stateBackup handler**

In `commands/state.ts`, update `stateBackup`. The handler receives `args: string[]`:

```ts
import { runFullBackup, pruneOldBackups, isBackupConfigured } from "../lib/state/backup-orchestrator";

export async function stateBackup(args: string[], _ctx: CommandContext = {}): Promise<void> {
  const json = args.includes("--json");
  const local = args.includes("--local");

  if (local) {
    // Preserve the existing behavior verbatim
    const path = stampedBackupPath();
    backupTo(getStateDb(), path);
    const { removed } = pruneStateBackups();
    if (json) {
      console.log(JSON.stringify({ ok: true, path, pruned: removed.map((r: string) => r) }));
    } else {
      console.log(`rt state backup: wrote ${path}`);
    }
    return;
  }

  if (!isBackupConfigured()) {
    console.error("Backup not configured. Run `rt state backup init` to set up encrypted backup.");
    console.error("Use --local for a local-only unencrypted backup.");
    process.exit(1);
  }

  try {
    const result = await runFullBackup();

    if (result.backed.length === 0 && result.errors.length > 0) {
      if (json) {
        console.log(JSON.stringify({ ok: true, fallback: "local", errors: result.errors }));
      } else {
        console.error(`All sources failed: ${result.errors.join(", ")}`);
        console.error("Falling back to local-only backup");
      }
      backupTo(getStateDb(), stampedBackupPath());
      pruneStateBackups();
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
    console.error(`Encrypted backup failed: ${err instanceof Error ? err.message : err}`);
    console.error("Falling back to local-only backup");
    backupTo(getStateDb(), stampedBackupPath());
    pruneStateBackups();
  }
}
```

- [ ] **Step 3: --local flag already added to command tree in Task 4 Step 3**

The `backup` node was restructured in Task 4 to include the `--local` flag in its `args` array.

- [ ] **Step 4: Update daemon sweep**

In `lib/daemon.ts`, replace the existing `scheduleSweep("state-backup", ...)` block (line ~778):

```ts
scheduleSweep(
  "state-backup",
  async () => {
    const { isBackupConfigured, runFullBackup, pruneOldBackups } = await import("./state/backup-orchestrator");

    if (!isBackupConfigured()) {
      backupTo(getStateDb("daemon"), stampedBackupPath());
      const { removed } = pruneStateBackups();
      if (removed.length > 0) log.info({ removed: removed.length }, "pruned old state.db backups");
      return;
    }

    try {
      const result = await runFullBackup();

      if (result.backed.length === 0 && result.errors.length > 0) {
        log.error({ errors: result.errors }, "all encrypted sources failed, falling back to local");
        backupTo(getStateDb("daemon"), stampedBackupPath());
        pruneStateBackups();
        return;
      }

      log.info(
        { backed: result.backed.length, errors: result.errors.length },
        "encrypted state backup complete",
      );
      if (result.errors.length > 0) {
        log.warn({ errors: result.errors }, "backup errors");
      }

      const { removed } = await pruneOldBackups();
      if (removed.length > 0) {
        log.info({ removed: removed.length }, "pruned old encrypted backups");
      }
    } catch (err) {
      log.error({ err }, "encrypted backup failed, falling back to local");
      backupTo(getStateDb("daemon"), stampedBackupPath());
      pruneStateBackups();
    }
  },
  { bootDelayMs: 60_000, intervalMs: 4 * 60 * 60 * 1000 },
  log,
)
```

- [ ] **Step 5: Run doc-gen and tests**

Run: `bun scripts/gen-docs.ts && bun test commands/__tests__/state-backup.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add commands/state.ts lib/daemon.ts website/docs/reference/
git commit -m "extend rt state backup: full encrypted pipeline by default, --local for legacy, 4h daemon sweep"
```

---

### Task 6: Restore from backup (`rt state restore --from-backup`)

Full reverse pipeline: pull home repo, LFS fetch, decrypt, decompress, integrity check, place.

**Files:**
- Modify: `commands/state.ts` (`stateRestore` handler)
- Modify: `lib/command-tree-def.ts` (add flags to `restore`)
- Create: `commands/__tests__/state-restore-from-backup.test.ts`

**Interfaces:**
- Consumes: `restorePipeline()` from `lib/state/backup-pipeline.ts`, `readAgeKey(seams: AgeKeySeam)` and `createRealAgeKeySeam()` from `lib/home/age-key.ts`, `backupDestDir()` and `BACKUP_SOURCES` from `lib/state/backup-sources.ts`, `quickCheck()` from `lib/state/db.ts`
- Produces: extended `stateRestore(args: string[], ctx: CommandContext)` handler with `--from-backup`, `--only`, `--at`, `--dry-run`, `--identity`

- [ ] **Step 1: Write failing test**

```ts
// commands/__tests__/state-restore-from-backup.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, copyFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Database } from "bun:sqlite";
import { spawn } from "bun";

describe("state restore --from-backup", () => {
  let home: string;
  let origHome: string;

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), "sr-test-"));
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

    // Verify the original data is back
    const db = new Database(join(home, ".mattstack", "rt", "state.db"), { readonly: true });
    const rows = db.query("SELECT v FROM t").all() as Array<{ v: string }>;
    db.close();
    expect(rows[0].v).toBe("original");
  });
});
```

- [ ] **Step 2: Create the restore module**

```ts
// lib/state/backup-restore.ts
import { join, basename } from "path";
import { existsSync, readdirSync, statSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from "fs";
import { mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { Database } from "bun:sqlite";
import { mattstackHome } from "../rt-paths";
import { restorePipeline } from "./backup-pipeline";
import { backupDestDir, BACKUP_SOURCES, resolveSourcePath } from "./backup-sources";

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

function findLatestBackup(appDir: string, sourcePrefix: string, atTimestamp?: string): string | null {
  if (!existsSync(appDir)) return null;
  const files = readdirSync(appDir)
    .filter((f) => f.endsWith(".zst.age") && f.startsWith(sourcePrefix))
    .sort()
    .reverse();

  if (atTimestamp) {
    const match = files.find((f) => f.includes(atTimestamp));
    return match ? join(appDir, match) : null;
  }

  return files.length > 0 ? join(appDir, files[0]) : null;
}

export async function restoreFromBackup(opts: RestoreOptions): Promise<RestoreResult> {
  const result: RestoreResult = { restored: [], skipped: [], errors: [] };
  const baseDir = backupDestDir();
  const tmpDir = await mkdtemp(join(tmpdir(), "state-restore-"));

  try {
    const sources = opts.only
      ? BACKUP_SOURCES.filter((s) => s.app === opts.only)
      : BACKUP_SOURCES;

    for (const source of sources) {
      const appDir = join(baseDir, source.app);
      const sourcePrefix = source.sourcePath.replace(/\//g, "-").replace(/\.[^.]+$/, "");
      const backupFile = findLatestBackup(appDir, sourcePrefix, opts.at);

      if (!backupFile) {
        result.skipped.push(`${source.app}: no backup found`);
        continue;
      }

      if (opts.dryRun) {
        result.restored.push({
          app: source.app,
          targetPath: resolveSourcePath(source),
        });
        continue;
      }

      const restoredPath = join(tmpDir, `${source.app}-${basename(source.sourcePath)}`);

      try {
        await restorePipeline(backupFile, restoredPath, opts.identityPath);

        if (source.type === "sqlite") {
          const db = new Database(restoredPath, { readonly: true });
          try {
            const check = db.query("PRAGMA quick_check").all() as Array<{ quick_check: string }>;
            if (check[0]?.quick_check !== "ok") {
              result.errors.push(`${source.app}: integrity check failed`);
              continue;
            }
          } finally {
            db.close();
          }

          const targetPath = resolveSourcePath(source);
          mkdirSync(join(targetPath, ".."), { recursive: true });
          copyFileSync(restoredPath, targetPath);
          // Clean up WAL/SHM sidecars if present
          for (const ext of ["-wal", "-shm"]) {
            const sidecar = targetPath + ext;
            if (existsSync(sidecar)) rmSync(sidecar);
          }
          result.restored.push({ app: source.app, targetPath });
        } else {
          // tar: extract to target directory
          const targetPath = resolveSourcePath(source);
          mkdirSync(targetPath, { recursive: true });
          const proc = Bun.spawnSync(["tar", "-xf", restoredPath, "-C", targetPath]);
          if (proc.exitCode !== 0) {
            result.errors.push(`${source.app}: tar extract failed`);
            continue;
          }
          result.restored.push({ app: source.app, targetPath });
        }
      } catch (err) {
        result.errors.push(
          `${source.app}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }

  return result;
}

export async function pullHomeRepo(): Promise<void> {
  const homeRepo = join(mattstackHome(), "user");
  let proc = Bun.spawnSync(["git", "pull", "--ff-only"], { cwd: homeRepo });
  if (proc.exitCode !== 0) {
    throw new Error(`git pull failed: ${proc.stderr.toString()}`);
  }

  proc = Bun.spawnSync(["git", "lfs", "pull"], { cwd: homeRepo });
  if (proc.exitCode !== 0) {
    throw new Error(`git lfs pull failed: ${proc.stderr.toString()}`);
  }
}
```

- [ ] **Step 3: Wire into the stateRestore handler**

In `commands/state.ts`, extend `stateRestore`. Handler receives `args: string[]`. Parse flags via `args.includes()` and `flagValue()` from `lib/cli-args.ts`:

```ts
`commands/state.ts` already imports `closeStateDb` (line 20). Add `tmpdir` to the `os` import and `writeFileSync`/`unlinkSync` to the `fs` import. Add these new imports:

```ts
import { restoreFromBackup, pullHomeRepo } from "../lib/state/backup-restore";
import { readAgeKey, createRealAgeKeySeam } from "../lib/home/age-key";
import { flagValue } from "../lib/cli-args";

// At the top of stateRestore, before the existing positional-arg logic:
if (args.includes("--from-backup")) {
  const force = args.includes("--force");
  const dryRun = args.includes("--dry-run");
  const only = flagValue(args, "--only");
  const at = flagValue(args, "--at");
  const identityFlag = flagValue(args, "--identity");

  if (!force && (await isDaemonRunning())) {
    fail("the daemon is running. Stop it first (rt daemon stop) or pass --force to override");
  }

  let identityPath: string;
  let tmpKeyFile: string | null = null;

  if (identityFlag) {
    // Team key or explicit key file provided
    identityPath = identityFlag;
  } else {
    // Try keychain age key
    const seams = createRealAgeKeySeam();
    const keyResult = await readAgeKey(seams);
    if ("absent" in keyResult) {
      console.error("Age key not found in keychain.");
      console.error("On a new machine, use --identity <path-to-team-key> to decrypt with the team key.");
      process.exit(1);
    }

    tmpKeyFile = join(tmpdir(), `age-identity-${process.pid}.txt`);
    writeFileSync(tmpKeyFile, keyResult.key, { mode: 0o600 });
    identityPath = tmpKeyFile;
  }

  try {
    console.log("Pulling latest backups from home repo...");
    await pullHomeRepo();

    closeStateDb();

    const result = await restoreFromBackup({
      identityPath,
      only: only || undefined,
      at: at || undefined,
      dryRun,
    });

    if (dryRun) {
      console.log("Dry run. Would restore:");
    }

    for (const r of result.restored) {
      console.log(`  ${r.app} -> ${r.targetPath}`);
    }
    for (const s of result.skipped) {
      console.log(`  skipped: ${s}`);
    }
    for (const e of result.errors) {
      console.error(`  error: ${e}`);
    }
  } finally {
    if (tmpKeyFile) unlinkSync(tmpKeyFile);
  }

  return;
}
```

- [ ] **Step 4: Add flags to command tree**

In `lib/command-tree-def.ts`, add to the `restore` args array:

```ts
{ name: "FromBackup", flag: "--from-backup", type: "boolean", default: false, hint: "Restore from encrypted backup in home repo" },
{ name: "Only", flag: "--only", type: "text", optional: true, hint: "Restore only this app (rt, board, gitq)" },
{ name: "At", flag: "--at", type: "text", optional: true, hint: "Restore from backup at this timestamp" },
{ name: "Identity", flag: "--identity", type: "text", optional: true, hint: "Path to age identity file (for team key restore on new machine)" },
{ name: "DryRun", flag: "--dry-run", type: "boolean", default: false, hint: "Show what would be restored" },
```

- [ ] **Step 5: Run doc-gen and tests**

Run: `bun scripts/gen-docs.ts && bun test commands/__tests__/state-restore-from-backup.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/state/backup-restore.ts commands/state.ts commands/__tests__/state-restore-from-backup.test.ts lib/command-tree-def.ts website/docs/reference/
git commit -m "add rt state restore --from-backup: pull, decrypt, decompress, integrity check, place, --identity for team key"
```

---

### Task 7: Backup status command (`rt state backup status`)

Reporting command showing backup health. Nested under `backup` as a subcommand.

**Files:**
- Create: `commands/state-backup-status.ts`
- Modify: `lib/command-tree-def.ts` (add `status` subcommand under `backup`)
- Modify: `lib/module-registry.ts` (register thunk)
- Create: `commands/__tests__/state-backup-status.test.ts`

**Interfaces:**
- Consumes: `isBackupConfigured()` from `lib/state/backup-orchestrator.ts`, `backupDestDir()` and `recipientsPath()` from `lib/state/backup-sources.ts`
- Produces: `stateBackupStatus(args: string[], ctx: CommandContext): Promise<void>` (command handler)

- [ ] **Step 1: Write failing test**

```ts
// commands/__tests__/state-backup-status.test.ts
import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("state backup status", () => {
  let home: string;
  let origHome: string;
  let logSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "ss-test-")));
    origHome = process.env.HOME!;
    process.env.HOME = home;
    mkdirSync(join(home, ".mattstack", "user", "state-backups"), { recursive: true });
    logSpy = spyOn(console, "log");
  });

  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
    logSpy.mockRestore();
  });

  it("reports not configured when recipients.txt is missing", async () => {
    const errorSpy = spyOn(console, "error");
    const { stateBackupStatus } = await import("../state-backup-status");
    await stateBackupStatus([], {});

    const output = logSpy.mock.calls.flat().join(" ");
    expect(output).toContain("not configured");
    errorSpy.mockRestore();
  });

  it("reports configured with recipient count", async () => {
    writeFileSync(
      join(home, ".mattstack", "user", "state-backups", "recipients.txt"),
      "age1key1\nage1key2\n",
    );

    const { stateBackupStatus } = await import("../state-backup-status");
    await stateBackupStatus([], {});

    const output = logSpy.mock.calls.flat().join(" ");
    expect(output).toContain("2 recipient");
  });
});
```

- [ ] **Step 2: Implement state-backup-status.ts**

```ts
// commands/state-backup-status.ts
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { isBackupConfigured } from "../lib/state/backup-orchestrator";
import { backupDestDir, recipientsPath } from "../lib/state/backup-sources";
import type { CommandContext } from "../lib/command-tree";

export async function stateBackupStatus(args: string[], _ctx: CommandContext): Promise<void> {
  const json = args.includes("--json");

  if (!isBackupConfigured()) {
    console.log("State backup is not configured. Run `rt state backup init` to set up.");
    return;
  }

  const recip = readFileSync(recipientsPath(), "utf-8")
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#"));

  const baseDir = backupDestDir();
  const apps = ["rt", "board", "gitq"];
  const status: Array<{ app: string; lastBackup: string | null; count: number; totalBytes: number }> = [];

  for (const app of apps) {
    const appDir = join(baseDir, app);
    if (!existsSync(appDir)) {
      status.push({ app, lastBackup: null, count: 0, totalBytes: 0 });
      continue;
    }

    const files = readdirSync(appDir)
      .filter((f) => f.endsWith(".zst.age"))
      .sort()
      .reverse();

    let totalBytes = 0;
    for (const f of files) {
      totalBytes += statSync(join(appDir, f)).size;
    }

    status.push({
      app,
      lastBackup: files[0] ?? null,
      count: files.length,
      totalBytes,
    });
  }

  if (json) {
    console.log(JSON.stringify({ configured: true, recipients: recip.length, apps: status }));
    return;
  }

  console.log(`State backup: configured, ${recip.length} recipient(s)`);
  console.log(`Sweep: every 4 hours`);
  console.log("");

  for (const s of status) {
    if (s.lastBackup) {
      console.log(`  ${s.app}: ${s.count} backup(s), ${(s.totalBytes / 1024).toFixed(0)}K total, latest: ${s.lastBackup}`);
    } else {
      console.log(`  ${s.app}: no backups`);
    }
  }
}
```

- [ ] **Step 3: Register in command tree and module registry**

Add the `status` subcommand to the `backup` node in `lib/command-tree-def.ts`:

```ts
status: {
  description: "Show state backup health: last backup time, sizes, recipients",
  module: "./commands/state-backup-status.ts",
  fn: "stateBackupStatus",
  args: [
    { name: "JSON", flag: "--json", type: "boolean", default: false, hint: "Print as JSON" },
  ],
},
```

Add to `lib/module-registry.ts`:

```ts
"./commands/state-backup-status.ts": () => import("../commands/state-backup-status.ts"),
```

- [ ] **Step 4: Run doc-gen and tests**

Run: `bun scripts/gen-docs.ts && bun test commands/__tests__/state-backup-status.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add commands/state-backup-status.ts commands/__tests__/state-backup-status.test.ts lib/command-tree-def.ts lib/module-registry.ts website/docs/reference/
git commit -m "add rt state backup status: report backup health, recipient count, per-app sizes"
```
