/**
 * rt.ignoredMrs: per-repo MRs the daemon never tracks (deploy/environment
 * branches that bots merge into all day). Target-branch globs are expanded to
 * the repo's exact branch names so GitLab can exclude them on the request
 * itself (its `not: { targetBranches }` takes exact names only); the matcher
 * here is the backstop the project-MR store applies to every write.
 */

import type { GitLabProvider, PullRequest } from "@mattstack/glance";
import { getSetting, type ResolveOpts } from "../settings/resolve.ts";
import { parseIdentity } from "../settings/identity.ts";
import { lazyChildLogger } from "../daemon-logger.ts";

const log = lazyChildLogger("ignored-mrs");

export const IGNORED_MRS_KEY = "rt.ignoredMrs";

export interface IgnoredMrRules {
  targetBranches: string[];
  authors: string[];
}

const NONE: IgnoredMrRules = { targetBranches: [], authors: [] };

type SettingReader = (key: string, opts?: ResolveOpts) => { value: unknown };

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.length > 0) : [];
}

/** The repo's rules; empty when unset, malformed, unreadable, or the repo has no host/path identity. */
export function readIgnoredMrs(repoName: string, read: SettingReader = getSetting): IgnoredMrRules {
  const id = parseIdentity(repoName);
  if (id?.kind !== "remote") return NONE;
  try {
    const { value } = read(IGNORED_MRS_KEY, { repoIdentity: id.id });
    if (value === null || typeof value !== "object" || Array.isArray(value)) return NONE;
    const v = value as Record<string, unknown>;
    return { targetBranches: strings(v.targetBranches), authors: strings(v.authors) };
  } catch (err) {
    log.warn({ err, repo: repoName }, `unreadable ${IGNORED_MRS_KEY}; ignoring nothing`);
    return NONE;
  }
}

export function isIgnoredMr(pr: PullRequest, rules: IgnoredMrRules): boolean {
  const author = pr.author?.username;
  if (author && rules.authors.includes(author)) return true;
  return rules.targetBranches.some((glob) => new Bun.Glob(glob).match(pr.targetBranch));
}

const WILDCARD = /[*?[{]/;

/** Exact branch names the globs match: each glob's literal prefix is searched, then filtered by the glob. */
export async function expandTargetBranches(
  globs: string[],
  searchByPrefix: (prefix: string) => Promise<string[]>,
): Promise<string[]> {
  const names = new Set<string>();
  const byPrefix = new Map<string, Bun.Glob[]>();
  for (const glob of globs) {
    const at = glob.search(WILDCARD);
    if (at === -1) {
      names.add(glob);
      continue;
    }
    const prefix = glob.slice(0, at);
    byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), new Bun.Glob(glob)]);
  }
  for (const [prefix, matchers] of byPrefix) {
    for (const branch of await searchByPrefix(prefix)) {
      if (matchers.some((m) => m.match(branch))) names.add(branch);
    }
  }
  return [...names].sort();
}

const BRANCH_PAGE = 100;

/** Branch names starting with a prefix, via GitLab's `^` (starts-with) branch search, every page. */
export function gitlabBranchSearch(
  provider: Pick<GitLabProvider, "restRequest">,
  projectPath: string,
): (prefix: string) => Promise<string[]> {
  return async (prefix) => {
    const names: string[] = [];
    for (let page = 1; ; page++) {
      const path = `/projects/${encodeURIComponent(projectPath)}/repository/branches?search=${encodeURIComponent(`^${prefix}`)}&per_page=${BRANCH_PAGE}&page=${page}`;
      const res = await provider.restRequest("GET", path, undefined, "searchBranches");
      if (!res.ok) throw new Error(`branch search for "${prefix}" failed: ${res.status}`);
      const rows = (await res.json()) as Array<{ name: string }>;
      names.push(...rows.map((r) => r.name));
      if (rows.length < BRANCH_PAGE) return names;
    }
  };
}

export interface ExcludedTargetsCache {
  get(repoName: string, globs: string[], searchByPrefix: (prefix: string) => Promise<string[]>): Promise<string[]>;
}

/** Per-repo expansion, reused until it ages out or the globs change. A failed search is never cached. */
export function createExcludedTargetsCache(opts: { ttlMs: number; now?: () => number }): ExcludedTargetsCache {
  const now = opts.now ?? Date.now;
  const entries = new Map<string, { key: string; at: number; names: string[] }>();
  return {
    async get(repoName, globs, searchByPrefix) {
      if (globs.length === 0) return [];
      const key = JSON.stringify(globs);
      const hit = entries.get(repoName);
      if (hit && hit.key === key && now() - hit.at <= opts.ttlMs) return hit.names;
      try {
        const names = await expandTargetBranches(globs, searchByPrefix);
        entries.set(repoName, { key, at: now(), names });
        return names;
      } catch (err) {
        log.warn({ err, repo: repoName }, "target-branch expansion failed; excluding nothing on the request this cycle");
        return [];
      }
    },
  };
}
