/**
 * rt skills sync -- bring a pack's compiled skills and installed plugin
 * caches current: pull engine and pack checkouts, update the engine plugin,
 * recompile and recheck on drift, commit and push, update the pack plugin,
 * and flag any cswap session whose plugins symlink has drifted.
 *
 *   rt skills sync [--pack <name>] [--manifest <path>] [--json]
 *
 * The full step chain and its refusal conditions live in lib/skills/sync.ts;
 * this file only wires real dependencies (git/claude subprocesses, checkPack,
 * compilePackAll) and renders the resulting SyncReport.
 */

import { homedir } from "os";
import { join } from "path";
import { discoverPacks, type PackInfo } from "../lib/skills/packs.ts";
import { resolveClaudeBin } from "../lib/claude-bin.ts";
import { syncPack, type SyncDeps, type SyncReport, type SyncStep } from "../lib/skills/sync.ts";
import { checkPack, compilePackAll } from "./skills.ts";

/**
 * The mattstack pack is the only valid sync engine: falling back to the pack
 * itself when no mattstack pack is discovered would silently point
 * update-engine's version compare and loadStepSource's lookups at the wrong
 * plugin, so an absent engine refuses instead of guessing.
 */
export function deriveEngine(packs: PackInfo[], pack: PackInfo): { engine: PackInfo } | { error: string } {
  const mattstack = packs.find((p) => p.name === "mattstack");
  if (mattstack) return { engine: mattstack };
  if (pack.name === "mattstack") return { engine: pack };
  return {
    error: `no "mattstack" engine pack discovered alongside "${pack.name}" (looked for a plugin named "mattstack" registered via extraKnownMarketplaces in Claude's settings.json); register the mattstack marketplace and re-run`,
  };
}

function flagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
}

function stepLine(step: SyncStep): string {
  switch (step.status) {
    case "ran": return `${step.name}: ran (${step.detail})`;
    case "skipped": return `${step.name}: skipped (${step.detail})`;
    case "refused": return `${step.name}: refused: ${step.detail}`;
    case "failed": return `${step.name}: failed: ${step.detail}`;
  }
}

function renderHuman(report: SyncReport): void {
  for (const step of report.steps) console.log(stepLine(step));

  const { engine, pack } = report.versions;
  if (engine.before !== engine.after) console.log(`engine: ${engine.before ?? "unknown"} -> ${engine.after ?? "unknown"}`);
  if (pack.installedBefore !== pack.installedAfter) console.log(`pack: ${pack.installedBefore ?? "unknown"} -> ${pack.installedAfter ?? "unknown"}`);

  for (const warning of report.warnings) console.log(`warning: ${warning}`);

  const refusal = report.steps.find((s) => s.status === "refused" || s.status === "failed");
  if (refusal) {
    console.log(`${refusal.status === "refused" ? "refused" : "failed"}: ${refusal.detail}`);
  } else if (report.restartNeeded) {
    console.log("synced; restart running Claude sessions to pick up the new caches");
  } else {
    console.log("already current");
  }
}

export async function skillsSync(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const packFlag = flagValue(args, "--pack");
  const manifest = flagValue(args, "--manifest");

  const fail = (error: string): never => {
    if (json) console.log(JSON.stringify({ ok: false, error }));
    else console.error(`rt skills sync: ${error}`);
    process.exit(1);
  };

  const packs = discoverPacks();
  if (packs.length === 0) fail("no packs discovered (no directory marketplace plugin carries a surface.jsonc); pass --pack <name>");

  const pack = packFlag ? packs.find((p) => p.name === packFlag) : packs.length === 1 ? packs[0] : undefined;
  if (!pack) {
    fail(
      packFlag
        ? `no pack named "${packFlag}" (discovered: ${packs.map((p) => p.name).join(", ")})`
        : `which pack? pass --pack <name> (discovered: ${packs.map((p) => p.name).join(", ")})`,
    );
  }
  const engineResult = deriveEngine(packs, pack!);
  if ("error" in engineResult) {
    fail(engineResult.error);
    return;
  }
  const engine = engineResult.engine;

  const configDir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
  const deps: SyncDeps = {
    run: async (cmd, cmdArgs, opts) => {
      const proc = Bun.spawn([cmd, ...cmdArgs], { cwd: opts?.cwd, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
      return { code: await proc.exited, stdout, stderr };
    },
    claudeBin: resolveClaudeBin(),
    checkPack: async (name) => {
      const payload = await checkPack({ pack: name, ...(manifest ? { manifest } : {}) });
      return { drift: payload.drift };
    },
    compilePack: (name) => compilePackAll({ pack: name, ...(manifest ? { manifest } : {}) }),
    configDir,
    cswapSessionsDir: join(homedir(), ".claude-swap-backup", "sessions"),
  };

  let report: SyncReport;
  try {
    report = await syncPack(pack!, engine, deps);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
    return;
  }

  if (json) console.log(JSON.stringify(report));
  else renderHuman(report);
  if (!report.ok) process.exitCode = 1;
}
