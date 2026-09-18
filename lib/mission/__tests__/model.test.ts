import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DiffSelection, DiffSelectionType, type BranchInfo, type ChangedFile, type RepoSnapshot, type StagingDiff } from "../../../packages/git-core/src/index.ts";
import { DiffLine, DiffLineType } from "../../../packages/git-core/src/vendor/ghd/diff-line.ts";
import { DiffHunk, DiffHunkExpansionType, DiffHunkHeader } from "../../../packages/git-core/src/vendor/ghd/raw-diff.ts";
import type { GitWorktreeBadge, RepoStatusRow } from "../../../packages/rt-client/src/commands.ts";
import type { ActionState } from "../git-actions.ts";
import { buildModel, type MissionModel, type MissionState, type WorktreeRow } from "../model.ts";

const FIXTURES = resolve(import.meta.dir, "..", "..", "..", "ui", "fixtures");

function readFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));
}

function badge(overrides: Partial<GitWorktreeBadge> = {}): GitWorktreeBadge {
  return {
    worktree: "/repo",
    branch: "main",
    detached: false,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicted: 0,
    clean: true,
    ahead: 0,
    behind: 0,
    upstream: "origin/main",
    lastFetchedAt: null,
    updatedAt: "2026-09-18T12:00:00Z",
    ...overrides,
  };
}

function branchInfo(overrides: Partial<BranchInfo> = {}): BranchInfo {
  return {
    name: "main",
    current: false,
    sha: "deadbeef",
    upstream: "origin/main",
    upstreamGone: false,
    ahead: 0,
    behind: 0,
    committedAt: "2026-09-18T12:00:00Z",
    ...overrides,
  };
}

function changedFile(overrides: Partial<ChangedFile> = {}): ChangedFile {
  return { path: "a.txt", kind: "modified", staged: false, unstaged: true, ...overrides };
}

function baseAction(overrides: Partial<ActionState> = {}): ActionState {
  return { kind: "fetch", title: "Fetch origin", meta: "Never fetched", ahead: 0, behind: 0, ...overrides };
}

function baseState(overrides: Partial<MissionState> = {}): MissionState {
  return {
    currentRepo: "repo-tools",
    currentWorktree: "/repo",
    selectedPath: null,
    filter: "",
    amending: false,
    summary: "",
    description: "",
    forcePushRecommended: false,
    busyAction: false,
    notice: "",
    showOversized: new Set(),
    selections: new Map(),
    ...overrides,
  };
}

function baseSnapshot(overrides: Partial<RepoSnapshot> = {}): RepoSnapshot {
  return {
    branch: "main",
    detached: false,
    upstream: "origin/main",
    ahead: 0,
    behind: 0,
    clean: true,
    files: [],
    ...overrides,
  };
}

function baseRows(): RepoStatusRow[] {
  return [{ repo: "repo-tools", error: null, worktrees: [badge()] }];
}

function baseWorktrees(): WorktreeRow[] {
  return [{ path: "/repo", name: "repo", branch: "main", onDeck: false, badge: badge() }];
}

function baseInput(overrides: {
  state?: Partial<MissionState>;
  rows?: RepoStatusRow[];
  snapshot?: Partial<RepoSnapshot>;
  branches?: BranchInfo[];
  guards?: Map<string, string>;
  worktrees?: WorktreeRow[];
  stagingDiff?: StagingDiff | null;
  stashes?: number;
  lastCommit?: MissionModel["commit"]["lastCommit"];
  action?: Partial<ActionState>;
} = {}) {
  return {
    state: baseState(overrides.state),
    rows: overrides.rows ?? baseRows(),
    snapshot: baseSnapshot(overrides.snapshot),
    branches: overrides.branches ?? [],
    guards: overrides.guards ?? new Map<string, string>(),
    worktrees: overrides.worktrees ?? baseWorktrees(),
    stagingDiff: overrides.stagingDiff ?? null,
    stashes: overrides.stashes ?? 0,
    lastCommit: overrides.lastCommit ?? null,
    action: baseAction(overrides.action),
  };
}

// The mission.go diff hunk from ui/fixtures/session-model-mission.json,
// hand-built rather than parsed: the fixture's SelIdx values (0,1,2) are
// the ordinal count of selectable (add/del) lines, not git-core's own
// hunk.unifiedDiffStart + array-position scheme (which patch-formatter.ts
// uses and which would number them 2,3,5 for this exact line layout).
function missionGoStagingDiff(): StagingDiff {
  const lines = [
    new DiffLine("@@ -1,3 +1,4 @@", DiffLineType.Hunk, 1, null, null),
    new DiffLine(" package mission", DiffLineType.Context, 2, 1, 1),
    new DiffLine('+import "encoding/json"', DiffLineType.Add, 3, null, 2),
    new DiffLine("+", DiffLineType.Add, 4, null, 3),
    new DiffLine(" type Badge struct {", DiffLineType.Context, 5, 2, 4),
    new DiffLine("-type OldBadge struct {", DiffLineType.Delete, 6, 3, null),
  ];
  const header = new DiffHunkHeader(1, 3, 1, 4);
  const hunk = new DiffHunk(header, lines, 0, lines.length - 1, DiffHunkExpansionType.None);
  return { path: "ui/internal/views/mission/mission.go", kind: "text", untracked: false, hunks: [hunk] };
}

function missionGoSelection(): DiffSelection {
  return DiffSelection.fromInitialSelection(DiffSelectionType.None).withLineSelection(0, true).withLineSelection(1, true);
}

describe("buildModel golden fixture handshake", () => {
  test("reproduces ui/fixtures/session-model-mission.json byte for byte", () => {
    const fixture = readFixture("session-model-mission.json") as { t: string; model: MissionModel };

    const rows: RepoStatusRow[] = [
      {
        repo: "repo-tools",
        error: null,
        worktrees: [
          badge({
            worktree: "/Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-rt/gandalf",
            branch: "rt-191-mission-tui",
            staged: 1,
            unstaged: 2,
            untracked: 1,
            conflicted: 0,
            clean: false,
            ahead: 3,
            behind: 2,
            upstream: "origin/rt-191-mission-tui",
            lastFetchedAt: "2026-09-18T12:00:00Z",
          }),
        ],
      },
      {
        repo: "chat",
        error: null,
        worktrees: [badge({ worktree: "/repos/chat", lastFetchedAt: "2026-09-18T11:30:00Z" })],
      },
    ];

    const worktrees: WorktreeRow[] = [
      {
        path: "/Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-rt/gandalf",
        name: "gandalf",
        branch: "rt-191-mission-tui",
        onDeck: false,
        badge: rows[0]!.worktrees[0]!,
      },
      {
        path: "/Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-rt/frodo",
        name: "frodo",
        branch: "rt-190-picker-polish",
        onDeck: true,
        badge: badge({
          worktree: "/Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-rt/frodo",
          branch: "rt-190-picker-polish",
          behind: 1,
          upstream: "origin/rt-190-picker-polish",
          lastFetchedAt: null,
        }),
      },
    ];

    const branches: BranchInfo[] = [
      branchInfo({ name: "rt-191-mission-tui", current: true, ahead: 3, behind: 2 }),
      branchInfo({ name: "main", ahead: 0, behind: 5 }),
      branchInfo({ name: "rt-190-picker-polish", ahead: 0, behind: 0 }),
    ];
    const guards = new Map([["rt-190-picker-polish", "checked out in worktree frodo"]]);

    const selectedPath = "ui/internal/views/mission/mission.go";
    const selections = new Map<string, DiffSelection>([[selectedPath, missionGoSelection()]]);

    const snapshot: RepoSnapshot = {
      branch: "rt-191-mission-tui",
      detached: false,
      upstream: "origin/rt-191-mission-tui",
      ahead: 3,
      behind: 2,
      clean: false,
      files: [
        changedFile({ path: "ui/internal/views/mission/model.go", kind: "modified", staged: true, unstaged: false }),
        changedFile({ path: "ui/internal/views/mission/topbar.go", kind: "added", staged: false, unstaged: true }),
        changedFile({ path: selectedPath, kind: "modified", staged: true, unstaged: true }),
      ],
    };

    const model = buildModel({
      state: baseState({
        currentRepo: "repo-tools",
        currentWorktree: "/Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-rt/gandalf",
        selectedPath,
        selections,
        notice: "",
      }),
      rows,
      snapshot,
      branches,
      guards,
      worktrees,
      stagingDiff: missionGoStagingDiff(),
      stashes: 1,
      lastCommit: {
        summary: "rt-ui: mission view skeleton behind an opt-in mouse session option",
        when: "2 minutes ago",
        undoable: true,
      },
      action: baseAction({ kind: "pull", title: "Pull origin", meta: "3 commits behind", ahead: 3, behind: 2 }),
    });

    expect(JSON.parse(JSON.stringify(model))).toEqual(fixture.model);
  });
});

describe("Include tri-state", () => {
  test.each([
    ["staged only, no selection -> all", true, false, undefined, "all"],
    ["unstaged only, no selection -> none", false, true, undefined, "none"],
    ["staged and unstaged, no selection -> partial", true, true, undefined, "partial"],
    ["selection All overrides flags -> all", false, true, DiffSelectionType.All, "all"],
    ["selection None overrides flags -> none", true, false, DiffSelectionType.None, "none"],
    ["selection Partial overrides flags -> partial", true, false, DiffSelectionType.Partial, "partial"],
  ] as const)("%s", (_label, staged, unstaged, selectionType, expected) => {
    const selections = new Map<string, DiffSelection>();
    if (selectionType !== undefined) {
      let sel = DiffSelection.fromInitialSelection(
        selectionType === DiffSelectionType.None ? DiffSelectionType.None : DiffSelectionType.All,
      );
      if (selectionType === DiffSelectionType.Partial) sel = sel.withLineSelection(0, false);
      selections.set("a.txt", sel);
    }

    const model = buildModel(
      baseInput({
        state: { selections },
        snapshot: { files: [changedFile({ path: "a.txt", staged, unstaged })] },
      }),
    );

    expect(model.changes[0]!.include).toBe(expected);
  });
});

describe("commit button label", () => {
  test.each([
    ["amending wins regardless of count", true, 3, "main", "Amend last commit"],
    ["exactly one file", false, 1, "main", "Commit to main"],
    ["multiple files", false, 3, "main", "Commit 3 files to main"],
    ["zero files", false, 0, "release", "Commit 0 files to release"],
  ] as const)("%s", (_label, amending, stagedCount, branch, expected) => {
    const files = Array.from({ length: stagedCount }, (_, i) => changedFile({ path: `f${i}.txt`, staged: true, unstaged: false }));

    const model = buildModel(
      baseInput({
        state: { amending },
        snapshot: { branch, files },
      }),
    );

    expect(model.commit.buttonLabel).toBe(expected);
  });
});

describe("commit placeholder", () => {
  test.each([
    ["no included files", [], "Summary (required)"],
    ["multiple included files", [changedFile({ path: "a.txt", kind: "modified", staged: true, unstaged: false }), changedFile({ path: "b.txt", kind: "modified", staged: true, unstaged: false })], "Summary (required)"],
    ["single new file", [changedFile({ path: "new.txt", kind: "added", staged: true, unstaged: false })], "Create new.txt"],
    ["single deleted file", [changedFile({ path: "gone.txt", kind: "deleted", staged: true, unstaged: false })], "Delete gone.txt"],
    ["single modified file", [changedFile({ path: "mod.txt", kind: "modified", staged: true, unstaged: false })], "Update mod.txt"],
  ] as const)("%s", (_label, files, expected) => {
    const model = buildModel(baseInput({ snapshot: { files: [...files] } }));
    expect(model.commit.placeholder).toBe(expected);
  });
});

describe("oversized diff gate", () => {
  function bigStagingDiff(lineCount: number): StagingDiff {
    const lines = [new DiffLine("@@ -1,1 +1,1 @@", DiffLineType.Hunk, 1, null, null)];
    for (let i = 0; i < lineCount - 1; i++) {
      lines.push(new DiffLine(`+line ${i}`, DiffLineType.Add, i + 2, null, i + 1));
    }
    const header = new DiffHunkHeader(1, 1, 1, lineCount);
    const hunk = new DiffHunk(header, lines, 0, lines.length - 1, DiffHunkExpansionType.None);
    return { path: "big.txt", kind: "text", untracked: false, hunks: [hunk] };
  }

  test("over the 3000-line cutoff renders as oversized", () => {
    const model = buildModel(
      baseInput({
        state: { selectedPath: "big.txt" },
        snapshot: { files: [changedFile({ path: "big.txt", staged: true, unstaged: false })] },
        stagingDiff: bigStagingDiff(3001),
      }),
    );
    expect(model.diff.kind).toBe("oversized");
    expect(model.diff.lines).toHaveLength(0);
  });

  test("showOversized overrides the cutoff for that path", () => {
    const model = buildModel(
      baseInput({
        state: { selectedPath: "big.txt", showOversized: new Set(["big.txt"]) },
        snapshot: { files: [changedFile({ path: "big.txt", staged: true, unstaged: false })] },
        stagingDiff: bigStagingDiff(3001),
      }),
    );
    expect(model.diff.kind).toBe("text");
    expect(model.diff.lines.length).toBe(3001);
  });

  test("at exactly the cutoff still renders as text", () => {
    const model = buildModel(
      baseInput({
        state: { selectedPath: "big.txt" },
        snapshot: { files: [changedFile({ path: "big.txt", staged: true, unstaged: false })] },
        stagingDiff: bigStagingDiff(3000),
      }),
    );
    expect(model.diff.kind).toBe("text");
  });
});
