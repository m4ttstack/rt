import { existsSync, readFileSync, statSync } from "fs";
import { join } from "path";
import type { RunningRunScan } from "../../runs/store.ts";
import { composeKey } from "../../state/branch-cache.ts";
import { loadWorktreeRepoConfig } from "../config.ts";
import { containmentOf } from "../containment.ts";
import { classifyDirtForTriage } from "../dirt-class.ts";
import { headSha, remoteDefaultRef, remoteRefExists, runGit } from "../git-async.ts";
import { loadRegistry, type TreeRecord } from "../registry.ts";
import { dirtHash } from "./fingerprint.ts";
import { triageRow, type TriageFacts, type TriageHold, type TriageRow } from "./verdict.ts";

export interface TriageDeps {
  cacheEntries: Record<string, any>;
  jobTreeHold: (rec: TreeRecord) => string | null;
  findRunningRun: (worktree: string) => RunningRunScan;
  fetch?: (treePath: string, sha: string) => Promise<boolean>;
}

export function isStuck(rec: TreeRecord, mrState: string | null, broken: boolean): boolean {
  if (rec.kind !== "ephemeral") return false;
  if (broken) return true;
  if (rec.state === "disposable") return true;
  return rec.state === "claimed" && (mrState === "merged" || mrState === "closed");
}

function isBroken(rec: TreeRecord): boolean {
  if (!existsSync(rec.path)) return true;
  const dotGit = join(rec.path, ".git");
  if (!existsSync(dotGit)) return true;
  if (statSync(dotGit).isFile()) {
    const m = readFileSync(dotGit, "utf8").match(/^gitdir:\s*(.+)$/m);
    return !m || !existsSync(m[1]!.trim());
  }
  return false;
}

/** Mirrors worktree:list's join (handlers/worktree.ts): composite key first,
 *  bare-branch fallback only ever hits an unattributed legacy entry. */
function cacheEntry(repo: string, branch: string | null, entries: Record<string, any>): any {
  if (!branch) return null;
  const e = entries[composeKey(repo, branch)] ?? entries[branch];
  return e && (!e.repoName || e.repoName === repo) ? e : null;
}

function holdOf(rec: TreeRecord, deps: TriageDeps): TriageHold | null {
  if (rec.heldReason) {
    return rec.heldReason.startsWith("stopped stale orphan")
      ? { kind: "orphan-stopping", detail: rec.heldReason }
      : { kind: "process", detail: rec.heldReason };
  }
  if (rec.disposal === "job") {
    const h = deps.jobTreeHold(rec);
    if (h) return { kind: "herd", detail: h };
  }
  const run = deps.findRunningRun(rec.path);
  if (run.kind === "match") return { kind: "run", detail: `pipeline run ${run.run.id} is live at ${run.run.currentStage}` };
  return null;
}

export async function collectFacts(repo: string, repoPath: string, rec: TreeRecord, deps: TriageDeps): Promise<TriageFacts> {
  const entry = cacheEntry(repo, rec.branch, deps.cacheEntries);
  const mrRaw = entry?.mr ?? null;
  // MRInfo (lib/enrich.ts, MRDashboardProps & {sha}) carries no merged/closed
  // timestamp field at all -- only createdAt, which predates any stuck-tree
  // question this panel asks -- so `at` has nothing honest to report but null.
  const mr = mrRaw ? { iid: mrRaw.iid, state: mrRaw.state, title: mrRaw.title, at: null, url: mrRaw.webUrl ?? null } : null;
  const ticket = entry?.ticket ? { identifier: entry.ticket.identifier, title: entry.ticket.title, stateName: entry.ticket.stateName ?? null, url: entry.ticket.url ?? null } : null;
  const empty = { kind: "none" as const, files: [], discardable: [] };
  if (isBroken(rec)) {
    return {
      repo, tree: rec.name, path: rec.path, branch: rec.branch, broken: true, mr, ticket, remoteBranchExists: false, ahead: 0,
      containment: "none", dirt: empty, fingerprint: { headSha: "", dirtHash: dirtHash([]), mrState: mr?.state ?? null }, kept: rec.kept ?? null, hold: null,
    };
  }
  const cfg = await loadWorktreeRepoConfig(repo, repoPath);
  const dirt = await classifyDirtForTriage(rec.path, cfg.junk);
  const fetch = deps.fetch ? (sha: string) => deps.fetch!(rec.path, sha) : undefined;
  const containment = await containmentOf(rec.path, rec.branch, mrRaw ? { state: mrRaw.state, sha: mrRaw.sha } : null, fetch);
  const remoteBranchExists = rec.branch ? await remoteRefExists(rec.path, rec.branch) : false;
  const ahead = Number((await runGit(rec.path, ["rev-list", "--count", `${await remoteDefaultRef(rec.path)}..HEAD`])).stdout.trim()) || 0;
  return {
    repo, tree: rec.name, path: rec.path, branch: rec.branch, broken: false, mr, ticket, remoteBranchExists, ahead, containment, dirt,
    fingerprint: { headSha: (await headSha(rec.path)) ?? "", dirtHash: dirtHash(dirt.files), mrState: mr?.state ?? null },
    kept: rec.kept ?? null, hold: holdOf(rec, deps),
  };
}

export async function triageRepo(repo: string, repoPath: string, deps: TriageDeps): Promise<TriageRow[]> {
  const rows: TriageRow[] = [];
  for (const rec of loadRegistry(repo)) {
    if (rec.kind !== "ephemeral") continue;
    const broken = isBroken(rec);
    const mrState = cacheEntry(repo, rec.branch, deps.cacheEntries)?.mr?.state ?? null;
    if (!isStuck(rec, mrState, broken)) continue;
    rows.push(triageRow(await collectFacts(repo, repoPath, rec, deps)));
  }
  return rows;
}
