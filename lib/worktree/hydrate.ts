/**
 * Hydrate: build an on-deck member from the golden tree instead of a cold
 * create. Same registry-first ordering and same scrap path as create.ts.
 * The member is born at the golden's readyStamp (not origin/<default>) and
 * inherits readyStamp/readyAt, so the next freshen pass owns catching it
 * up: `changed:` steps fire only if the ladder's inputs moved since.
 */
import { isAbsolute, join, relative, dirname } from "path";
import { mkdirSync } from "fs";
import { loadRegistry, saveRegistry, usedNames, type TreeRecord } from "./registry.ts";
import { runGit, listWorktreesAsync, ensureInfoExclude } from "./git-async.ts";
import { pickName } from "./names.ts";
import { loadWorktreeRepoConfig } from "./config.ts";
import { withTreeLock } from "./locks.ts";
import { scrapTree, type CreateDeps } from "./create.ts";
import { runCapture, MAX_LOGGED_OUTPUT, outputTail } from "../subprocess.ts";
import { rtBinaryPath } from "../dev-mode.ts";
import { reconcileForRepo } from "../daemon/doppler-sync.ts";
import { deriveRepoIdentity } from "../settings/identity.ts";

const ADD_TIMEOUT_MS = 5 * 60_000;
const CLONE_TIMEOUT_MS = 15 * 60_000;

export type CloneRunner = (src: string, dst: string) => Promise<{ exitCode: number; stderr: string }>;

export const defaultCloneRunner: CloneRunner = async (src, dst) => {
  const r = await runCapture([rtBinaryPath(), "worktree", "hydrate-clone", src, dst], {
    timeoutMs: CLONE_TIMEOUT_MS,
    stderr: "pipe",
  });
  return { exitCode: r.exitCode, stderr: r.stderr.trim() };
};

/**
 * `-z` records, not `--porcelain` lines: porcelain v1 C-quotes any path with a
 * space or a special byte, and a quoted path would be cloned to the wrong
 * place and fail every hydrate for that repo into permanent backoff.
 */
export function parseIgnoredPaths(porcelainZ: string): string[] {
  const out: string[] = [];
  for (const line of porcelainZ.split("\0")) {
    if (!line.startsWith("!! ")) continue;
    let p = line.slice(3);
    if (p.endsWith("/")) p = p.slice(0, -1);
    if (p.endsWith(".log") || p === ".git" || p.startsWith(".git/")) continue;
    out.push(p);
  }
  return out;
}

export async function listIgnoredPaths(treePath: string): Promise<string[] | null> {
  const r = await runGit(treePath, ["status", "--ignored", "--porcelain", "-z"]);
  if (r.exitCode !== 0) return null;
  return parseIgnoredPaths(r.stdout);
}

type CloneOutcome =
  | { kind: "ok" }
  | { kind: "unavailable"; detail: string }
  | { kind: "failed"; step: string; output: string };

export type HydrateResult =
  | { ok: true; tree: TreeRecord }
  | { ok: false; error: "busy" }
  | { ok: false; error: "hydrate-unavailable"; detail: string }
  | { ok: false; error: "create-failed"; failedStep: string; output: string };

export async function hydrateTree(deps: CreateDeps & { golden: TreeRecord; clone?: CloneRunner }): Promise<HydrateResult> {
  const { repoName, repoPath, golden } = deps;
  const readyStamp = golden.readyStamp;
  if (!readyStamp) return { ok: false, error: "hydrate-unavailable", detail: "golden has no readyStamp" };
  const clone = deps.clone ?? defaultCloneRunner;

  const cfg = await loadWorktreeRepoConfig(repoName, repoPath);
  const existing = loadRegistry(repoName);
  const name = pickName(cfg.namePool, usedNames(existing));
  const path = join(cfg.root, name);

  const rel = relative(repoPath, cfg.root);
  const rootInsideRepo = rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
  if (rootInsideRepo) await ensureInfoExclude(repoPath, `${rel.split("/")[0]}/`);

  const outcome = await withTreeLock(path, () => runHydrate(deps, clone, golden, readyStamp, name, path));
  if (outcome === "busy") return { ok: false, error: "busy" };
  return outcome;
}

async function runHydrate(
  deps: CreateDeps,
  clone: CloneRunner,
  golden: TreeRecord,
  readyStamp: string,
  name: string,
  path: string,
): Promise<HydrateResult> {
  const { repoName, repoPath, emit, log } = deps;
  const branch = `on-deck/${name}`;
  const rec: TreeRecord = { name, path, kind: "ephemeral", state: "creating", branch, createdAt: new Date().toISOString() };

  const trees = loadRegistry(repoName);
  trees.push(rec);
  if (!saveRegistry(repoName, trees)) {
    log.warn({ repo: repoName, tree: name, path }, "worktree hydrate: registry-first write dropped; no git mutation attempted");
    return { ok: false, error: "create-failed", failedStep: "registry-write", output: "" };
  }

  // Only a branch this attempt's own `git worktree add -b` brought into being
  // may be deleted on the way out.
  let branchCreated = false;

  const fail = async (failedStep: string, output: string): Promise<HydrateResult> => {
    log.warn(
      { repo: repoName, tree: name, failedStep, output: outputTail(output, MAX_LOGGED_OUTPUT) },
      "worktree hydrate failed",
    );
    await scrapTree(deps, rec, { deleteBranch: branchCreated });
    return { ok: false, error: "create-failed", failedStep, output };
  };
  const unavailable = async (detail: string): Promise<HydrateResult> => {
    log.warn({ repo: repoName, tree: name, detail }, "worktree hydrate unavailable; caller falls back to cold create");
    await scrapTree(deps, rec, { deleteBranch: branchCreated });
    return { ok: false, error: "hydrate-unavailable", detail };
  };

  const add = await runGit(repoPath, ["worktree", "add", "-b", branch, path, readyStamp], { timeoutMs: ADD_TIMEOUT_MS });
  if (add.exitCode !== 0) return fail(`git worktree add -b ${branch} ${path} ${readyStamp}`, add.stdout + add.stderr);
  branchCreated = true;

  const gitEntries = await listWorktreesAsync(repoPath);
  if (gitEntries !== null) {
    const derived = await deriveRepoIdentity(repoPath);
    await reconcileForRepo({ repoIdentity: derived.kind === "remote" ? derived.id : null, worktreeRoots: gitEntries.map((w) => w.path) });
  }

  // The donor's own lock, not just the member's: freshen reinstalls the
  // golden in place, and a reconciler pass released at its deadline is only
  // safe because every git mutation still running holds a per-tree lock.
  // Enumerating and cloning an unlocked donor mid-reinstall would hand the
  // member a torn node_modules under a readyStamp that says it is fine.
  const cloned = await withTreeLock(golden.path, async (): Promise<CloneOutcome> => {
    const artifacts = await listIgnoredPaths(golden.path);
    if (artifacts === null) {
      return { kind: "failed", step: "git status --ignored -z (golden)", output: "git status failed on the golden tree" };
    }
    for (const relPath of artifacts) {
      const src = join(golden.path, relPath);
      const dst = join(path, relPath);
      mkdirSync(dirname(dst), { recursive: true });
      const r = await clone(src, dst);
      if (r.exitCode === 0) continue;
      if (r.exitCode === 3 || r.exitCode === 4) return { kind: "unavailable", detail: r.stderr };
      return { kind: "failed", step: `hydrate-clone ${relPath}`, output: r.stderr };
    }
    return { kind: "ok" };
  });
  if (cloned === "busy") return unavailable("golden tree lock is held");
  if (cloned.kind === "unavailable") return unavailable(cloned.detail);
  if (cloned.kind === "failed") return fail(cloned.step, cloned.output);

  const updated: TreeRecord = {
    ...rec,
    state: "on-deck",
    readyStamp,
    ...(golden.readyAt ? { readyAt: golden.readyAt } : {}),
  };
  const finalTrees = loadRegistry(repoName).map((t) => (t.path === path ? updated : t));
  if (!saveRegistry(repoName, finalTrees)) {
    log.warn({ repo: repoName, tree: name, path }, "worktree hydrate: final registry flip dropped; leaving row creating");
    return { ok: false, error: "create-failed", failedStep: "registry-flip", output: "" };
  }

  emit("worktree:created", { repo: repoName, tree: name, path, kind: "ephemeral", hydratedFrom: golden.name });
  log.info({ repo: repoName, tree: name, path, golden: golden.name }, "worktree hydrated from golden");
  return { ok: true, tree: updated };
}
