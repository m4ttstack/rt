import {
  DiffSelection,
  DiffSelectionType,
  type BranchInfo,
  type ChangedFile,
  type CommittedFileChange,
  type DesktopStashEntry,
  type RepoSnapshot,
  type StagingDiff,
} from "../../packages/git-core/src/index.ts";
import { DiffLineType } from "../../packages/git-core/src/vendor/ghd/diff-line.ts";
import type { GitWorktreeBadge, RepoStatusRow, WorktreeTreeRow } from "../../packages/rt-client/src/commands.ts";
import { basename } from "path";
import { formatRelativeTime } from "../relative-time.ts";
import { repoLabel } from "../repo-label.ts";
import { parseIdentity } from "../settings/identity.ts";
import type { WorktreeEntry } from "../worktree/git-async.ts";
import type { ActionState } from "./git-actions.ts";
import { committedFileRow, EMPTY_HISTORY_MODEL } from "./history-model.ts";
import type {
  MissionActionModel,
  MissionBadge,
  MissionBranchRow,
  MissionChangeRow,
  MissionCommitModel,
  MissionCurrent,
  MissionDiffLine,
  MissionDiffModel,
  MissionHistoryCommitRow,
  MissionHistoryFileRow,
  MissionHistoryHeader,
  MissionHistoryModel,
  MissionLastCommit,
  MissionModel,
  MissionRepoRow,
  MissionStashModel,
  MissionSwitchPrompt,
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
  MissionHistoryCommitRow,
  MissionHistoryFileRow,
  MissionHistoryHeader,
  MissionHistoryModel,
  MissionLastCommit,
  MissionModel,
  MissionRepoRow,
  MissionStashModel,
  MissionSwitchPrompt,
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
  settling: boolean;
  switchPrompt: MissionSwitchPrompt | null;
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

/**
 * Unions `worktree:list`'s registry rows with git's own `worktree list`
 * truth by path -- a plain `git worktree add` never touches rt's registry,
 * so the registry alone misses trees git already knows about, including the
 * very tree the user is standing in. The registry wins on a shared path,
 * since only it carries the rt-assigned name and on-deck state; a git-only
 * path is synthesized with its directory basename as the name, never
 * on-deck (rt has no opinion on a tree it never provisioned) -- deliberately
 * no separate "unmanaged" marker on the wire model, since the basename
 * itself (as opposed to an rt-assigned name) already reads as different. A
 * null `gitWorktrees` (git's own listing failed) degrades to the registry
 * rows alone, never to an empty list.
 */
export function mergeWorktreeTrees(
  trees: WorktreeTreeRow[],
  gitWorktrees: WorktreeEntry[] | null,
  repoName: string,
  canonTreePath: (path: string) => string = (path) => path,
): WorktreeTreeRow[] {
  if (gitWorktrees === null) return trees;

  const byPath = new Map(trees.map((tree) => [canonTreePath(tree.path), tree]));
  const seen = new Set<string>();
  const merged: WorktreeTreeRow[] = [];

  for (const entry of gitWorktrees) {
    if (entry.isBare) continue;
    seen.add(entry.path);
    merged.push(
      byPath.get(entry.path) ?? {
        name: basename(entry.path),
        kind: "external",
        state: "unmanaged",
        path: entry.path,
        branch: entry.branch,
        repoName,
        mr: null,
      },
    );
  }

  // A registry row git's listing didn't report (a reconciliation gap, or a
  // race between the two reads) still surfaces -- git truth only ADDS rows
  // here, it never removes one the registry already knows about.
  for (const tree of trees) {
    if (!seen.has(canonTreePath(tree.path))) merged.push(tree);
  }

  return merged;
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

/** How many of the freshest (non-default, non-current) branches by commit date get the "recent" group, GitHub-Desktop-style. */
const RECENT_BRANCH_COUNT = 5;

/** getRemoteDefaultBranch returns e.g. "origin/main"; local branch names carry no remote prefix. */
function stripRemotePrefix(ref: string | null): string | null {
  if (ref === null) return null;
  const slash = ref.indexOf("/");
  return slash === -1 ? ref : ref.slice(slash + 1);
}

/** Section order the rows must EMIT in, not just group into -- GroupContiguous on the Go side otherwise renders groups in git's own first-appearance listing order. */
const GROUP_RANK: Record<MissionBranchRow["group"], number> = {
  "default branch": 0,
  recent: 1,
  guarded: 2,
  other: 3,
};

/**
 * Sections, in order: the repo's default branch; recent (the current
 * branch first, when it is not itself the default -- GitHub Desktop shows
 * the checked-out branch inside its own section, never dumped into a
 * generic "other" wall -- followed by the RECENT_BRANCH_COUNT most
 * recently committed branches excluding the default and the current
 * branch, so neither displaces a genuinely different recent branch, nor
 * does the current branch's own freshness ever count against that
 * budget); guarded (rt-specific, unchanged), alphabetical; everything
 * else, alphabetical.
 *
 * Each non-current row gets a driver-computed relative date
 * (formatRelativeTime); the current row's `when` stays "" since its own
 * ahead/behind pills render in that slot instead (modal.go's
 * modalRowLine), regardless of which group it lands in.
 */
export function buildBranchRows(branches: BranchInfo[], guards: Map<string, string>, defaultBranchRef: string | null, now: Date): MissionBranchRow[] {
  const defaultBranch = stripRemotePrefix(defaultBranchRef);
  const committedAtByName = new Map(branches.map((b) => [b.name, b.committedAt]));

  const recentCandidates = branches
    .filter((b) => !b.current && b.name !== defaultBranch && (guards.get(b.name) ?? "") === "")
    .slice()
    .sort((a, b) => b.committedAt.localeCompare(a.committedAt));
  const recentNames = new Set(recentCandidates.slice(0, RECENT_BRANCH_COUNT).map((b) => b.name));

  const rows = branches.map((branch) => {
    const guardedBy = guards.get(branch.name) ?? "";
    const isDefault = defaultBranch !== null && branch.name === defaultBranch;
    let group: MissionBranchRow["group"];
    if (guardedBy !== "") group = "guarded";
    else if (isDefault) group = "default branch";
    else if (branch.current) group = "recent";
    else if (recentNames.has(branch.name)) group = "recent";
    else group = "other";

    return {
      name: branch.name,
      current: branch.current,
      ahead: branch.ahead ?? 0,
      behind: branch.behind ?? 0,
      guardedBy,
      group,
      default: isDefault,
      when: branch.current ? "" : formatRelativeTime(branch.committedAt, now),
    };
  });

  return rows.slice().sort((a, b) => {
    const rankDiff = GROUP_RANK[a.group] - GROUP_RANK[b.group];
    if (rankDiff !== 0) return rankDiff;
    if (a.group === "recent") {
      if (a.current !== b.current) return a.current ? -1 : 1;
      const aAt = committedAtByName.get(a.name) ?? "";
      const bAt = committedAtByName.get(b.name) ?? "";
      return bAt.localeCompare(aAt);
    }
    return a.name.localeCompare(b.name);
  });
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

// Ordinal comparison on lowercased strings -- GHD's own caseInsensitiveCompare
// (app/src/lib/compare.ts), not locale-aware collation, so the ordering is
// identical for every user regardless of locale.
function caseInsensitiveComparePath(a: string, b: string): number {
  const al = a.toLowerCase();
  const bl = b.toLowerCase();
  if (al < bl) return -1;
  if (al > bl) return 1;
  return 0;
}

// GHD's own model (ratified 2026-09-21): a checkbox means "include in the
// next commit," not "already in the index" -- include is purely a read of
// the driver's own persisted selection now, never file.staged/unstaged.
// The driver seeds every changed file's selection to All the moment it
// first appears (reconcileSelections), so the fallback below only matters
// before that has ever run.
function deriveInclude(selection: DiffSelection | undefined): MissionChangeRow["include"] {
  const type = (selection ?? DiffSelection.fromInitialSelection(DiffSelectionType.All)).getSelectionType();
  if (type === DiffSelectionType.All) return "all";
  if (type === DiffSelectionType.None) return "none";
  return "partial";
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
  readOnly: boolean;
}): MissionDiffModel {
  const { path, status, stagingDiff, selection, oversizedOverride, readOnly } = input;
  if (path === null || stagingDiff === null) {
    return { path: "", status: "", kind: "none", stats: "", lang: "", lines: [], readOnly };
  }
  if (stagingDiff.kind !== "text") {
    return { path, status, kind: "binary", stats: "", lang: "", lines: [], readOnly };
  }

  const totalLines = stagingDiff.hunks.reduce((n, hunk) => n + hunk.lines.length, 0);
  if (totalLines > OVERSIZED_LINE_CUTOFF && !oversizedOverride) {
    return { path, status, kind: "oversized", stats: "", lang: "", lines: [], readOnly };
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
      if (readOnly) {
        lines.push({ oldNo, newNo, kind, text: line.content, selected: false, selIdx: -1 });
        return;
      }
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
    readOnly,
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
  lastCommit: MissionLastCommit | null;
  action: ActionState;
  /** HEAD's short sha; stands in for current.branch on a detached checkout. */
  headShortSha?: string;
  /** e.g. "origin/main"; null when no remote default branch was found. */
  defaultBranch: string | null;
  /** Injected for deterministic branch-date formatting in tests; defaults to the real clock. */
  now?: Date;
  tab?: "changes" | "history";
  history?: MissionHistoryModel;
  historyDiff?: { path: string | null; status: string; diff: StagingDiff | null; oversizedOverride: boolean };
  editorLabel?: string;
  stash?: { entry: DesktopStashEntry; files: CommittedFileChange[] | null; showing: boolean; selectedFile: string } | null;
  stashDiff?: { path: string | null; status: string; diff: StagingDiff | null; oversizedOverride: boolean };
  canStash?: boolean;
}): MissionModel {
  const { state, rows, snapshot, branches, guards, worktrees, stagingDiff, lastCommit, action, headShortSha, defaultBranch, now = new Date(), historyDiff, stash, stashDiff } = input;
  const tab = input.tab ?? "changes";

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

  const branchRows: MissionBranchRow[] = buildBranchRows(branches, guards, defaultBranch, now);

  // GHD's own ordering rule (app/src/lib/stores/updates/changes-state.ts's
  // updateChangedFiles, ratified 2026-09-21): the list sorts by path,
  // case-insensitively, on every status refresh -- independent of staged
  // state or selection -- so a row never jumps position just because
  // something got checked or the index changed underneath it. Sorted here,
  // not left to whatever order git status/snapshot.files happened to
  // return, which regroups as the index changes.
  const allChanges: MissionChangeRow[] = snapshot.files
    .map((file) => ({
      path: file.path,
      origPath: file.originalPath ?? "",
      status: toChangeStatus(file.kind),
      include: deriveInclude(state.selections.get(file.path)),
    }))
    .sort((a, b) => caseInsensitiveComparePath(a.path, b.path));

  // The filter narrows only the visible list; totals and the commit gate
  // keep counting every change, or filtering would silently disable commit.
  const filterText = state.filter.trim().toLowerCase();
  const changes = filterText === "" ? allChanges : allChanges.filter((change) => change.path.toLowerCase().includes(filterText));

  const changedTotal = allChanges.length;
  const stagedTotal = allChanges.filter((change) => change.include !== "none").length;

  const selectedChange = state.selectedPath ? (allChanges.find((change) => change.path === state.selectedPath) ?? null) : null;
  // GHD's own default (ratified 2026-09-21): every file's selection seeds to
  // All the moment it first appears (reconcileSelections, driver-side), so
  // this fallback only matters before that has ever run.
  const diffSelection =
    (state.selectedPath ? state.selections.get(state.selectedPath) : undefined) ??
    DiffSelection.fromInitialSelection(DiffSelectionType.All);

  const diff =
    tab === "history"
      ? buildDiffModel({
          path: historyDiff?.path ?? null,
          status: historyDiff?.status ?? "",
          stagingDiff: historyDiff?.diff ?? null,
          selection: DiffSelection.fromInitialSelection(DiffSelectionType.None),
          oversizedOverride: historyDiff?.oversizedOverride ?? false,
          readOnly: true,
        })
      : stash?.showing
        ? buildDiffModel({
            path: stashDiff?.path ?? null,
            status: stashDiff?.status ?? "",
            stagingDiff: stashDiff?.diff ?? null,
            selection: DiffSelection.fromInitialSelection(DiffSelectionType.None),
            oversizedOverride: stashDiff?.oversizedOverride ?? false,
            readOnly: true,
          })
        : buildDiffModel({
            path: state.selectedPath,
            status: selectedChange?.status ?? "",
            stagingDiff,
            selection: diffSelection,
            oversizedOverride: state.selectedPath !== null && state.showOversized.has(state.selectedPath),
            readOnly: false,
          });

  // On a plain (non-rt-managed) repo, worktree:list has no row for the
  // checkout at all -- or rt-client's WorktreeTreeRow.name (an rt worktree
  // name, e.g. "gandalf") comes back "" -- and the segment must never fall
  // back to rendering the raw checkout path (mission.go's renderWorktreeSegment
  // does that itself when Current.WorktreeName is ""), so the directory's own
  // basename stands in.
  const worktreeName = worktreeRows.find((worktree) => worktree.path === state.currentWorktree)?.name || basename(state.currentWorktree);

  const current: MissionCurrent = {
    repo: state.currentRepo,
    repoLabel: repoLabel(state.currentRepo),
    worktree: state.currentWorktree,
    worktreeName,
    branch: snapshot.branch ?? (snapshot.detached ? (headShortSha ?? "") : ""),
    detached: snapshot.detached,
    settling: state.settling,
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
    notice: state.notice,
    tab,
    history: input.history ?? EMPTY_HISTORY_MODEL,
    editorLabel: input.editorLabel ?? "",
    stash: stash
      ? {
          sha: stash.entry.stashSha,
          branch: stash.entry.branchName,
          files: stash.files === null ? null : stash.files.map((f) => committedFileRow(f, () => false)),
          showing: stash.showing,
          selectedFile: stash.selectedFile,
        }
      : null,
    switchPrompt: state.switchPrompt ?? null,
    canStash: input.canStash ?? false,
  };
}
