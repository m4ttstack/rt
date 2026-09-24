import { existsSync, lstatSync, readFileSync } from "fs";
import { dirname, join } from "path";
import type { Logger } from "pino";
import type { RunningRunScan } from "../../runs/store.ts";
import { loadRegistry, saveRegistry, type TreeRecord } from "../../worktree/registry.ts";
import { collectFacts, triageRepo } from "../../worktree/triage/facts.ts";
import { sameFingerprint } from "../../worktree/triage/fingerprint.ts";
import { triageCounts, triageRow, type TriageRow } from "../../worktree/triage/verdict.ts";
import { disposeTree } from "../../worktree/dispose.ts";
import { withTreeLock } from "../../worktree/locks.ts";
import { patchTree } from "../../worktree/patch.ts";
import { MUTATING_TIMEOUT_MS, runGit } from "../../worktree/git-async.ts";
import { killWorktreeProcesses } from "../worktree-process-kill.ts";
import { hasLiveCwdInside, liveProcessCwds } from "../reconciler/stale-claims.ts";
import { poolRootsReadable } from "../reconciler/reconcile.ts";
import { RETENTION_MS, retireTree, stripTrashDir, writeDisposalManifest } from "../../worktree/trash.ts";
import { loadRepoTracking } from "../../repo-tracking.ts";
import { loadSecrets } from "../../linear.ts";
import { mergeCleanupGap, type MergeCleanupGap } from "../../worktree/merge-cleanup-gap.ts";
import { disposeDeps, targetRepos } from "./worktree.ts";
import type { CommandResult } from "./types.ts";

export interface WorktreeTriageOpts {
  findRunningRunByWorktree: (worktree: string) => RunningRunScan;
  jobTreeHold: (rec: TreeRecord) => string | null;
  kick: () => void;
  emit: (type: string, data: unknown) => void;
  /** Test seam; production reads live cwds via lsof. */
  liveCwds?: () => Promise<Set<string>>;
}

type TriageVerb =
  | "worktree:triage" | "worktree:triage-dispose" | "worktree:keep" | "worktree:unkeep"
  | "worktree:push-branch" | "worktree:triage-diff" | "worktree:triage-remove" | "worktree:stop-holders";

const DIFF_CAP_LINES = 400;
const DIFF_CAP_FILES = 50;
const UNTRACKED_MAX_BYTES = 1_000_000;
const NUL_SNIFF_BYTES = 8192;
const SKIPPED_BINARY = "(binary or larger than 1 MB)";

const fail = (error: string) => ({ ok: false as const, error });

/** Counts are taken before the line cap, so the sheet can say how much it isn't showing. */
type DiffBody = { diff: string; truncated: boolean; added: number; removed: number; totalLines: number };

function capLines(text: string): { diff: string; truncated: boolean } {
  const lines = text.split("\n");
  return { diff: lines.slice(0, DIFF_CAP_LINES).join("\n"), truncated: lines.length > DIFF_CAP_LINES };
}

function lineCount(text: string): number {
  if (text === "") return 0;
  const n = text.split("\n").length;
  return text.endsWith("\n") ? n - 1 : n;
}

/**
 * Only lines inside a hunk count: a `+++`/`---` file header is not a change,
 * and a `diff --git` line opens a new section whose headers come before its hunks.
 */
export function diffStats(text: string): { added: number; removed: number } {
  let added = 0, removed = 0, inHunk = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) { inHunk = false; continue; }
    if (line.startsWith("@@")) { inHunk = true; continue; }
    if (!inHunk) continue;
    if (line.startsWith("+")) added++;
    else if (line.startsWith("-")) removed++;
  }
  return { added, removed };
}

function placeholder(text: string): DiffBody {
  return { diff: text, truncated: true, added: 0, removed: 0, totalLines: 1 };
}

function trackedBody(fullDiff: string): DiffBody {
  return { ...capLines(fullDiff), ...diffStats(fullDiff), totalLines: lineCount(fullDiff) };
}

function readUntracked(abs: string): DiffBody {
  try {
    const st = lstatSync(abs);
    if (!st.isFile()) return placeholder("(not a regular file)");
    if (st.size > UNTRACKED_MAX_BYTES) return placeholder(SKIPPED_BINARY);
    const buf = readFileSync(abs);
    if (buf.subarray(0, NUL_SNIFF_BYTES).includes(0)) return placeholder(SKIPPED_BINARY);
    const text = buf.toString("utf8");
    const lines = lineCount(text);
    return { ...capLines(text), added: lines, removed: 0, totalLines: lines };
  } catch {
    return placeholder("(unreadable)");
  }
}

function fingerprintMatches(row: TriageRow, claimed: unknown): boolean {
  if (!claimed || typeof claimed !== "object") return false;
  return sameFingerprint(row.fingerprint, claimed as TriageRow["fingerprint"]);
}

function disposePlan(
  row: TriageRow,
  discard: unknown,
  confirmOnlyCopy: unknown,
): { error: string } | { force: boolean; acceptDirty: boolean } {
  switch (row.group) {
    case "waiting": case "kept": case "broken":
      return { error: `not-disposable:${row.group}` };
    case "only-copy":
      return confirmOnlyCopy === true ? { force: true, acceptDirty: false } : { error: "only-copy" };
    case "safe":
      if (discard !== undefined && discard !== "classified") return { error: "discard-not-allowed" };
      return { force: false, acceptDirty: row.dirt.kind !== "none" };
    case "look":
      return discard === "all" ? { force: false, acceptDirty: true } : { error: "review-first" };
  }
}

export function createWorktreeTriageHandlers(
  ctx: { repoIndex: () => Record<string, string>; cache: { entries: Record<string, any> }; log: Logger },
  opts: WorktreeTriageOpts,
): { [K in TriageVerb]: (payload: any) => Promise<CommandResult<K>> } {
  // No network: a live poll (the tray, every 10s) must never block on a real
  // `git fetch`. containmentOf's default fetch runs one; this refusal makes
  // an unfetchable MR sha read as "none" (only-copy) instead of stalling.
  const deps = () => ({
    cacheEntries: ctx.cache.entries,
    jobTreeHold: opts.jobTreeHold,
    findRunningRun: opts.findRunningRunByWorktree,
    fetch: async () => false,
    log: ctx.log,
  });

  const findTree = (repo: string, name: string): TreeRecord | null =>
    loadRegistry(repo).find((t) => t.name === name && t.kind === "ephemeral") ?? null;

  const resolve = (payload: any): { repo: string; repoPath: string; rec: TreeRecord } | { error: string } => {
    const [hit] = targetRepos(ctx, typeof payload?.repoName === "string" ? payload.repoName : undefined);
    if (!hit || typeof payload?.repoName !== "string") return { error: "repo-unknown" };
    const rec = typeof payload?.tree === "string" ? findTree(hit[0], payload.tree) : null;
    return rec ? { repo: hit[0], repoPath: hit[1], rec } : { error: "tree-unknown" };
  };

  const freshRow = async (repo: string, repoPath: string, rec: TreeRecord): Promise<TriageRow> =>
    triageRow(await collectFacts(repo, repoPath, rec, deps()));

  return {
    "worktree:triage": async (payload: any) => {
      const repos = targetRepos(ctx, payload?.repoName);
      if (repos.length === 0 && payload?.repoName) return fail("repo-unknown");
      const rows: TriageRow[] = [];
      const banners: Array<{ repo: string; path: string } & MergeCleanupGap> = [];
      const tracking = (() => { try { return loadRepoTracking(); } catch { return null; } })();
      const secrets = await loadSecrets().catch(() => null);
      for (const [repo, path] of repos) {
        try {
          rows.push(...(await triageRepo(repo, path, deps())));
        } catch (err) {
          ctx.log.warn({ err, repo }, "worktree:triage: repo failed");
        }
        const gap = await mergeCleanupGap(repo, path, tracking, secrets);
        if (gap) banners.push({ repo, path, ...gap });
      }
      return { ok: true as const, data: { rows, banners, counts: triageCounts(rows) } };
    },

    // disposeTree takes no lock of its own (its callers hold the tree lock),
    // so the fingerprint check and the dispose share this one lock scope.
    "worktree:triage-dispose": async (payload: any) => {
      const r = resolve(payload);
      if ("error" in r) return fail(r.error);
      const out = await withTreeLock(r.rec.path, async () => {
        const rec = findTree(r.repo, r.rec.name);
        if (!rec || rec.path !== r.rec.path) return fail("changed");
        const row = await freshRow(r.repo, r.repoPath, rec);
        if (!fingerprintMatches(row, payload.fingerprint)) return fail("changed");
        const plan = disposePlan(row, payload.discard, payload.confirmOnlyCopy);
        if ("error" in plan) return fail(plan.error);
        if (plan.acceptDirty) {
          const cwds = await (opts.liveCwds ?? liveProcessCwds)().catch(() => null);
          if (cwds === null) return fail("cwds-unreadable");
          if (hasLiveCwdInside(cwds, rec.path)) return fail("in-use");
        }
        const outcome = await disposeTree(disposeDeps(ctx, opts, r.repo, r.repoPath), rec, { ...plan, auto: false, requireRetention: true });
        if (!outcome.disposed) return fail(outcome.detail ? `${outcome.refusal}:${outcome.detail}` : outcome.refusal);
        return { ok: true as const, data: { disposed: true as const, ...(outcome.trash ? { trash: outcome.trash } : {}) } };
      });
      if (out === "busy") return fail("busy");
      if (out.ok) opts.kick();
      return out;
    },

    "worktree:keep": async (payload: any) => {
      const r = resolve(payload);
      if ("error" in r) return fail(r.error);
      const row = await freshRow(r.repo, r.repoPath, r.rec);
      if (!fingerprintMatches(row, payload.fingerprint)) return fail("changed");
      if (!row.actions.includes("keep")) return fail(`not-keepable:${row.group}`);
      const wrote = patchTree(r.repo, r.rec.path, (t) => { t.kept = { keptAt: new Date().toISOString(), ...row.fingerprint }; });
      if (!wrote) return fail("changed");
      return { ok: true as const, data: { tree: r.rec.name } };
    },

    "worktree:unkeep": async (payload: any) => {
      const r = resolve(payload);
      if ("error" in r) return fail(r.error);
      patchTree(r.repo, r.rec.path, (t) => { delete t.kept; });
      return { ok: true as const, data: { tree: r.rec.name } };
    },

    "worktree:push-branch": async (payload: any) => {
      const r = resolve(payload);
      if ("error" in r) return fail(r.error);
      const branch = r.rec.branch;
      if (!branch) return fail("detached");
      const out = await withTreeLock(r.rec.path, async () => {
        const row = await freshRow(r.repo, r.repoPath, r.rec);
        if (!fingerprintMatches(row, payload.fingerprint)) return fail("changed");
        if (payload.commitDirty === true && row.dirt.files.length > 0) {
          // Classifier paths are verbatim (NUL-split), so they must never be
          // read back as pathspec magic or globs.
          const add = await runGit(r.rec.path, ["--literal-pathspecs", "add", "-A", "--", ...row.dirt.files]);
          if (add.exitCode !== 0) return fail(`commit-failed:${add.stderr.trim()}`);
          const msg = typeof payload.message === "string" && payload.message.trim()
            ? payload.message.trim()
            : `commit ${row.dirt.files.length} leftover file(s) before cleanup`;
          const c = await runGit(r.rec.path, ["commit", "-q", "-m", msg], { timeoutMs: MUTATING_TIMEOUT_MS });
          if (c.exitCode !== 0) return fail(`commit-failed:${c.stderr.trim()}`);
        }
        const push = await runGit(r.rec.path, ["push", "-u", "origin", branch], { timeoutMs: MUTATING_TIMEOUT_MS });
        if (push.exitCode !== 0) return fail(`push-failed:${push.stderr.trim()}`);
        return { ok: true as const, data: { row: await freshRow(r.repo, r.repoPath, findTree(r.repo, r.rec.name) ?? r.rec) } };
      });
      return out === "busy" ? fail("busy") : out;
    },

    "worktree:triage-diff": async (payload: any) => {
      const r = resolve(payload);
      if ("error" in r) return fail(r.error);
      const cwd = r.rec.path;
      const tracked = await runGit(cwd, ["diff", "--name-only", "-z", "HEAD"]);
      const untracked = await runGit(cwd, ["ls-files", "--others", "--exclude-standard", "-z"]);
      if (tracked.exitCode !== 0 || untracked.exitCode !== 0) return fail("diff-failed");
      const listed = [
        ...tracked.stdout.split("\0").filter(Boolean).map((path) => ({ path, status: "modified" as const })),
        ...untracked.stdout.split("\0").filter(Boolean).map((path) => ({ path, status: "untracked" as const })),
      ];
      const files: Array<{ path: string; status: "modified" | "untracked" } & DiffBody> = [];
      for (const { path, status } of listed.slice(0, DIFF_CAP_FILES)) {
        const body = status === "modified"
          ? trackedBody((await runGit(cwd, ["--literal-pathspecs", "diff", "HEAD", "--", path])).stdout)
          : readUntracked(join(cwd, path));
        files.push({ path, status, ...body });
      }
      return { ok: true as const, data: { files, ...(listed.length > DIFF_CAP_FILES ? { truncatedFiles: true as const } : {}) } };
    },

    "worktree:triage-remove": async (payload: any) => {
      const r = resolve(payload);
      if ("error" in r) return fail(r.error);
      const rec = r.rec;
      const out = await withTreeLock(rec.path, async () => {
        // Every tree reads as broken during a volume outage; nothing here may
        // act on that reading.
        if (!existsSync(dirname(rec.path))) return fail("mount-unavailable");
        const row = await freshRow(r.repo, r.repoPath, rec);
        if (row.group !== "broken") return fail("not-broken");
        // A folder left behind would free the name while still occupying the
        // path, and the next create there would reap it outside the trash.
        let trash: { path: string; keptUntil: string } | undefined;
        if (existsSync(rec.path)) {
          const retired = await retireTree(rec.path, rec.name, r.repoPath, { requireRetention: true });
          if (!retired.ok) return fail("remove-failed");
          const keptUntil = new Date(Date.now() + RETENTION_MS).toISOString();
          await writeDisposalManifest(retired.trashPath, {
            name: rec.name, originalPath: rec.path, branch: rec.branch, headSha: null,
            reason: "remove", disposedAt: new Date().toISOString(), keptUntil,
          }, ctx.log);
          void stripTrashDir(retired.trashPath, ctx.log);
          trash = { path: retired.trashPath, keptUntil };
        }
        saveRegistry(r.repo, loadRegistry(r.repo).filter((t) => t.path !== rec.path));
        if (poolRootsReadable(loadRegistry(r.repo))) await runGit(r.repoPath, ["worktree", "prune"]);
        return { ok: true as const, data: { removed: true as const, ...(trash ? { trash } : {}) } };
      });
      if (out === "busy") return fail("busy");
      if (out.ok) opts.kick();
      return out;
    },

    "worktree:stop-holders": async (payload: any) => {
      const r = resolve(payload);
      if ("error" in r) return fail(r.error);
      const row = await freshRow(r.repo, r.repoPath, r.rec);
      if (!row.actions.includes("stop-process")) return fail("not-held");
      const siblings = loadRegistry(r.repo).filter((t) => t.path !== r.rec.path).map((t) => t.path);
      const { terminated } = await killWorktreeProcesses(r.rec.path, { excludePaths: siblings });
      if (terminated.length > 0) opts.kick();
      return { ok: true as const, data: { terminated } };
    },
  };
}
