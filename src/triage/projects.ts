/**
 * The project-iteration loop both triage passes need: every open MR across
 * the board's configured projects, read through the daemon.
 *
 * `daemonRepoField` is the one encoding seam (see config.ts) -- a bare
 * "host/path" config value is not a daemon identity, and the daemon reports
 * an unrecognized identity as an empty-but-ok result rather than an error,
 * so skipping the encoding here would silently starve every pass reading
 * from it. Extracted so that guarantee lives in exactly one place instead of
 * once per pass.
 *
 * Codeowner sections come back on the same read, so they are collected here
 * too: buildBoard needs them to keep a codeowner-tagged MR whose author is
 * not a configured member, and a pass that drops them cannot see those MRs
 * at all.
 */
import type { PullRequest } from "@mattstack/glance";
import type { readProjectMRs } from "@mattstack/rt-client";
import { daemonRepoField, type BoardConfig } from "../config.ts";

export async function collectProjectPRs(
  boardConfig: Pick<BoardConfig, "projects" | "rtRepos">,
  fetchProjectMRs: typeof readProjectMRs,
): Promise<{ prs: PullRequest[]; tags: Map<string, string[]> }> {
  const prs: PullRequest[] = [];
  const tags = new Map<string, string[]>();
  for (const projectPath of boardConfig.projects) {
    const repoId = daemonRepoField(boardConfig, projectPath);
    if (!repoId) continue;
    const res = await fetchProjectMRs(repoId);
    if (!res.ok || !res.data) continue;
    for (const entry of Object.values(res.data.mrs)) {
      prs.push(entry.pr as PullRequest);
      if (entry.codeownerSections?.length) tags.set(entry.pr.id, entry.codeownerSections);
    }
  }
  return { prs, tags };
}
