import {
  DiffSelection,
  DiffSelectionType,
  type BranchInfo,
  type ChangedFile,
  type RepoSnapshot,
  type StagingDiff,
} from "../../packages/git-core/src/index.ts";
import { DiffLineType } from "../../packages/git-core/src/vendor/ghd/diff-line.ts";
import type { GitWorktreeBadge, RepoStatusRow, WorktreeTreeRow } from "../../packages/rt-client/src/commands.ts";
import { repoLabel } from "../repo-label.ts";
import { parseIdentity } from "../settings/identity.ts";
import type { ActionState } from "./git-actions.ts";
import type {
  MissionActionModel,
  MissionBadge,
  MissionBranchRow,
  MissionChangeRow,
  MissionCommitModel,
  MissionCurrent,
  MissionDiffLine,
  MissionDiffModel,
  MissionLastCommit,
  MissionModel,
  MissionRepoRow,
  MissionWorktreeRow,
} from "../ui/protocol.ts";

export type {
  MissionActionModel,
  MissionBadge,
  MissionBranchRow,
  MissionChangeRow,
  MissionCommitModel,
  MissionCurrent,
  MissionDiffLine,
  MissionDiffModel,
  MissionLastCommit,
  MissionModel,
  MissionRepoRow,
  MissionWorktreeRow,
};

/** Alias kept for callers expecting the wire-model builder's own return-type name. */
export type MissionWireModel = MissionModel;

export interface MissionState {
  currentRepo: string;
  currentWorktree: string;
  selectedPath: string | null;
  filter: string;
  amending: boolean;
  summary: string;
  description: string;
  forcePushRecommended: boolean;
  busyAction: boolean;
  notice: string;
  showOversized: Set<string>;
  selections: Map<string, DiffSelection>;
}

/** No `rt worktree list` row shape carries a pre-joined git badge; the driver joins one before calling buildModel. */
export interface WorktreeRow {
  path: string;
  name: string;
  branch: string;
  onDeck: boolean;
  badge: GitWorktreeBadge;
}

const OVERSIZED_LINE_CUTOFF = 3000;

/** No `worktree:list` row is dirty yet at the moment a fresh tree is discovered -- the badge join falls back to this until a `repos:status` sweep covers its path. */
export const EMPTY_GIT_BADGE: GitWorktreeBadge = {
  worktree: "",
  branch: null,
  detached: false,
  staged: 0,
  unstaged: 0,
  untracked: 0,
  conflicted: 0,
  clean: true,
  ahead: 0,
  behind: 0,
  upstream: null,
  lastFetchedAt: null,
  updatedAt: "",
};

const EMPTY_BADGE: MissionBadge = {
  ahead: 0,
  behind: 0,
  staged: 0,
  unstaged: 0,
  untracked: 0,
  conflicted: 0,
  clean: true,
  lastFetchedAt: "",
};

const LANG_BY_EXT: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  go: "go",
  py: "python",
  rs: "rust",
  rb: "ruby",
  java: "java",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  sh: "bash",
  yaml: "yaml",
  yml: "yaml",
  json: "json",
  md: "markdown",
  html: "html",
  css: "css",
  scss: "scss",
  sql: "sql",
};

function langFor(path: string): string {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return "";
  return LANG_BY_EXT[path.slice(dot + 1).toLowerCase()] ?? "";
}

/** The repo modal groups by host/owner ("github.com/m4ttstack"); a path-kind or unparseable (legacy name-keyed) identity has neither, so it groups under "local". */
function repoGroup(serialized: string): string {
  const identity = parseIdentity(serialized);
  if (!identity || identity.kind === "path") return "local";
  const [host, owner] = identity.id.split("/");
  return host && owner ? `${host}/${owner}` : "local";
}

function toMissionBadge(badge: GitWorktreeBadge): MissionBadge {
  return {
    ahead: badge.ahead ?? 0,
    behind: badge.behind ?? 0,
    staged: badge.staged,
    unstaged: badge.unstaged,
    untracked: badge.untracked,
    conflicted: badge.conflicted,
    clean: badge.clean,
    lastFetchedAt: badge.lastFetchedAt ?? "",
  };
}

/** Joins `worktree:list` trees to `repos:status` badges by path -- no wire shape carries both. */
export function joinWorktreeRows(trees: WorktreeTreeRow[], badges: GitWorktreeBadge[]): WorktreeRow[] {
  return trees.map((tree) => ({
    path: tree.path,
    name: tree.name,
    branch: tree.branch ?? "",
    onDeck: tree.state === "on-deck",
    badge: badges.find((b) => b.worktree === tree.path) ?? EMPTY_GIT_BADGE,
  }));
}

function buildBranchRow(branch: BranchInfo, guards: Map<string, string>): MissionBranchRow {
  const guardedBy = guards.get(branch.name) ?? "";
  const group: MissionBranchRow["group"] = guardedBy !== "" ? "guarded" : branch.current ? "recent" : "other";
  return {
    name: branch.name,
    current: branch.current,
    ahead: branch.ahead ?? 0,
    behind: branch.behind ?? 0,
    guardedBy,
    group,
  };
}

function toChangeStatus(kind: ChangedFile["kind"]): MissionChangeRow["status"] {
  switch (kind) {
    case "added":
    case "untracked":
      return "new";
    case "modified":
      return "modified";
    case "deleted":
      return "deleted";
    case "renamed":
      return "renamed";
    case "conflicted":
      return "conflicted";
  }
}

function deriveInclude(file: ChangedFile, selection: DiffSelection | undefined): MissionChangeRow["include"] {
  if (selection) {
    const type = selection.getSelectionType();
    if (type === DiffSelectionType.All) return "all";
    if (type === DiffSelectionType.None) return "none";
    return "partial";
  }
  if (file.staged && file.unstaged) return "partial";
  return file.staged ? "all" : "none";
}

function commitPlaceholder(changes: MissionChangeRow[]): string {
  const included = changes.filter((change) => change.include !== "none");
  if (included.length !== 1) return "Summary (required)";
  const file = included[0]!;
  const verb = file.status === "new" ? "Create" : file.status === "deleted" ? "Delete" : "Update";
  return `${verb} ${file.path}`;
}

function commitButtonLabel(amending: boolean, stagedTotal: number, branch: string): string {
  if (amending) return "Amend last commit";
  if (stagedTotal === 1) return `Commit to ${branch}`;
  return `Commit ${stagedTotal} files to ${branch}`;
}

function buildDiffModel(input: {
  path: string | null;
  status: string;
  stagingDiff: StagingDiff | null;
  selection: DiffSelection;
  oversizedOverride: boolean;
}): MissionDiffModel {
  const { path, status, stagingDiff, selection, oversizedOverride } = input;
  if (path === null || stagingDiff === null) {
    return { path: "", status: "", kind: "none", stats: "", lang: "", lines: [] };
  }
  if (stagingDiff.kind !== "text") {
    return { path, status, kind: "binary", stats: "", lang: "", lines: [] };
  }

  const totalLines = stagingDiff.hunks.reduce((n, hunk) => n + hunk.lines.length, 0);
  if (totalLines > OVERSIZED_LINE_CUTOFF && !oversizedOverride) {
    return { path, status, kind: "oversized", stats: "", lang: "", lines: [] };
  }

  let addCount = 0;
  let delCount = 0;
  let nextSelIdx = 0;
  const lines: MissionDiffLine[] = [];
  for (const hunk of stagingDiff.hunks) {
    hunk.lines.forEach((line, i) => {
      const oldNo = line.oldLineNumber ?? 0;
      const newNo = line.newLineNumber ?? 0;
      if (line.type === DiffLineType.Hunk) {
        lines.push({ oldNo, newNo, kind: "hunk", text: line.text, selected: false, selIdx: -1 });
        return;
      }
      if (line.type === DiffLineType.Context) {
        lines.push({ oldNo, newNo, kind: "context", text: line.content, selected: false, selIdx: -1 });
        return;
      }
      const selIdx = nextSelIdx++;
      const kind = line.type === DiffLineType.Add ? "add" : "del";
      if (kind === "add") addCount++;
      else delCount++;
      // The wire selIdx stays the compacted ordinal the view echoes back;
      // DiffSelection speaks git-core's absolute numbering
      // (hunk.unifiedDiffStart + in-hunk position), so Selected must be
      // answered in that scheme, never with the compacted ordinal.
      lines.push({ oldNo, newNo, kind, text: line.content, selected: selection.isSelected(hunk.unifiedDiffStart + i), selIdx });
    });
  }

  return {
    path,
    status,
    kind: "text",
    stats: `+${addCount} -${delCount}`,
    lang: langFor(path),
    lines,
  };
}

export function buildModel(input: {
  state: MissionState;
  rows: RepoStatusRow[];
  snapshot: RepoSnapshot;
  branches: BranchInfo[];
  guards: Map<string, string>;
  worktrees: WorktreeRow[];
  stagingDiff: StagingDiff | null;
  stashes: number;
  lastCommit: MissionLastCommit | null;
  action: ActionState;
  /** HEAD's short sha; stands in for current.branch on a detached checkout. */
  headShortSha?: string;
}): MissionModel {
  const { state, rows, snapshot, branches, guards, worktrees, stagingDiff, stashes, lastCommit, action, headShortSha } = input;

  const repos: MissionRepoRow[] = rows.map((row) => ({
    id: row.repo,
    label: repoLabel(row.repo),
    group: repoGroup(row.repo),
    badge: row.worktrees[0] ? toMissionBadge(row.worktrees[0]) : EMPTY_BADGE,
    current: row.repo === state.currentRepo,
  }));

  const worktreeRows: MissionWorktreeRow[] = worktrees.map((worktree) => ({
    path: worktree.path,
    name: worktree.name,
    branch: worktree.branch,
    badge: toMissionBadge(worktree.badge),
    current: worktree.path === state.currentWorktree,
    onDeck: worktree.onDeck,
  }));

  const branchRows: MissionBranchRow[] = branches.map((branch) => buildBranchRow(branch, guards));

  const allChanges: MissionChangeRow[] = snapshot.files.map((file) => ({
    path: file.path,
    origPath: file.originalPath ?? "",
    status: toChangeStatus(file.kind),
    include: deriveInclude(file, state.selections.get(file.path)),
  }));

  // The filter narrows only the visible list; totals and the commit gate
  // keep counting every change, or filtering would silently disable commit.
  const filterText = state.filter.trim().toLowerCase();
  const changes = filterText === "" ? allChanges : allChanges.filter((change) => change.path.toLowerCase().includes(filterText));

  const changedTotal = allChanges.length;
  const stagedTotal = allChanges.filter((change) => change.include !== "none").length;

  const selectedChange = state.selectedPath ? (allChanges.find((change) => change.path === state.selectedPath) ?? null) : null;
  // Fallback seed mirrors the driver's currentSelection: only a fully staged
  // file reads all-selected; a file with unstaged content has, by
  // definition, none of its staging-diff lines in the index yet.
  const selectedFile = state.selectedPath ? snapshot.files.find((file) => file.path === state.selectedPath) : undefined;
  const fullyStaged = selectedFile !== undefined && selectedFile.staged && !selectedFile.unstaged;
  const diffSelection =
    (state.selectedPath ? state.selections.get(state.selectedPath) : undefined) ??
    DiffSelection.fromInitialSelection(fullyStaged ? DiffSelectionType.All : DiffSelectionType.None);

  const diff = buildDiffModel({
    path: state.selectedPath,
    status: selectedChange?.status ?? "",
    stagingDiff,
    selection: diffSelection,
    oversizedOverride: state.selectedPath !== null && state.showOversized.has(state.selectedPath),
  });

  const worktreeName = worktreeRows.find((worktree) => worktree.path === state.currentWorktree)?.name ?? "";

  const current: MissionCurrent = {
    repo: state.currentRepo,
    repoLabel: repoLabel(state.currentRepo),
    worktree: state.currentWorktree,
    worktreeName,
    branch: snapshot.branch ?? (snapshot.detached ? (headShortSha ?? "") : ""),
    detached: snapshot.detached,
  };

  const actionModel: MissionActionModel = {
    kind: action.kind,
    title: action.title,
    meta: action.meta,
    ahead: action.ahead,
    behind: action.behind,
    busy: action.kind === "busy",
  };

  const commit: MissionCommitModel = {
    summary: state.summary,
    description: state.description,
    placeholder: commitPlaceholder(allChanges),
    amending: state.amending,
    buttonLabel: commitButtonLabel(state.amending, stagedTotal, current.branch),
    // The summary lives in the view (drafts never round-trip through the
    // driver), so the wire gate only says whether anything is staged; the
    // view combines it with its own summary/amend state.
    canCommit: stagedTotal > 0,
    lastCommit,
  };

  return {
    current,
    action: actionModel,
    repos,
    worktrees: worktreeRows,
    branches: branchRows,
    changes,
    changedTotal,
    stagedTotal,
    filter: state.filter,
    diff,
    commit,
    stashCount: stashes,
    notice: state.notice,
  };
}
