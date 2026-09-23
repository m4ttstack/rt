import { AppFileStatusKind, type Commit, type CommittedFileChange, type GitAuthor } from "../../packages/git-core/src/index.ts";
import { formatRelativeTime } from "../relative-time.ts";
import type { MissionChangeRow, MissionHistoryFileRow, MissionHistoryHeader, MissionHistoryModel } from "../ui/protocol.ts";
import type { HistoryStore } from "./history.ts";

export const EMPTY_HISTORY_MODEL: MissionHistoryModel = { commits: [], hasMore: false, loading: false, header: null, files: [], selectedFile: "" };

/** GHD's web-flow committer on github.com (app/src/lib/web-flow-committer.ts). */
function isWebFlowCommitter(commit: Commit): boolean {
  return commit.committer.name === "GitHub" && commit.committer.email === "noreply@github.com";
}

/** GHD getAvatarUsersForCommit (app/src/models/avatar.ts) without the avatars. */
export function commitAuthors(commit: Commit): GitAuthor[] {
  const users: GitAuthor[] = [{ name: commit.author.name, email: commit.author.email }, ...commit.coAuthors];
  const coAuthoredByCommitter = commit.coAuthors.some((a) => a.name === commit.committer.name && a.email === commit.committer.email);
  if (!commit.authoredByCommitter && !isWebFlowCommitter(commit) && !coAuthoredByCommitter) {
    users.push({ name: commit.committer.name, email: commit.committer.email });
  }
  const byIdentity = new Map(users.map((u) => [u.name + u.email, u]));
  return [...byIdentity.values()];
}

/** GHD CommitAttribution.renderAuthors (app/src/ui/lib/commit-attribution.tsx). */
export function formatByline(authors: GitAuthor[]): string {
  if (authors.length === 1) return authors[0]!.name;
  if (authors.length === 2) return `${authors[0]!.name}, ${authors[1]!.name}`;
  return `${authors.length} people`;
}

/** GHD renderExpandedAuthor (app/src/ui/history/expandable-commit-summary.tsx). */
export function formatExpandedAuthor(author: GitAuthor): string {
  return author.name ? `${author.name} <${author.email}>` : author.email;
}

function toWireStatus(file: CommittedFileChange): MissionChangeRow["status"] {
  switch (file.status.kind) {
    case AppFileStatusKind.New:
    case AppFileStatusKind.Untracked:
      return "new";
    case AppFileStatusKind.Deleted:
      return "deleted";
    case AppFileStatusKind.Renamed:
      return "renamed";
    case AppFileStatusKind.Copied:
      return "copied";
    default:
      return "modified";
  }
}

function fileRow(file: CommittedFileChange): MissionHistoryFileRow {
  const origPath = file.status.kind === AppFileStatusKind.Renamed || file.status.kind === AppFileStatusKind.Copied ? file.status.oldPath : "";
  return { path: file.path, origPath, status: toWireStatus(file) };
}

function buildHeader(store: HistoryStore): MissionHistoryHeader | null {
  const selected = store.selection.map((sha) => store.commits.find((c) => c.sha === sha)).filter((c): c is Commit => c !== undefined);
  const first = selected[0];
  if (!first) return null;
  const authors = [...new Map(selected.flatMap(commitAuthors).map((a) => [a.email + a.name, a])).values()];
  return {
    summary: first.summary,
    body: first.body.trim(),
    byline: formatByline(authors),
    authors: authors.map(formatExpandedAuthor),
    sha: first.sha,
    shortSha: first.shortSha,
    linesAdded: store.changeset?.linesAdded ?? 0,
    linesDeleted: store.changeset?.linesDeleted ?? 0,
    tags: first.tags,
    rangeCount: selected.length,
    contiguous: store.isContiguous(),
  };
}

/**
 * The date header a commit sits under in the History list, on the machine's
 * local calendar with weeks starting Monday. A date after now (clock skew)
 * reads "Today".
 */
export function historyGroupLabel(date: Date, now: Date): string {
  const startOfDay = (offset: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
  const sinceMonday = (now.getDay() + 6) % 7;
  if (date >= startOfDay(0)) return "Today";
  if (date >= startOfDay(1)) return "Yesterday";
  if (date >= startOfDay(sinceMonday)) return "Earlier this week";
  if (date >= startOfDay(sinceMonday + 7)) return "Last week";
  return date.toLocaleString("en-US", { month: "long", year: "numeric" });
}

export function buildHistoryModel(store: HistoryStore, opts: { now: Date; loading: boolean }): MissionHistoryModel {
  const selected = new Set(store.selection);
  return {
    commits: store.commits.map((c) => ({
      sha: c.sha,
      shortSha: c.shortSha,
      summary: c.summary,
      byline: formatByline(commitAuthors(c)),
      when: formatRelativeTime(c.author.date.toISOString(), opts.now),
      group: historyGroupLabel(c.author.date, opts.now),
      tags: c.tags,
      unpushed: store.localShas.has(c.sha),
      selected: selected.has(c.sha),
    })),
    hasMore: store.hasMore,
    loading: opts.loading,
    header: buildHeader(store),
    files: (store.changeset?.files ?? []).map(fileRow),
    selectedFile: store.selectedFile?.path ?? "",
  };
}
