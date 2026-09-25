export type FileStatusKind =
  | "added" | "modified" | "deleted" | "renamed" | "untracked" | "conflicted";

export interface ChangedFile {
  path: string;
  kind: FileStatusKind;
  staged: boolean;      // some or all of the change is in the index
  unstaged: boolean;    // some or all of the change is in the working tree
  originalPath?: string; // renames only
}

export interface RepoSnapshot {
  branch: string | null;   // null when detached
  detached: boolean;
  upstream: string | null; // e.g. "origin/main", null when none
  ahead: number | null;    // null when no upstream
  behind: number | null;
  files: ChangedFile[];
  clean: boolean;
}

export type DiffLineType = "context" | "add" | "del";

export interface DiffLine {
  type: DiffLineType;
  content: string;          // without the leading +/-/space
  oldLineNo: number | null; // null for adds
  newLineNo: number | null; // null for dels
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string; // the raw @@ line
  lines: DiffLine[];
}

export type FileDiffKind = "text" | "binary" | "submodule";

export interface FileDiff {
  path: string;
  kind: FileDiffKind;
  hunks: DiffHunk[]; // empty for binary/submodule
}

export interface BranchInfo {
  name: string;
  current: boolean;
  sha: string;
  upstream: string | null;
  upstreamGone: boolean;
  ahead: number | null;
  behind: number | null;
  committedAt: string; // ISO 8601
}

export interface RemoteInfo {
  name: string;
}

export interface TagInfo {
  name: string;
  sha: string;
  annotated: boolean;
  targetSha: string; // peeled target object sha (equals sha for lightweight tags)
}

export interface LogEntry {
  sha: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  authorDate: string; // ISO 8601
  subject: string;
  body: string;
}

import type {
  CommitIdentity,
  GitAuthor,
  ITrailer,
  IChangesetData,
  CommittedFileChange,
  CommittedFileStatus,
  SubmoduleStatus,
} from "./vendor/ghd/log-parse.ts";

export type { CommitIdentity, GitAuthor, CommittedFileChange, CommittedFileStatus, SubmoduleStatus };
export type Trailer = ITrailer;
export type ChangesetData = IChangesetData;

/** GitHub Desktop's Commit model (app/src/models/commit.ts), as a plain record. */
export interface Commit {
  sha: string;
  shortSha: string;
  summary: string;
  body: string;
  author: CommitIdentity;
  committer: CommitIdentity;
  parentSHAs: string[];
  trailers: Trailer[];
  tags: string[];
  coAuthors: GitAuthor[];
  authoredByCommitter: boolean;
  isMergeCommit: boolean;
}

export interface StashEntry {
  index: number;       // 0 = stash@{0}
  branch: string | null;
  message: string;
}

/** GHD IStashEntry (app/src/models/stash-entry.ts), minus `files` (fetched separately via `stashedFiles`). */
export interface DesktopStashEntry {
  /** The `%gD` selector (e.g. "refs/stash@{0}") at list time; re-read before use, never cached across a stack mutation. */
  name: string;
  stashSha: string;
  branchName: string;
  tree: string;
  parents: string[];
}

export interface FetchState {
  lastFetchedAt: string | null; // ISO 8601; null = never fetched
}

export interface DiffSources {
  old?: string;
  new?: string;
}

export interface DiffReadOpts {
  /** Also read the whole old- and new-side files, for whole-file highlighting. */
  withSources?: boolean;
}

export interface StagingDiff {
  path: string;
  kind: "text" | "binary" | "submodule";
  untracked: boolean;
  hunks: ReadonlyArray<import("./vendor/ghd/raw-diff.ts").DiffHunk>;
  sources?: DiffSources;
}

export type UndoRefusal = "pushed" | "initial" | "merge";

export type UndoResult =
  | { ok: true; undoneSha: string }
  | { ok: false; reason: UndoRefusal };

export interface GitClient {
  readonly dir: string;
  snapshot(): Promise<RepoSnapshot>;
  diffFile(path: string, opts?: { staged?: boolean; untracked?: boolean }): Promise<FileDiff>;
  branches(): Promise<BranchInfo[]>;
  /** Configured remote names, in `git remote`'s own order; empty for a repo with none. */
  remotes(): Promise<RemoteInfo[]>;
  tags(): Promise<TagInfo[]>;
  log(opts?: { maxCount?: number; file?: string }): Promise<LogEntry[]>;
  stashes(): Promise<StashEntry[]>;
  stashPush(opts?: { message?: string; includeUntracked?: boolean }): Promise<{ created: boolean }>;
  stashApply(index: number): Promise<void>;
  stashPop(index: number): Promise<void>;
  stashDrop(index: number): Promise<void>;
  fetchState(): Promise<FetchState>;
  fetch(remote?: string, signal?: AbortSignal): Promise<void>;
  stagingDiff(path: string, opts?: DiffReadOpts): Promise<StagingDiff>;
  stageSelection(
    diff: StagingDiff,
    selection: import("./vendor/ghd/diff-selection.ts").DiffSelection,
    opts?: { originalPath?: string },
  ): Promise<void>;
  discardSelection(
    diff: StagingDiff,
    selection: import("./vendor/ghd/diff-selection.ts").DiffSelection,
  ): Promise<void>;
  /** The "All" case of a GHD-style commit-time index rebuild -- stages path's full content, recreating a rename via originalPath first when given. */
  stageFileFully(path: string, originalPath?: string): Promise<void>;
  undoLastCommit(): Promise<UndoResult>;
  resetToCommit(sha: string, mode: "soft" | "mixed" | "hard"): Promise<void>;
  checkoutBranch(name: string): Promise<void>;
  createBranch(name: string, opts?: { from?: string; checkout?: boolean }): Promise<void>;
  createTag(name: string, opts?: { message?: string; sha?: string }): Promise<void>;
  deleteTag(name: string): Promise<void>;
  pushTag(name: string, remote?: string): Promise<void>;
  /** GHD getCommits: newest first; an unborn HEAD yields []. */
  commits(range?: string, limit?: number, skip?: number, additionalArgs?: ReadonlyArray<string>): Promise<Commit[]>;
  /** GHD loadLocalCommits: commits HEAD has that no remote does (the unpushed set). Null branch (detached/unborn) yields []. */
  localCommits(branch: { name: string; upstream: string | null } | null, skip?: number): Promise<Commit[]>;
  changedFiles(sha: string): Promise<ChangesetData>;
  /** shas oldest first (GHD's orderShasByHistory order). */
  commitRangeChangedFiles(shas: ReadonlyArray<string>): Promise<ChangesetData>;
  commitDiff(file: CommittedFileChange, sha: string, opts?: DiffReadOpts): Promise<StagingDiff>;
  /** shas oldest first. */
  commitRangeDiff(file: CommittedFileChange, shas: ReadonlyArray<string>, opts?: DiffReadOpts): Promise<StagingDiff>;
  /** GHD appendIgnoreRule: patterns appended verbatim to the root .gitignore. */
  appendIgnoreRule(patterns: string | string[]): Promise<void>;
  /** GHD appendIgnoreFile: paths escaped (escapeGitSpecialCharacters) then appended. */
  appendIgnoreFile(paths: string | string[]): Promise<void>;
  /** GHD GitStore.discardChanges: Trash first, then reset and checkout-index only what needs it. */
  discardChanges(files: ChangedFile[], opts?: { moveToTrash?: (absPath: string) => Promise<void> }): Promise<void>;
  /** GHD getStashes: Desktop-tagged stash entries only, newest first. */
  desktopStashes(): Promise<DesktopStashEntry[]>;
  /** GHD getLastDesktopStashEntryForBranch: the newest Desktop-tagged entry for a branch, or null. */
  lastDesktopStashEntryForBranch(branch: string): Promise<DesktopStashEntry | null>;
  /** GHD createDesktopStashEntry: stages untrackedPaths, then `stash push` tagged with the branch marker; false when git reported no local changes to save. */
  createDesktopStashEntry(branch: string, untrackedPaths: ReadonlyArray<string>): Promise<boolean>;
  /** GHD dropDesktopStashEntry: re-resolves stashSha to its current stash@{n} name before dropping. */
  dropDesktopStashEntry(stashSha: string): Promise<void>;
  /**
   * GHD popStashEntry: re-resolves stashSha. Exit 1 with empty stderr means git
   * applied with conflicts and kept the entry, so it is dropped here; output
   * matching Desktop's MergeConflicts pattern is Desktop's expected error and
   * the entry stays.
   */
  popStashEntry(stashSha: string): Promise<void>;
  /** GHD getStashedFiles: the file changes a stash commit carries. */
  stashedFiles(stashSha: string): Promise<CommittedFileChange[]>;
}
