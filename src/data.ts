import { getMRDashboardProps, type MRDashboardProps, type PullRequest } from "@forge-glance/sdk";
import type { BoardConfig } from "./config.ts";

/** Dashboard props plus the raw fields the board renders that props omit. */
export type BoardMR = MRDashboardProps & {
  updatedAt: string | null;
  unresolvedThreads: number;
};

export interface RepoGroup {
  projectPath: string;
  mrs: BoardMR[];
}

export interface Snapshot {
  groups: RepoGroup[];
  fetchedAt: number;
  /** Set when the latest refresh failed and this data is older than it should be. */
  fetchError: string | null;
}

/** Parse "group/project" out of a GitLab MR web URL. */
export function projectPathFromWebUrl(webUrl: string, gitlabHost: string): string | null {
  if (!webUrl.startsWith(gitlabHost)) return null;
  const rest = webUrl.slice(gitlabHost.length).replace(/^\//, "");
  const idx = rest.indexOf("/-/");
  return idx === -1 ? null : rest.slice(0, idx);
}

/**
 * Shape raw MRs into the board snapshot: authored by the configured user,
 * open, not draft, grouped by configured project in config order, newest
 * update first, converted to the display props @forge-glance/react consumes.
 */
export function buildGroups(prs: PullRequest[], config: BoardConfig): RepoGroup[] {
  const byProject = new Map<string, PullRequest[]>(config.projects.map((p) => [p, []]));
  for (const pr of prs) {
    if (pr.draft || pr.state !== "opened") continue;
    if (pr.author?.username !== config.username) continue;
    const path = pr.webUrl ? projectPathFromWebUrl(pr.webUrl, config.gitlabHost) : null;
    if (!path) continue;
    byProject.get(path)?.push(pr);
  }
  for (const list of byProject.values()) {
    list.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  }
  return config.projects.map((projectPath) => ({
    projectPath,
    mrs: byProject.get(projectPath)!.map((pr) => ({
      ...getMRDashboardProps(pr),
      updatedAt: pr.updatedAt,
      unresolvedThreads: pr.unresolvedThreadCount,
    })),
  }));
}
