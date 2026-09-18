import type { Database } from "bun:sqlite";
import type { GitWorktreeBadge } from "../../packages/rt-client/src/commands.ts";
import { persistOrWarn } from "../state/busy.ts";

export interface GitBadgesStore {
  readAll(): Map<string, GitWorktreeBadge[]>;
  replaceRepo(repo: string, badges: GitWorktreeBadge[]): { changed: boolean };
  dropRepos(live: Set<string>): string[];
}

/** updatedAt is a sweep timestamp, not repo state; it never counts as a change. */
function fingerprint(badges: GitWorktreeBadge[]): string {
  return JSON.stringify(
    [...badges]
      .sort((a, b) => a.worktree.localeCompare(b.worktree))
      .map(({ updatedAt: _updatedAt, ...rest }) => rest),
  );
}

export function createGitBadges(db: Database): GitBadgesStore {
  const data = new Map<string, GitWorktreeBadge[]>();
  const rows = db.query("SELECT repo, badge FROM git_badges ORDER BY repo, worktree").all() as
    { repo: string; badge: string }[];
  for (const row of rows) {
    const parsed = JSON.parse(row.badge) as GitWorktreeBadge;
    const list = data.get(row.repo) ?? [];
    list.push(parsed);
    data.set(row.repo, list);
  }

  const upsert = db.prepare(
    `INSERT INTO git_badges (repo, worktree, badge, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(repo, worktree) DO UPDATE SET badge = excluded.badge, updated_at = excluded.updated_at`,
  );
  const deleteWorktree = db.prepare("DELETE FROM git_badges WHERE repo = ? AND worktree = ?");
  const deleteRepo = db.prepare("DELETE FROM git_badges WHERE repo = ?");

  return {
    readAll() {
      return new Map([...data.entries()].map(([repo, badges]) => [repo, [...badges]]));
    },

    replaceRepo(repo, badges) {
      const previous = data.get(repo) ?? [];
      const changed = fingerprint(previous) !== fingerprint(badges);
      const goneWorktrees = previous
        .map((b) => b.worktree)
        .filter((w) => !badges.some((b) => b.worktree === w));
      data.set(repo, [...badges]);
      persistOrWarn("git-badges", () => {
        db.transaction(() => {
          for (const w of goneWorktrees) deleteWorktree.run(repo, w);
          for (const b of badges) upsert.run(repo, b.worktree, JSON.stringify(b), Date.now());
        })();
      }, { repo, op: "replace" });
      return { changed };
    },

    dropRepos(live) {
      const candidates = [...data.keys()].filter((repo) => !live.has(repo));
      const gone: string[] = [];
      for (const repo of candidates) {
        // Delete before dropping the in-memory entry: a BUSY-deferred delete
        // must keep the repo in `data` so the next pass retries it, rather
        // than losing the row while reporting it as already gone.
        const persisted = persistOrWarn("git-badges", () => { deleteRepo.run(repo); }, { repo, op: "drop" });
        if (!persisted) continue;
        data.delete(repo);
        gone.push(repo);
      }
      return gone;
    },
  };
}
