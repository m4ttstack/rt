import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { mattstackHome } from "../lib/rt-paths.ts";
import { isBackupConfigured } from "../lib/state/backup-orchestrator.ts";
import { backupDestDir, recipientsPath } from "../lib/state/backup-sources.ts";
import { findBackupTool } from "../lib/state/backup-tools.ts";
import { originPushState } from "../lib/setup/home-git.ts";
import { execWithTimeout } from "../lib/setup/probes.ts";
import type { CommandContext } from "../lib/command-tree.ts";

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

  const homeRepo = join(mattstackHome(), "user");
  let pushState = "unknown";
  let lfsState = "unknown";

  if (existsSync(join(homeRepo, ".git"))) {
    const ps = await originPushState(execWithTimeout, homeRepo);
    switch (ps.kind) {
      case "up-to-date": pushState = "synced"; break;
      case "ahead": pushState = `${ps.count} commit(s) ahead`; break;
      case "no-ref": pushState = "no remote tracking ref"; break;
      default: pushState = "unknown";
    }

    const gitLfs = findBackupTool("git-lfs");
    if (!gitLfs) {
      lfsState = "git-lfs not found";
    } else {
      const checkAttr = Bun.spawnSync(
        ["git", "check-attr", "filter", "--", "*.age"],
        { cwd: homeRepo, stderr: "pipe", env: { ...process.env } },
      );
      const attrOut = checkAttr.stdout.toString();
      lfsState = attrOut.includes("filter: lfs") ? "filter active" : "filter not configured";
    }
  }

  if (json) {
    console.log(JSON.stringify({
      configured: true,
      recipients: recip.length,
      pushState,
      lfsState,
      apps: status,
    }));
    return;
  }

  console.log(`State backup: configured, ${recip.length} recipient(s)`);
  console.log(`Sweep: every 4 hours`);
  console.log(`Push: ${pushState}`);
  console.log(`LFS: ${lfsState}`);
  console.log("");

  for (const s of status) {
    if (s.lastBackup) {
      console.log(`  ${s.app}: ${s.count} backup(s), ${(s.totalBytes / 1024).toFixed(0)}K total, latest: ${s.lastBackup}`);
    } else {
      console.log(`  ${s.app}: no backups`);
    }
  }
}
