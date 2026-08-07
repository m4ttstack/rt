// Spec 10.3 field-parity gate: build BoardMR both ways (legacy provider
// authorUsernames fetch vs rt project-mrs:read) and diff, with the spec's
// normalizations. Also counts legacy ops for one refresh cycle (E6 input).
//
// Usage: bun run scripts/parity-check.ts
// Requires: config.json with rtRepos mapped, rt daemon running with the
// project-mrs grant on the mapped repos, GitLab token available (legacy path).
import { GitLabProvider, type PullRequest } from "@mattstack/glance";
import { loadConfig, loadGitLabToken } from "../src/config.ts";
import { buildBoard, type BoardMR } from "../src/data.ts";
import { readProjectMRs } from "@mattstack/rt-client";

const config = loadConfig();
const token = loadGitLabToken();
if (!token) {
  console.error("no GitLab token available for the legacy path");
  process.exit(2);
}
let legacyOps = 0;
const provider = new GitLabProvider(config.gitlabHost, token, {
  onRequest: () => { legacyOps++; },
});

// Mirrors the production board's fetchTeamMRs: per-author queries in
// concurrent chunks of 4, visible members only.
const FETCH_CONCURRENCY = 4;

async function legacyFetch(): Promise<PullRequest[]> {
  const authors = config.members.filter((m) => !m.hidden).map((m) => m.username);
  const byId = new Map<string, PullRequest>();
  for (const projectPath of config.projects) {
    for (let i = 0; i < authors.length; i += FETCH_CONCURRENCY) {
      const chunk = authors.slice(i, i + FETCH_CONCURRENCY);
      const results = await Promise.all(
        chunk.map((a) => provider.fetchPullRequests({ authorUsernames: [a], projectPath, state: "opened" })),
      );
      for (const pr of results.flat()) byId.set(pr.id, pr);
    }
  }
  return [...byId.values()];
}

async function rtFetch(): Promise<PullRequest[]> {
  const byId = new Map<string, PullRequest>();
  for (const projectPath of config.projects) {
    const repoName = config.rtRepos[projectPath];
    if (!repoName) throw new Error(`no rtRepos mapping for ${projectPath}`);
    const res = await readProjectMRs(repoName);
    if (!res.ok || !res.data) throw new Error(`${projectPath}: ${res.error}`);
    for (const e of Object.values(res.data.mrs)) if (e.pr.state === "opened") byId.set(e.pr.id, e.pr);
  }
  return [...byId.values()];
}

/** Spec 10.3 normalization: timestamps and mid-flight pipeline state may
 *  differ between two live snapshots; behind-target is a documented
 *  store-side improvement, excluded from parity. The raw `.pipeline` object
 *  is reduced to presence + collapsed state: list-weight store entries carry
 *  `{ id, status }` only (no job trees, no success_with_warnings
 *  refinement) per the accepted spec 5.7 trade; the fields the board renders
 *  from it (`pipelineState`, `blockers.*`) stay in the diff at full
 *  fidelity.
 *
 *  glance 0.18.0 (MAT-164) reshaped what belongs here. `behindTarget`
 *  replaces the old `divergedCommitsCount`/`behindBy` scrubs and is the only
 *  one of the three that was ever reachable on a `BoardMR`: that type is
 *  `MRDashboardProps &`, so the two `PullRequest`-level names never existed
 *  at these paths and those deletes were quietly doing nothing. It stays
 *  excluded because it genuinely differs by fetch path -- the legacy side
 *  here calls `fetchPullRequests({ authorUsernames })`, which never makes the
 *  REST `include_diverged_commits_count` call, so it reads null while the rt
 *  store may carry a real count.
 *
 *  `blockers.needsRebase` is deliberately no longer scrubbed. It was excluded
 *  because it *derived* from that same unfetched count and so disagreed
 *  between the two sides for reasons that had nothing to do with the store.
 *  As of 0.18.0 it tracks `shouldBeRebased` alone, which rides the GraphQL
 *  payload both paths share, so it is now a real parity claim and worth
 *  diffing. */
function normalize(m: BoardMR): Record<string, unknown> {
  const o = JSON.parse(JSON.stringify(m)) as Record<string, unknown>;
  delete o.updatedAt;
  delete o.fetchedAt;
  delete o.behindTarget;
  o.pipeline = m.pipeline ? "<present>" : null;
  return o;
}

/** A between-snapshot pipeline transition is expected noise only when one
 *  side is literally mid-flight. */
function isInFlightPipelineDiff(field: string, lv: string | undefined, rv: string | undefined): boolean {
  if (field !== "pipelineState") return false;
  return lv === '"running"' || rv === '"running"';
}

const legacyPrs = await legacyFetch();
const rtPrs = await rtFetch();
const legacyBoard = new Map(buildBoard(legacyPrs, config).map((m) => [`${m.repositoryId}:${m.iid}`, m]));
const rtBoard = new Map(buildBoard(rtPrs, config).map((m) => [`${m.repositoryId}:${m.iid}`, m]));

let mismatches = 0;
for (const [key, lm] of legacyBoard) {
  const rm = rtBoard.get(key);
  if (!rm) { console.log(`MISSING in rt: ${key} (${lm.title})`); mismatches++; continue; }
  const [ln, rn] = [normalize(lm), normalize(rm)];
  for (const field of new Set([...Object.keys(ln), ...Object.keys(rn)])) {
    const [lv, rv] = [JSON.stringify(ln[field]), JSON.stringify(rn[field])];
    if (lv !== rv) {
      if (isInFlightPipelineDiff(field, lv, rv)) {
        console.log(`(tolerated in-flight) ${key} .${field}: legacy=${lv} rt=${rv}`);
        continue;
      }
      console.log(`DIFF ${key} .${field}: legacy=${lv} rt=${rv}`);
      mismatches++;
    }
  }
}
for (const key of rtBoard.keys()) {
  if (!legacyBoard.has(key)) {
    // A between-snapshot open/close can add one; report, human-adjudicated.
    console.log(`EXTRA in rt: ${key}`);
  }
}
console.log(`\nlegacy MRs=${legacyBoard.size} rt MRs=${rtBoard.size} field mismatches=${mismatches}`);
console.log(`legacy ops for ONE refresh cycle=${legacyOps} (E6: multiply by cadence — 60s TTL polling = up to 15 refreshes/15min board-open; ~1/15min board-closed via slack sweep)`);
process.exit(mismatches === 0 ? 0 : 1);
