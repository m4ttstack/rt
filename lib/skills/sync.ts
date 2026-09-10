import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync, writeFileSync } from "fs";
import { join } from "path";
import { CLAUDE_BIN_FALLBACKS } from "../claude-bin.ts";
import type { PackInfo } from "./packs.ts";
import { installedVersionFor, type PluginListEntry } from "./sources.ts";

export type RunResult = { code: number; stdout: string; stderr: string };

export type SyncDeps = {
  run: (cmd: string, args: string[], opts?: { cwd?: string }) => Promise<RunResult>;
  claudeBin: string | null;
  checkPack: (packName: string) => Promise<{ drift: boolean }>;
  compilePack: (packName: string) => Promise<{ ok: boolean; errors: string[] }>;
  configDir: string;
  cswapSessionsDir: string;
};

export type SyncStep = { name: string; status: "ran" | "skipped" | "refused" | "failed"; detail: string };

export type SyncReport = {
  ok: boolean;
  pack: string;
  steps: SyncStep[];
  versions: {
    engine: { before: string | null; after: string | null };
    pack: { source: string; installedBefore: string | null; installedAfter: string | null };
  };
  warnings: string[];
  restartNeeded: boolean;
};

function writeManifestVersion(packDir: string, version: string): void {
  const path = join(packDir, ".claude-plugin", "plugin.json");
  const manifest = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  writeFileSync(path, JSON.stringify({ ...manifest, version }, null, 2) + "\n");
}

export function bumpPatchVersion(packDir: string): { before: string; after: string } {
  const path = join(packDir, ".claude-plugin", "plugin.json");
  const manifest = JSON.parse(readFileSync(path, "utf8")) as { version?: string };
  const before = manifest.version;
  const m = typeof before === "string" ? before.match(/^(\d+)\.(\d+)\.(\d+)$/) : null;
  if (!m) throw new Error(`cannot bump non-semver version in ${path}: ${String(before)}`);
  const after = `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
  writeManifestVersion(packDir, after);
  return { before: before as string, after };
}

type Outcome = Pick<SyncStep, "status" | "detail">;

function ran(detail: string): Outcome {
  return { status: "ran", detail };
}
function skipped(detail: string): Outcome {
  return { status: "skipped", detail };
}
function refused(detail: string): Outcome {
  return { status: "refused", detail };
}
function failed(detail: string): Outcome {
  return { status: "failed", detail };
}

/** Every dep/subprocess call is fallible; a throw here becomes the step's own "failed" entry rather than an escaped rejection. */
async function tryStep(fn: () => Promise<Outcome>): Promise<Outcome> {
  try {
    return await fn();
  } catch (e) {
    return failed(e instanceof Error ? e.message : String(e));
  }
}

function stops(o: Outcome): boolean {
  return o.status === "refused" || o.status === "failed";
}

function pluginId(info: PackInfo): string {
  return `${info.name}@${info.marketplace}`;
}

function readManifestVersion(dir: string): string {
  const path = join(dir, ".claude-plugin", "plugin.json");
  const manifest = JSON.parse(readFileSync(path, "utf8")) as { version?: string };
  if (typeof manifest.version !== "string") throw new Error(`no "version" string in ${path}`);
  return manifest.version;
}

/** True only when pluginsPath is a symlink whose fully resolved target matches target. */
function isAlignedSymlink(pluginsPath: string, target: string): boolean {
  try {
    readlinkSync(pluginsPath);
  } catch {
    return false;
  }
  try {
    return existsSync(target) && realpathSync(pluginsPath) === realpathSync(target);
  } catch {
    return false;
  }
}

/** Unlike existsSync, true for a dangling symlink -- that entry must reach isAlignedSymlink (and its warning) rather than be skipped as absent. */
function pathExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

async function listInstalled(deps: SyncDeps): Promise<PluginListEntry[]> {
  const res = await deps.run(deps.claudeBin!, ["plugin", "list", "--json"]);
  if (res.code !== 0) throw new Error(`claude plugin list --json failed: ${res.stderr.trim()}`);
  return JSON.parse(res.stdout) as PluginListEntry[];
}

export async function syncPack(pack: PackInfo, engine: PackInfo, deps: SyncDeps): Promise<SyncReport> {
  const steps: SyncStep[] = [];
  const warnings: string[] = [];
  const sameCheckout = pack.dir === engine.dir;

  let installedEngineBefore: string | null = null;
  let installedPackBefore: string | null = null;
  let installedEngineAfter: string | null = null;
  let installedPackAfter: string | null = null;
  let engineSourceVersion = "";
  let packSourceVersion = "";
  let bumpBefore: string | null = null;
  let bumpAfter: string | null = null;
  let drift = false;

  const finish = (): SyncReport => ({
    ok: !steps.some(stops),
    pack: pack.name,
    steps,
    versions: {
      engine: { before: installedEngineBefore, after: installedEngineAfter ?? installedEngineBefore },
      pack: { source: packSourceVersion, installedBefore: installedPackBefore, installedAfter: installedPackAfter ?? installedPackBefore },
    },
    warnings,
    restartNeeded: steps.some((s) => (s.name === "update-engine" || s.name === "update-pack") && s.status === "ran"),
  });

  // guards also seeds the installed-list "before" bookkeeping every later
  // step reads, so a throw during that seeding still resolves to a single
  // "guards" failure rather than an uncaught rejection. Manifest versions are
  // NOT read here -- pull-engine/pull-pack can move them, so they are read
  // fresh right after each pull instead (see below).
  const guards = await tryStep(async () => {
    if (!deps.claudeBin) {
      return refused(
        `claude binary not found; checked PATH, ${CLAUDE_BIN_FALLBACKS.join(", ")}; install the Claude CLI or put it on PATH, then re-run`,
      );
    }
    if (!pack.marketplace) {
      return refused(`pack "${pack.name}" has no marketplace; it must be installed from a directory marketplace to sync`);
    }
    if (!engine.marketplace) {
      return refused(`engine "${engine.name}" has no marketplace; it must be installed from a directory marketplace to sync`);
    }
    for (const rel of [".worktrees", join(".claude", "worktrees")]) {
      const dir = join(pack.dir, rel);
      if (existsSync(dir)) {
        return refused(`worktrees directory found at ${dir} (a directory-marketplace update copies the whole working tree); prune it and re-run`);
      }
    }

    const engineStatus = await deps.run("git", ["status", "--porcelain"], { cwd: engine.dir });
    if (engineStatus.code !== 0) return failed(`git status failed in ${engine.dir}: ${engineStatus.stderr.trim()}`);
    if (engineStatus.stdout.trim() !== "") {
      return refused(`engine checkout dirty at ${engine.dir}: "${engineStatus.stdout.trim()}"; commit or stash and re-run`);
    }
    if (!sameCheckout) {
      const packStatus = await deps.run("git", ["status", "--porcelain"], { cwd: pack.dir });
      if (packStatus.code !== 0) return failed(`git status failed in ${pack.dir}: ${packStatus.stderr.trim()}`);
      if (packStatus.stdout.trim() !== "") {
        return refused(`pack checkout dirty at ${pack.dir}: "${packStatus.stdout.trim()}"; commit or stash and re-run`);
      }
    }

    const engineBranchRes = await deps.run("git", ["branch", "--show-current"], { cwd: engine.dir });
    if (engineBranchRes.code !== 0) return failed(`git branch --show-current failed in ${engine.dir}: ${engineBranchRes.stderr.trim()}`);
    const engineBranch = engineBranchRes.stdout.trim();
    if (engineBranch !== "main") {
      return refused(`engine checkout on branch "${engineBranch}"; check out main and re-run`);
    }
    if (!sameCheckout) {
      const packBranchRes = await deps.run("git", ["branch", "--show-current"], { cwd: pack.dir });
      if (packBranchRes.code !== 0) return failed(`git branch --show-current failed in ${pack.dir}: ${packBranchRes.stderr.trim()}`);
      const packBranch = packBranchRes.stdout.trim();
      if (packBranch !== "main") {
        return refused(`pack checkout on branch "${packBranch}"; check out main and re-run`);
      }
    }

    const list = await listInstalled(deps);
    installedEngineBefore = installedVersionFor(list, pluginId(engine));
    installedPackBefore = installedVersionFor(list, pluginId(pack));

    return ran("engine and pack checkouts clean on main");
  });
  steps.push({ name: "guards", ...guards });
  if (stops(guards)) return finish();

  const pullEngine = sameCheckout
    ? skipped("engine and pack share a checkout; pulled once as pull-pack")
    : await tryStep(async () => {
        const res = await deps.run("git", ["pull", "--ff-only"], { cwd: engine.dir });
        if (res.code !== 0) return refused(`git pull --ff-only failed in ${engine.dir}: ${res.stderr.trim()}; resolve manually and re-run`);
        engineSourceVersion = readManifestVersion(engine.dir);
        return ran(res.stdout.trim() || "up to date");
      });
  steps.push({ name: "pull-engine", ...pullEngine });
  if (stops(pullEngine)) return finish();

  const pullPack = await tryStep(async () => {
    const res = await deps.run("git", ["pull", "--ff-only"], { cwd: pack.dir });
    if (res.code !== 0) return refused(`git pull --ff-only failed in ${pack.dir}: ${res.stderr.trim()}; resolve manually and re-run`);
    packSourceVersion = readManifestVersion(pack.dir);
    if (sameCheckout) engineSourceVersion = packSourceVersion;
    return ran(res.stdout.trim() || "up to date");
  });
  steps.push({ name: "pull-pack", ...pullPack });
  if (stops(pullPack)) return finish();

  const updateEngine = await tryStep(async () => {
    if (sameCheckout) return skipped("engine and pack share a checkout; update handled as update-pack");
    if (installedEngineBefore === engineSourceVersion) return skipped(`engine already at ${engineSourceVersion}`);
    const id = pluginId(engine);
    const res = await deps.run(deps.claudeBin!, ["plugin", "update", id]);
    if (res.code !== 0) return failed(`claude plugin update ${id} failed: ${res.stderr.trim()}`);
    installedEngineAfter = engineSourceVersion;
    return ran(`updated ${id}`);
  });
  steps.push({ name: "update-engine", ...updateEngine });
  if (stops(updateEngine)) return finish();

  const checkStep = await tryStep(async () => {
    const result = await deps.checkPack(pack.name);
    drift = result.drift;
    return ran(`drift=${drift}`);
  });
  steps.push({ name: "check", ...checkStep });
  if (stops(checkStep)) return finish();

  const noOp = !drift && installedPackBefore === packSourceVersion;
  if (noOp) return finish();

  const bump = await tryStep(async () => {
    if (!drift) return skipped("no drift; skipping version bump");
    const { before, after } = bumpPatchVersion(pack.dir);
    bumpBefore = before;
    bumpAfter = after;
    packSourceVersion = after;
    return ran(`bumped ${before} -> ${after}`);
  });
  steps.push({ name: "bump", ...bump });
  if (stops(bump)) return finish();

  const compile = await tryStep(async () => {
    if (!drift) return skipped("no drift; skipping compile");
    const result = await deps.compilePack(pack.name);
    if (!result.ok) {
      // A refused compile must leave the checkout exactly as the dirty guard
      // found it (clean) so a re-run does not strand a bare-file bump the
      // guard cannot see committed anywhere -- revert the write-back, no git.
      if (bumpBefore) {
        writeManifestVersion(pack.dir, bumpBefore);
        packSourceVersion = bumpBefore;
      }
      return refused(`${result.errors.join("; ")}; reverted plugin.json to ${bumpBefore} so the checkout stays clean for the next run`);
    }
    return ran("compiled clean");
  });
  steps.push({ name: "compile", ...compile });
  if (stops(compile)) return finish();

  const recheck = await tryStep(async () => {
    if (!drift) return skipped("no drift; skipping recheck");
    const result = await deps.checkPack(pack.name);
    if (result.drift) {
      return refused(
        `content drift survives recompile; pack checkout carries an uncommitted version bump (${bumpBefore} -> ${bumpAfter}) and its compiled output; take the agent path (mattstack:editing-skills), continuing from this working tree`,
      );
    }
    return ran("drift resolved");
  });
  steps.push({ name: "recheck", ...recheck });
  if (stops(recheck)) return finish();

  const commitPush = await tryStep(async () => {
    if (!drift) return skipped("no drift; skipping commit");
    const addPaths = [join(".claude-plugin", "plugin.json"), "skills", "attachments"].filter((rel) => existsSync(join(pack.dir, rel)));
    const add = await deps.run("git", ["add", "--", ...addPaths], { cwd: pack.dir });
    if (add.code !== 0) return failed(`git add failed: ${add.stderr.trim()}`);
    const commit = await deps.run("git", ["commit", "-m", `skills sync: ${pack.name} v${bumpAfter}`], { cwd: pack.dir });
    if (commit.code !== 0) return failed(`git commit failed: ${commit.stderr.trim()}`);
    const push = await deps.run("git", ["push"], { cwd: pack.dir });
    if (push.code !== 0) return failed(`git push failed: ${push.stderr.trim()}`);
    return ran(`committed and pushed v${bumpAfter}`);
  });
  steps.push({ name: "commit-push", ...commitPush });
  if (stops(commitPush)) return finish();

  // Reached only when drift is true, or drift is false with installedPackBefore
  // !== packSourceVersion (the noOp return above already exited the other case) --
  // an update is always due here, so there is no further skip to check.
  const updatePack = await tryStep(async () => {
    const id = pluginId(pack);
    const res = await deps.run(deps.claudeBin!, ["plugin", "update", id]);
    if (res.code !== 0) return failed(`claude plugin update ${id} failed: ${res.stderr.trim()}`);
    return ran(`updated ${id}`);
  });
  steps.push({ name: "update-pack", ...updatePack });
  if (stops(updatePack)) return finish();

  const verifyInstalled = await tryStep(async () => {
    const list = await listInstalled(deps);
    installedPackAfter = installedVersionFor(list, pluginId(pack));
    installedEngineAfter = installedVersionFor(list, pluginId(engine));
    if (installedPackAfter !== packSourceVersion) {
      return failed(`installed version ${installedPackAfter ?? "unknown"} does not match source version ${packSourceVersion} after update`);
    }
    return ran(`installed matches source at ${packSourceVersion}`);
  });
  steps.push({ name: "verify-installed", ...verifyInstalled });
  if (stops(verifyInstalled)) return finish();

  const cswapSweep = await tryStep(async () => {
    if (!existsSync(deps.cswapSessionsDir)) return skipped(`no cswap sessions directory at ${deps.cswapSessionsDir}`);
    const target = join(deps.configDir, "plugins");
    let flagged = 0;
    for (const entry of readdirSync(deps.cswapSessionsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pluginsPath = join(deps.cswapSessionsDir, entry.name, "plugins");
      if (!pathExists(pluginsPath)) continue;
      if (!isAlignedSymlink(pluginsPath, target)) {
        flagged++;
        warnings.push(`cswap session "${entry.name}" plugins dir (${pluginsPath}) does not point at ${target}`);
      }
    }
    return ran(flagged === 0 ? "no divergent sessions" : `${flagged} divergent session(s)`);
  });
  steps.push({ name: "cswap-sweep", ...cswapSweep });

  return finish();
}
