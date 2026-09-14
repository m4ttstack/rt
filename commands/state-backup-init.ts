/**
 * rt state backup init -- bootstrap encrypted state backup (R055).
 *
 *   rt state backup init
 *
 * Installs LFS in the home repo, adds the `*.age` LFS tracking rule to
 * .gitattributes, creates recipients.txt with this machine's personal age
 * key, runs the first full backup, and verifies a decrypt round-trip plus
 * the LFS filter attaching to the produced .age files. Requires
 * `rt home init` to have already run (the home repo must exist as a git
 * repo) and `age`/`zstd`/`git-lfs` to resolve on PATH.
 */

import { existsSync, writeFileSync, mkdirSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { ensureAgeKey, readAgeKey, createRealAgeKeySeam } from "../lib/home/age-key.ts";
import { recipientsPath, backupDestDir } from "../lib/state/backup-sources.ts";
import { runFullBackup } from "../lib/state/backup-orchestrator.ts";
import { restorePipeline } from "../lib/state/backup-pipeline.ts";
import { mattstackHome } from "../lib/rt-paths.ts";
import type { CommandContext } from "../lib/command-tree.ts";

export async function stateBackupInit(_args: string[], _ctx: CommandContext = {}): Promise<void> {
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

  const homeRepo = join(mattstackHome(), "user");
  const gitattributes = join(homeRepo, ".gitattributes");

  const lfsInit = Bun.spawnSync(["git", "lfs", "install"], { cwd: homeRepo });
  if (lfsInit.exitCode !== 0) {
    console.error("git lfs install failed:", lfsInit.stderr.toString());
    process.exit(1);
  }

  // Tracking rule must exist before the first .age file lands, or LFS never
  // picks up files already committed as plain git objects.
  const trackRule = "*.age filter=lfs diff=lfs merge=lfs -text\n";
  const existingAttrs = existsSync(gitattributes) ? readFileSync(gitattributes, "utf-8") : "";
  if (!existingAttrs.includes("*.age filter=lfs")) {
    writeFileSync(gitattributes, existingAttrs + trackRule);
    console.log("Added LFS tracking for *.age to .gitattributes");
  }

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

  console.log("Running initial backup...");
  const result = await runFullBackup();
  for (const b of result.backed) {
    console.log(`  ${b.app}: ${b.sizeBytes} bytes`);
  }
  if (result.errors.length > 0) {
    console.error("Errors:", result.errors.join(", "));
    process.exit(1);
  }

  console.log("Verifying decrypt round-trip...");
  const verifyDir = await mkdtemp(join(tmpdir(), "backup-verify-"));
  try {
    const keyResult = await readAgeKey(seams);
    if (!("key" in keyResult)) throw new Error("Age key not found in keychain");

    const keyFile = join(verifyDir, "identity.txt");
    writeFileSync(keyFile, keyResult.key, { mode: 0o600 });

    const first = result.backed[0];
    if (first) {
      const restoredPath = join(verifyDir, "verify.db");
      await restorePipeline(first.path, restoredPath, keyFile);
      console.log("Decrypt round-trip passed");
    } else {
      console.log("No sources found to back up yet; skipping round-trip verification");
    }
  } finally {
    rmSync(verifyDir, { recursive: true, force: true });
  }

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
