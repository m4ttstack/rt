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

export interface TagInfo {
  name: string;
  sha: string;
  annotated: boolean;
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

export interface StashEntry {
  index: number;       // 0 = stash@{0}
  branch: string | null;
  message: string;
}

export interface FetchState {
  lastFetchedAt: Date | null; // null = never fetched
}

export interface GitClient {
  readonly dir: string;
  snapshot(): Promise<RepoSnapshot>;
  diffFile(path: string, opts?: { staged?: boolean }): Promise<FileDiff>;
  branches(): Promise<BranchInfo[]>;
  tags(): Promise<TagInfo[]>;
  log(opts?: { maxCount?: number; file?: string }): Promise<LogEntry[]>;
  stashes(): Promise<StashEntry[]>;
  fetchState(): Promise<FetchState>;
}
