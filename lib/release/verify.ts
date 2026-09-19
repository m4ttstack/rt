/**
 * rt release verify... read-only confirmation that a tagged release actually
 * published (rt:release skill step 10): the release.yml run for the tag
 * completed successfully, the published body matches the committed
 * RELEASE_NOTES.md, the four build assets are attached, the release is
 * neither a draft nor a prerelease, and the public releases/latest endpoint
 * has caught up. Never mutates anything; a failing row names the matching
 * recovery command instead of running it.
 */
import type { RunResult } from "../subprocess.ts";
import type { RowStatus as PreflightRowStatus } from "./preflight.ts";

export type VerifyRowStatus = PreflightRowStatus | "pending";

export interface VerifyRow {
  id: string;
  label: string;
  status: VerifyRowStatus;
  pinned?: string;
  current?: string;
  detail?: string;
}

export interface VerifyReport {
  tag: string | null;
  rows: VerifyRow[];
  staleCount: number;
  errorCount: number;
  pendingCount: number;
  clean: boolean;
}

export interface VerifyOptions {
  tag?: string;
  noWait?: boolean;
}

export interface VerifySeams {
  repoRoot: string;
  exec(argv: [string, ...string[]], opts?: { cwd?: string; timeoutMs?: number }): Promise<RunResult>;
  fetchJson(url: string): Promise<unknown>;
  now(): number;
  sleep(ms: number): Promise<void>;
}

export interface ReleaseData {
  body: string;
  assets: { name: string }[];
  isDraft: boolean;
  isPrerelease: boolean;
  publishedAt: string | null;
}

const GH_REPO = "m4ttstack/rt";
const RELEASE_WORKFLOW = "release.yml";
const RUN_LIST_LIMIT = 50;
const RUN_POLL_MAX_ATTEMPTS = 20;
const RUN_POLL_INTERVAL_MS = 15_000;
const LATEST_PROPAGATION_WINDOW_MS = 20 * 60 * 1000;

export function requiredAssetNames(tag: string): string[] {
  const ver = tag.replace(/^v/, "");
  return [`mattstack-${ver}.dmg`, `mattstack-${ver}.zip`, "appcast.xml", "SHA256SUMS"];
}

async function ghApi(seams: VerifySeams, path: string, jq?: string): Promise<string> {
  const argv: [string, ...string[]] = jq ? ["gh", "api", path, "--jq", jq] : ["gh", "api", path];
  const r = await seams.exec(argv, { timeoutMs: 30_000 });
  if (r.exitCode !== 0) throw new Error(`gh api ${path} failed: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout.trim();
}

export async function resolveTag(seams: VerifySeams): Promise<{ tag: string | null; row: VerifyRow | null }> {
  try {
    const r = await seams.exec(["git", "describe", "--tags", "--abbrev=0"], { cwd: seams.repoRoot });
    if (r.exitCode === 0) {
      const tag = r.stdout.trim();
      if (tag.startsWith("v")) {
        return { tag, row: { id: "tag", label: "tag", status: "ok", detail: `resolved ${tag} via git describe --tags --abbrev=0` } };
      }
    }
  } catch {
    // fall through to the GitHub API
  }
  try {
    const tag = await ghApi(seams, `repos/${GH_REPO}/releases/latest`, ".tag_name");
    if (tag) return { tag, row: { id: "tag", label: "tag", status: "ok", detail: `resolved ${tag} via the newest GitHub release (git describe unavailable)` } };
  } catch (err) {
    return { tag: null, row: { id: "tag", label: "tag", status: "error", detail: `could not resolve a default tag: ${String((err as Error).message ?? err)}` } };
  }
  return { tag: null, row: { id: "tag", label: "tag", status: "error", detail: "could not resolve a default tag: git describe and the GitHub API both found nothing" } };
}

interface FoundRun {
  id: number;
  url: string;
}

async function findRun(seams: VerifySeams, tag: string): Promise<FoundRun | null> {
  const r = await seams.exec(
    ["gh", "run", "list", "--repo", GH_REPO, "--workflow", RELEASE_WORKFLOW, "--json", "databaseId,event,headBranch,url", "--limit", String(RUN_LIST_LIMIT)],
    { timeoutMs: 30_000 },
  );
  if (r.exitCode !== 0) throw new Error(`gh run list failed: ${(r.stderr || r.stdout).trim()}`);
  const runs = JSON.parse(r.stdout) as { databaseId: number; event: string; headBranch: string; url: string }[];
  const match = runs.find((run) => run.event === "push" && run.headBranch === tag);
  return match ? { id: match.databaseId, url: match.url } : null;
}

interface PollResult {
  status: string;
  conclusion: string | null;
  attempts: number;
  pollErrors: number;
}

async function pollRunCompletion(seams: VerifySeams, runId: number, noWait: boolean): Promise<PollResult> {
  let status = "unknown";
  let conclusion: string | null = null;
  let pollErrors = 0;
  const maxAttempts = noWait ? 1 : RUN_POLL_MAX_ATTEMPTS;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const r = await seams.exec(["gh", "run", "view", String(runId), "--repo", GH_REPO, "--json", "status,conclusion"], { timeoutMs: 30_000 });
      if (r.exitCode === 0) {
        const parsed = JSON.parse(r.stdout) as { status: string; conclusion: string | null };
        status = parsed.status;
        conclusion = parsed.conclusion;
        if (status === "completed") return { status, conclusion, attempts: attempt, pollErrors };
      } else {
        pollErrors++;
      }
    } catch {
      pollErrors++;
    }
    if (attempt < maxAttempts) await seams.sleep(RUN_POLL_INTERVAL_MS);
  }
  return { status, conclusion, attempts: maxAttempts, pollErrors };
}

function runRowFromPoll(runId: number, url: string, poll: PollResult): VerifyRow {
  const id = "run";
  const label = "release run";
  if (poll.status === "completed") {
    if (poll.conclusion === "success") {
      return { id, label, status: "ok", detail: `run ${runId} completed successfully (${url})` };
    }
    return {
      id, label, status: "stale",
      detail: `run ${runId} completed with conclusion "${poll.conclusion}"; recovery: gh release delete <tag> (the git tag survives) then gh run rerun ${runId} --failed`,
    };
  }
  const errNote = poll.pollErrors > 0 ? ` (${poll.pollErrors} transient poll error(s) tolerated)` : "";
  return {
    id, label, status: "pending",
    detail: `run ${runId} still ${poll.status} after ${poll.attempts} check(s)${errNote}; rerun rt release verify to recheck`,
  };
}

export async function checkRun(seams: VerifySeams, tag: string, noWait: boolean): Promise<VerifyRow> {
  let found: FoundRun | null;
  try {
    found = await findRun(seams, tag);
  } catch (err) {
    return { id: "run", label: "release run", status: "error", detail: String((err as Error).message ?? err) };
  }
  if (!found) {
    return { id: "run", label: "release run", status: "error", detail: `no release.yml run found for a tag push of ${tag}` };
  }
  const poll = await pollRunCompletion(seams, found.id, noWait);
  return runRowFromPoll(found.id, found.url, poll);
}

async function fetchRelease(seams: VerifySeams, tag: string): Promise<{ ok: true; data: ReleaseData } | { ok: false; error: string }> {
  const r = await seams.exec(["gh", "release", "view", tag, "--repo", GH_REPO, "--json", "body,assets,isDraft,isPrerelease,publishedAt"], { timeoutMs: 30_000 });
  if (r.exitCode !== 0) return { ok: false, error: `gh release view ${tag} failed: ${(r.stderr || r.stdout).trim()}` };
  try {
    return { ok: true, data: JSON.parse(r.stdout) as ReleaseData };
  } catch (err) {
    return { ok: false, error: `gh release view ${tag} returned unparseable JSON: ${String((err as Error).message ?? err)}` };
  }
}

export async function checkReleaseBody(seams: VerifySeams, tag: string, data: ReleaseData): Promise<VerifyRow> {
  const id = "release-body";
  const label = "release notes";
  try {
    const r = await seams.exec(["git", "show", `${tag}:RELEASE_NOTES.md`], { cwd: seams.repoRoot });
    if (r.exitCode !== 0) throw new Error(`git show ${tag}:RELEASE_NOTES.md failed: ${(r.stderr || r.stdout).trim()}`);
    if (r.stdout === data.body) return { id, label, status: "ok", detail: "release body matches the committed RELEASE_NOTES.md" };
    return { id, label, status: "stale", detail: `release body does not match the committed RELEASE_NOTES.md at ${tag}` };
  } catch (err) {
    return { id, label, status: "error", detail: String((err as Error).message ?? err) };
  }
}

export function checkReleaseAssets(tag: string, data: ReleaseData): VerifyRow {
  const id = "release-assets";
  const label = "release assets";
  const required = requiredAssetNames(tag);
  const present = new Set((data.assets ?? []).map((a) => a.name));
  const missing = required.filter((n) => !present.has(n));
  if (missing.length === 0) return { id, label, status: "ok", detail: `all four assets attached: ${required.join(", ")}` };
  return { id, label, status: "stale", detail: `missing asset(s): ${missing.join(", ")}; hand-completion recipe lives in the mattstack-release skill` };
}

export function checkReleaseState(data: ReleaseData): VerifyRow {
  const id = "release-state";
  const label = "release state";
  const problems: string[] = [];
  if (data.isDraft) problems.push("still a draft (recovery: gh release edit <tag> --draft=false)");
  if (data.isPrerelease) problems.push("marked prerelease");
  if (problems.length === 0) return { id, label, status: "ok", detail: "published, not a draft or prerelease" };
  return { id, label, status: "stale", detail: problems.join("; ") };
}

export async function checkLatest(seams: VerifySeams, tag: string, releaseData: ReleaseData | null): Promise<VerifyRow> {
  const id = "latest";
  const label = "releases/latest";
  let latest: { tag_name: string; assets: { name: string }[] };
  try {
    latest = (await seams.fetchJson(`https://api.github.com/repos/${GH_REPO}/releases/latest`)) as typeof latest;
  } catch (err) {
    return { id, label, status: "error", detail: String((err as Error).message ?? err) };
  }

  const required = requiredAssetNames(tag);
  const present = new Set((latest.assets ?? []).map((a) => a.name));
  const missing = required.filter((n) => !present.has(n));
  if (latest.tag_name === tag && missing.length === 0) {
    return { id, label, status: "ok", pinned: tag, current: latest.tag_name, detail: "resolves to the verified tag with all four assets" };
  }

  if (releaseData?.isDraft) {
    return {
      id, label, status: "stale", pinned: tag, current: latest.tag_name,
      detail: "release is still a draft; releases/latest will not resolve to it until it is flipped public",
    };
  }

  const publishedAt = releaseData?.publishedAt ? new Date(releaseData.publishedAt).getTime() : null;
  const elapsed = publishedAt !== null && !Number.isNaN(publishedAt) ? seams.now() - publishedAt : null;
  if (elapsed !== null && elapsed >= 0 && elapsed < LATEST_PROPAGATION_WINDOW_MS) {
    return {
      id, label, status: "pending", pinned: tag, current: latest.tag_name,
      detail: `still propagating (published ${Math.round(elapsed / 60_000)}m ago; the endpoint can lag up to ~20m behind the flip)`,
    };
  }

  const missingNote = missing.length ? `; also missing ${missing.join(", ")}` : "";
  return {
    id, label, status: "stale", pinned: tag, current: latest.tag_name,
    detail: `resolves to ${latest.tag_name}, not ${tag}, and the ~20m propagation window has passed${missingNote}`,
  };
}

function finalize(tag: string | null, rows: VerifyRow[]): VerifyReport {
  const staleCount = rows.filter((r) => r.status === "stale").length;
  const errorCount = rows.filter((r) => r.status === "error").length;
  const pendingCount = rows.filter((r) => r.status === "pending").length;
  return { tag, rows, staleCount, errorCount, pendingCount, clean: staleCount === 0 && errorCount === 0 && pendingCount === 0 };
}

export async function runVerify(seams: VerifySeams, opts: VerifyOptions = {}): Promise<VerifyReport> {
  const rows: VerifyRow[] = [];
  let tag = opts.tag ?? null;

  if (!tag) {
    const resolved = await resolveTag(seams);
    tag = resolved.tag;
    if (resolved.row) rows.push(resolved.row);
  }

  if (!tag) return finalize(null, rows);

  rows.push(await checkRun(seams, tag, opts.noWait ?? false));

  const release = await fetchRelease(seams, tag);
  if (!release.ok) {
    rows.push({ id: "release-body", label: "release notes", status: "error", detail: release.error });
    rows.push({ id: "release-assets", label: "release assets", status: "error", detail: release.error });
    rows.push({ id: "release-state", label: "release state", status: "error", detail: release.error });
    rows.push(await checkLatest(seams, tag, null));
    return finalize(tag, rows);
  }

  rows.push(await checkReleaseBody(seams, tag, release.data));
  rows.push(checkReleaseAssets(tag, release.data));
  rows.push(checkReleaseState(release.data));
  rows.push(await checkLatest(seams, tag, release.data));

  return finalize(tag, rows);
}
