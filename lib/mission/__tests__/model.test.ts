import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { AppFileStatusKind, DiffSelection, DiffSelectionType, type BranchInfo, type ChangedFile, type Commit, type CommittedFileChange, type DesktopStashEntry, type RepoSnapshot, type StagingDiff } from "../../../packages/git-core/src/index.ts";
import { DiffLine, DiffLineType } from "../../../packages/git-core/src/vendor/ghd/diff-line.ts";
import { DiffHunk, DiffHunkExpansionType, DiffHunkHeader } from "../../../packages/git-core/src/vendor/ghd/raw-diff.ts";
import type { GitWorktreeBadge, RepoStatusRow, WorktreeTreeRow } from "../../../packages/rt-client/src/commands.ts";
import { serializeIdentity } from "../../settings/identity.ts";
import type { ActionState } from "../git-actions.ts";
import { buildHistoryModel } from "../history-model.ts";
import { HistoryStore } from "../history.ts";
import { buildBranchRows, buildModel, joinWorktreeRows, reconcileSelectedPath, type MissionModel, type MissionState, type WorktreeRow } from "../model.ts";

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

function treeRow(overrides: Partial<WorktreeTreeRow> = {}): WorktreeTreeRow {
  return {
    name: "gandalf",
    kind: "main",
    state: "claimed",
    path: "/repo",
    branch: "main",
    repoName: "repo-tools",
    mr: null,
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
    settling: false,
    switchPrompt: null,
    publishPrompt: null,
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
  currentBadge?: GitWorktreeBadge;
  stagingDiff?: StagingDiff | null;
  lastCommit?: MissionModel["commit"]["lastCommit"];
  action?: Partial<ActionState>;
  defaultBranch?: string | null;
  now?: Date;
} = {}) {
  return {
    state: baseState(overrides.state),
    rows: overrides.rows ?? baseRows(),
    snapshot: baseSnapshot(overrides.snapshot),
    branches: overrides.branches ?? [],
    guards: overrides.guards ?? new Map<string, string>(),
    worktrees: overrides.worktrees ?? baseWorktrees(),
    currentBadge: overrides.currentBadge ?? badge(),
    stagingDiff: overrides.stagingDiff ?? null,
    lastCommit: overrides.lastCommit ?? null,
    action: baseAction(overrides.action),
    defaultBranch: overrides.defaultBranch ?? null,
    now: overrides.now ?? new Date("2026-09-18T15:00:00Z"),
  };
}

// The mission.go diff hunk from ui/fixtures/session-model-mission.json,
// hand-built rather than parsed. The fixture's SelIdx values (0,1,2) are
// the ordinal count of selectable (add/del) lines; the DiffSelection below
// speaks git-core's own hunk.unifiedDiffStart + array-position scheme
// (2,3,5 for this exact line layout), and buildDiffModel translates
// between the two when deriving each line's Selected flag.
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
  // Absolute indices 2 and 3 are the two Add lines (wire selIdx 0 and 1).
  return DiffSelection.fromInitialSelection(DiffSelectionType.None).withLineSelection(2, true).withLineSelection(3, true);
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
            branch: "mission-tui",
            staged: 1,
            unstaged: 2,
            untracked: 1,
            conflicted: 0,
            clean: false,
            ahead: 3,
            behind: 2,
            upstream: "origin/mission-tui",
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
        branch: "mission-tui",
        onDeck: false,
        badge: rows[0]!.worktrees[0]!,
      },
      {
        path: "/Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-rt/frodo",
        name: "frodo",
        branch: "picker-polish",
        onDeck: true,
        badge: badge({
          worktree: "/Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-rt/frodo",
          branch: "picker-polish",
          behind: 1,
          upstream: "origin/picker-polish",
          lastFetchedAt: null,
        }),
      },
    ];

    // now is fixed at 2026-09-18T15:00:00Z below. The branch list exercises
    // every section of the GHD taxonomy end to end -- default, recent
    // (current row plus 5 more, exactly filling RECENT_BRANCH_COUNT),
    // guarded, and a genuine "other" row (needs a 6th non-current/default/
    // guarded candidate to spill past the recent-5 budget) -- and the JSON
    // fixture's own branches array is the SORTED OUTPUT order buildBranchRows
    // produces from this input, not this input's own (irrelevant) order.
    const branches: BranchInfo[] = [
      branchInfo({ name: "mission-tui", current: true, ahead: 3, behind: 2 }),
      branchInfo({ name: "main", ahead: 0, behind: 5, committedAt: "2026-09-16T15:00:00Z" }), // 2 days ago
      branchInfo({ name: "picker-polish", ahead: 0, behind: 0, committedAt: "2026-09-15T15:00:00Z" }), // guarded; date irrelevant to its group
      branchInfo({ name: "recent-a", committedAt: "2026-09-17T15:00:00Z" }), // yesterday -- newest of the 5 budgeted recent rows
      branchInfo({ name: "recent-b", committedAt: "2026-09-15T15:00:00Z" }),
      branchInfo({ name: "recent-c", committedAt: "2026-09-14T15:00:00Z" }),
      branchInfo({ name: "recent-d", committedAt: "2026-09-13T15:00:00Z" }),
      branchInfo({ name: "recent-e", committedAt: "2026-09-12T15:00:00Z" }), // 6 days ago -- 5th and last budgeted recent row
      branchInfo({ name: "ancient-other", committedAt: "2026-08-09T15:00:00Z" }), // last month -- 6th candidate, spills to "other"
    ];
    const guards = new Map([["picker-polish", "checked out in worktree frodo"]]);

    const selectedPath = "ui/internal/views/mission/mission.go";
    const selections = new Map<string, DiffSelection>([[selectedPath, missionGoSelection()]]);

    const snapshot: RepoSnapshot = {
      branch: "mission-tui",
      detached: false,
      upstream: "origin/mission-tui",
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
      currentBadge: rows[0]!.worktrees[0]!,
      stagingDiff: missionGoStagingDiff(),
      stash: {
        entry: { name: "refs/stash@{0}", stashSha: "5d1c2e7a9b3f4e6d8c0a1b2c3d4e5f6a7b8c9d0e", branchName: "mission-tui", tree: "t", parents: ["p", "i"] },
        files: [
          {
            path: "docs/design/mission/notes.md",
            status: { kind: AppFileStatusKind.Modified },
            commitish: "5d1c2e7a9b3f4e6d8c0a1b2c3d4e5f6a7b8c9d0e",
            parentCommitish: "5d1c2e7a9b3f4e6d8c0a1b2c3d4e5f6a7b8c9d0e^",
          },
        ],
        showing: false,
        selectedFile: "",
      },
      lastCommit: {
        summary: "rt-ui: mission view skeleton behind an opt-in mouse session option",
        when: "2 minutes ago",
        undoable: true,
      },
      action: baseAction({ kind: "pull", title: "Pull origin", meta: "2 commits behind", ahead: 3, behind: 2 }),
      defaultBranch: "origin/main",
      now: new Date("2026-09-18T15:00:00Z"),
      editorLabel: "Zed",
      canStash: true,
    });

    expect(JSON.parse(JSON.stringify(model))).toEqual(fixture.model);
  });
});

function historyIdent(name: string, email: string, iso: string) {
  return { name, email, date: new Date(iso), tzOffset: 0 };
}

function historyCommit(over: Partial<Commit> = {}): Commit {
  const author = historyIdent("Alex Rivera", "alex@example.com", "2026-09-20T09:00:00Z");
  return {
    sha: "1".repeat(40),
    shortSha: "1111111",
    summary: "Add parser support",
    body: "",
    author,
    committer: author,
    parentSHAs: [],
    trailers: [],
    tags: [],
    coAuthors: [],
    authoredByCommitter: true,
    isMergeCommit: false,
    ...over,
  };
}

function historyDiff(): StagingDiff {
  const lines = [new DiffLine("+parse the trailing comma", DiffLineType.Add, 1, null, 1), new DiffLine("-parse only leading whitespace", DiffLineType.Delete, 2, 1, null)];
  const header = new DiffHunkHeader(1, 1, 1, 1);
  const hunk = new DiffHunk(header, lines, 0, lines.length - 1, DiffHunkExpansionType.None);
  return { path: "src/parser.ts", kind: "text", untracked: false, hunks: [hunk] };
}

describe("buildModel history tab golden fixture", () => {
  test("reproduces ui/fixtures/session-model-mission-history.json byte for byte", () => {
    const fixture = readFixture("session-model-mission-history.json") as { t: string; model: MissionModel };
    const now = new Date("2026-09-22T12:00:00Z");

    const store = new HistoryStore();
    const commit1 = historyCommit({ sha: "1".repeat(40), shortSha: "1111111", summary: "Add parser support", tags: ["v1.2.0"] });
    const commit2 = historyCommit({
      sha: "2".repeat(40),
      shortSha: "2222222",
      summary: "Initial commit",
      author: historyIdent("Sam Lee", "sam@example.com", "2026-09-18T09:00:00Z"),
      committer: historyIdent("Sam Lee", "sam@example.com", "2026-09-18T09:00:00Z"),
    });
    store.commits = [commit1, commit2];
    store.selection = [commit1.sha];
    const file: CommittedFileChange = {
      path: "src/parser.ts",
      status: { kind: AppFileStatusKind.Modified },
      commitish: commit1.sha,
      parentCommitish: `${commit1.sha}^`,
    };
    store.changeset = { files: [file], linesAdded: 1, linesDeleted: 1 };
    store.selectedFile = file;

    const history = buildHistoryModel(store, { now, loading: false, onDisk: () => true });

    const model = buildModel({
      ...baseInput({ now }),
      tab: "history",
      history,
      historyDiff: { path: "src/parser.ts", status: "modified", diff: historyDiff(), oversizedOverride: false },
    });

    expect(JSON.parse(JSON.stringify(model))).toEqual(fixture.model);
  });
});

describe("reconcileSelectedPath", () => {
  const files = ["c.txt", "src/B.ts", "A.txt", "src/a.ts"].map((path) => ({ path }));

  test("keeps a selection the list still shows", () => {
    expect(reconcileSelectedPath(files, "c.txt", "")).toBe("c.txt");
  });

  test("a vanished or empty selection falls to the first row, sorted case-insensitively", () => {
    expect(reconcileSelectedPath(files, "gone.txt", "")).toBe("A.txt");
    expect(reconcileSelectedPath(files, null, "")).toBe("A.txt");
  });

  test("the filter decides both what is kept and where it falls", () => {
    expect(reconcileSelectedPath(files, "src/B.ts", "src")).toBe("src/B.ts");
    expect(reconcileSelectedPath(files, "c.txt", "src")).toBe("src/a.ts");
    expect(reconcileSelectedPath(files, null, " SRC ")).toBe("src/a.ts");
  });

  test("nothing listed selects nothing", () => {
    expect(reconcileSelectedPath([], "c.txt", "")).toBeNull();
    expect(reconcileSelectedPath(files, "c.txt", "zzz")).toBeNull();
  });
});

describe("joinWorktreeRows", () => {
  test("joins each tree to its badge by path, not by list position", () => {
    const trees: WorktreeTreeRow[] = [
      treeRow({ path: "/a", name: "gandalf", branch: "main", state: "claimed" }),
      treeRow({ path: "/b", name: "frodo", branch: "feature", state: "on-deck" }),
    ];
    // Badges deliberately out of tree order -- a positional zip would cross-wire them.
    const badges = [badge({ worktree: "/b", ahead: 2 }), badge({ worktree: "/a", ahead: 5 })];

    const rows = joinWorktreeRows(trees, badges);

    expect(rows).toEqual([
      { path: "/a", name: "gandalf", branch: "main", onDeck: false, badge: badges[1]! },
      { path: "/b", name: "frodo", branch: "feature", onDeck: true, badge: badges[0]! },
    ]);
  });

  test("a tree with no matching badge yet (fresh from worktree:list, no repos:status sweep) falls back to an empty badge", () => {
    const trees: WorktreeTreeRow[] = [treeRow({ path: "/c", name: "new-tree", branch: null, state: "claimed" })];

    const rows = joinWorktreeRows(trees, []);

    expect(rows[0]!.branch).toBe("");
    expect(rows[0]!.badge.worktree).toBe("");
    expect(rows[0]!.badge.clean).toBe(true);
  });

  test("onDeck is true only for the worktree:list 'on-deck' state", () => {
    const trees: WorktreeTreeRow[] = [
      treeRow({ path: "/a", state: "claimed" }),
      treeRow({ path: "/b", state: "on-deck" }),
      treeRow({ path: "/c", state: "disposable" }),
    ];

    const rows = joinWorktreeRows(trees, []);

    expect(rows.map((r) => r.onDeck)).toEqual([false, true, false]);
  });
});

// A plain (non-rt-managed) repo's worktree:list has no rt worktree name for
// the checkout -- WorktreeTreeRow.name comes back "" -- and the segment must
// never fall back to the raw checkout path (a real-repo defect the mission
// fixtures never exposed, since every fixture models an rt-managed worktree
// with a daemon-assigned name).
describe("current.worktreeName falls back to the checkout directory's basename", () => {
  test("an empty WorktreeRow.name yields the basename, not the raw path", () => {
    const model = buildModel(
      baseInput({
        state: { currentWorktree: "/Users/matt/Documents/glitter-demo" },
        worktrees: [{ path: "/Users/matt/Documents/glitter-demo", name: "", branch: "main", onDeck: false, badge: badge() }],
      }),
    );
    expect(model.current.worktreeName).toBe("glitter-demo");
  });

  test("no matching WorktreeRow at all (worktree:list returned nothing) also falls back to the basename", () => {
    const model = buildModel(
      baseInput({
        state: { currentWorktree: "/Users/matt/Documents/glitter-demo" },
        worktrees: [],
      }),
    );
    expect(model.current.worktreeName).toBe("glitter-demo");
  });

  test("a real rt worktree name is unaffected", () => {
    const model = buildModel(baseInput());
    expect(model.current.worktreeName).toBe("repo");
  });
});

describe("editorLabel", () => {
  test("carries the label it is given", () => {
    expect(buildModel({ ...baseInput(), editorLabel: "Zed" }).editorLabel).toBe("Zed");
  });

  test("is empty when none is given", () => {
    expect(buildModel(baseInput()).editorLabel).toBe("");
  });
});

describe("rows describing the current worktree show its live badge", () => {
  const live = badge({ ahead: 0, behind: 0, staged: 2, clean: false, lastFetchedAt: "2026-09-18T14:00:00Z" });
  const cached = badge({ ahead: 6, behind: 1, staged: 0, clean: true, lastFetchedAt: null });

  test("the current worktree's row shows the live badge; another worktree's row keeps its cached one", () => {
    const model = buildModel(
      baseInput({
        worktrees: [
          { path: "/repo", name: "gandalf", branch: "main", onDeck: false, badge: cached },
          { path: "/repo2", name: "frodo", branch: "feature", onDeck: false, badge: badge({ worktree: "/repo2", ahead: 4 }) },
        ],
        currentBadge: live,
      }),
    );

    expect(model.worktrees[0]!.badge).toMatchObject({ ahead: 0, staged: 2, clean: false, lastFetchedAt: "2026-09-18T14:00:00Z" });
    expect(model.worktrees[1]!.badge.ahead).toBe(4);
  });

  test("a repo row whose badge describes the current worktree shows the live badge; other repo rows keep theirs", () => {
    const model = buildModel(
      baseInput({
        rows: [
          { repo: "repo-tools", error: null, worktrees: [cached] },
          { repo: "chat", error: null, worktrees: [badge({ worktree: "/repos/chat", ahead: 3 })] },
        ],
        currentBadge: live,
      }),
    );

    expect(model.repos[0]!.badge).toMatchObject({ ahead: 0, staged: 2, lastFetchedAt: "2026-09-18T14:00:00Z" });
    expect(model.repos[1]!.badge.ahead).toBe(3);
  });

  test("a current repo whose first cached badge is another worktree keeps that badge", () => {
    const model = buildModel(
      baseInput({ rows: [{ repo: "repo-tools", error: null, worktrees: [badge({ worktree: "/repo2", ahead: 4 }), cached] }], currentBadge: live }),
    );

    expect(model.repos[0]!.badge.ahead).toBe(4);
  });
});

describe("current.settling", () => {
  test("buildModel reports settling false by default", () => {
    const model = buildModel(baseInput());
    expect(model.current.settling).toBe(false);
  });
});

describe("repo modal group derivation", () => {
  test.each([
    ["github remote", serializeIdentity({ kind: "remote", id: "github.com/m4ttstack/repo-tools" }), "github.com/m4ttstack"],
    ["gitlab remote with owner", serializeIdentity({ kind: "remote", id: "gitlab.com/acme/acme-dev" }), "gitlab.com/acme"],
    ["path-kind identity", serializeIdentity({ kind: "path", id: "/Users/dev/scratch" }), "local"],
    ["bare/legacy id (no colon, unparseable as a wire)", "repo-tools", "local"],
  ] as const)("%s -> %s", (_label, repoId, expected) => {
    const model = buildModel(baseInput({ rows: [{ repo: repoId, error: null, worktrees: [badge()] }] }));
    expect(model.repos[0]!.group).toBe(expected);
  });
});

describe("buildBranchRows sections (GitHub-Desktop-style, ratified 2026-09-19)", () => {
  const NOW = new Date("2026-09-18T15:00:00Z");
  const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

  test("the default branch gets its own group and default:true, regardless of recency", () => {
    const branches = [
      branchInfo({ name: "main", committedAt: daysAgo(400) }), // older than every other branch below
      branchInfo({ name: "feature-a", committedAt: daysAgo(1) }),
    ];
    const rows = buildBranchRows(branches, new Map(), "origin/main", NOW);
    const main = rows.find((r) => r.name === "main")!;
    expect(main.group).toBe("default branch");
    expect(main.default).toBe(true);
    expect(rows.find((r) => r.name === "feature-a")!.default).toBe(false);
  });

  test("only the RECENT_BRANCH_COUNT freshest non-default, non-current branches get \"recent\"; the rest fall to \"other\"", () => {
    const branches = Array.from({ length: 8 }, (_, i) => branchInfo({ name: `b${i}`, committedAt: daysAgo(i) }));
    const rows = buildBranchRows(branches, new Map(), null, NOW);
    const recent = rows.filter((r) => r.group === "recent").map((r) => r.name).sort();
    const other = rows.filter((r) => r.group === "other").map((r) => r.name).sort();
    expect(recent).toEqual(["b0", "b1", "b2", "b3", "b4"]); // the 5 newest (smallest daysAgo)
    expect(other).toEqual(["b5", "b6", "b7"]);
  });

  test("a guarded branch stays \"guarded\" even if it would otherwise be the default or the freshest", () => {
    const branches = [branchInfo({ name: "main", committedAt: daysAgo(0) })];
    const guards = new Map([["main", "checked out in worktree frodo"]]);
    const rows = buildBranchRows(branches, guards, "origin/main", NOW);
    expect(rows[0]!.group).toBe("guarded");
  });

  test("the current branch's own committedAt never produces a `when`; a non-current branch always does", () => {
    const branches = [
      branchInfo({ name: "feature-current", current: true, committedAt: daysAgo(0) }),
      branchInfo({ name: "feature-other", committedAt: daysAgo(2) }),
    ];
    const rows = buildBranchRows(branches, new Map(), null, NOW);
    expect(rows.find((r) => r.name === "feature-current")!.when).toBe("");
    expect(rows.find((r) => r.name === "feature-other")!.when).toBe("2 days ago");
  });

  test("the current branch never counts toward the recent-5 budget for OTHER rows, even when freshest", () => {
    const branches = [
      branchInfo({ name: "current", current: true, committedAt: daysAgo(0) }),
      ...Array.from({ length: 5 }, (_, i) => branchInfo({ name: `b${i}`, committedAt: daysAgo(i + 1) })),
    ];
    const rows = buildBranchRows(branches, new Map(), null, NOW);
    // The current branch (non-default) is itself "recent" -- see the
    // GHD-parity correction below -- but its own freshness never displaces
    // one of the 5 budgeted non-current recent rows.
    expect(rows.find((r) => r.name === "current")!.group).toBe("recent");
    expect(rows.filter((r) => r.group === "recent" && r.name !== "current")).toHaveLength(5);
  });

  test("a default branch ref with no slash (already bare) still matches", () => {
    const rows = buildBranchRows([branchInfo({ name: "main" })], new Map(), "main", NOW);
    expect(rows[0]!.default).toBe(true);
  });

  test("a non-default current branch sits in \"recent\", not \"other\" (GHD shows the checked-out branch inside its own section)", () => {
    const branches = [
      branchInfo({ name: "feature-current", current: true, committedAt: daysAgo(10) }), // older than the other recent branches below
      branchInfo({ name: "feature-fresh", committedAt: daysAgo(0) }),
    ];
    const rows = buildBranchRows(branches, new Map(), null, NOW);
    expect(rows.find((r) => r.name === "feature-current")!.group).toBe("recent");
    // Still keeps its pills, not a date, regardless of group.
    expect(rows.find((r) => r.name === "feature-current")!.when).toBe("");
  });

  test("a current branch that IS the default lands in \"default branch\", not \"recent\"", () => {
    const rows = buildBranchRows([branchInfo({ name: "main", current: true })], new Map(), "origin/main", NOW);
    expect(rows[0]!.group).toBe("default branch");
  });
});

describe("buildBranchRows section order (GHD parity, ratified 2026-09-19)", () => {
  const NOW = new Date("2026-09-18T15:00:00Z");
  const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

  test("emits default branch, then recent (current first, newest-committed next), then guarded, then other -- alphabetical within guarded/other -- regardless of the input's own listing order", () => {
    // Deliberately scrambled: git's own listing order must never leak
    // through as the emitted order (this is exactly the bug the sort fixes:
    // branches.map used to preserve git's order and GroupContiguous then
    // rendered groups in first-appearance order instead of the ratified one).
    // Both "other" names and "guarded" names are picked so alphabetical
    // order DISAGREES with commit-date order -- a date-based sort passing
    // by coincidence is ruled out.
    const branches = [
      branchInfo({ name: "other-zz", committedAt: daysAgo(60) }), // newer than other-aa
      branchInfo({ name: "guarded-b", committedAt: daysAgo(3) }), // newer than guarded-a
      branchInfo({ name: "recent-newest", committedAt: daysAgo(1) }),
      branchInfo({ name: "other-aa", committedAt: daysAgo(70) }),
      branchInfo({ name: "current-branch", current: true, committedAt: daysAgo(20) }),
      branchInfo({ name: "guarded-a", committedAt: daysAgo(4) }),
      branchInfo({ name: "main", committedAt: daysAgo(400) }),
      branchInfo({ name: "recent-2", committedAt: daysAgo(2) }),
      branchInfo({ name: "recent-3", committedAt: daysAgo(3) }),
      branchInfo({ name: "recent-4", committedAt: daysAgo(4) }),
      branchInfo({ name: "recent-5", committedAt: daysAgo(5) }), // 5th and last budgeted recent slot
    ];
    const guards = new Map([
      ["guarded-b", "checked out in worktree frodo"],
      ["guarded-a", "checked out in worktree bilbo"],
    ]);
    const rows = buildBranchRows(branches, guards, "origin/main", NOW);
    expect(rows.map((r) => r.name)).toEqual([
      "main", // default branch
      "current-branch", // recent: current always first
      "recent-newest", // recent: then newest-committed first
      "recent-2",
      "recent-3",
      "recent-4",
      "recent-5",
      "guarded-a", // guarded: alphabetical, not date order (guarded-b is newer)
      "guarded-b",
      "other-aa", // other: alphabetical, not date order (other-zz is newer)
      "other-zz",
    ]);
  });
});

// GHD's own model (ratified 2026-09-21): include is purely a read of the
// driver's persisted selection now -- file.staged/file.unstaged never
// factor in (a checkbox means "include in the next commit," not "already
// in the index"). No selection at all means the file hasn't been through
// reconcileSelections yet; that default is All, same as everywhere else.
describe("Include tri-state (selection-only, ratified 2026-09-21)", () => {
  test.each([
    ["no selection recorded -> defaults to all", undefined, "all"],
    ["selection All -> all", DiffSelectionType.All, "all"],
    ["selection None -> none", DiffSelectionType.None, "none"],
    ["selection Partial -> partial", DiffSelectionType.Partial, "partial"],
  ] as const)("%s", (_label, selectionType, expected) => {
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
        snapshot: { files: [changedFile({ path: "a.txt" })] },
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

// Owner-verified real-repo defect: rows reordered when files got staged,
// because allChanges rendered in snapshot.files' own order, which regroups
// as the index changes underneath it. GHD's own fix (app/src/lib/stores/
// updates/changes-state.ts's updateChangedFiles, ratified 2026-09-21):
// sort by path, case-insensitively, on every refresh -- independent of
// staged/selection state -- so order depends only on which paths are
// present, never on how git status happened to list them.
describe("Changes list order is stable (case-insensitive path sort, ratified 2026-09-21)", () => {
  test("a scrambled snapshot.files order yields the same rendered order as the sorted one", () => {
    const scrambled = [
      changedFile({ path: "zebra.txt" }),
      changedFile({ path: "apple.txt" }),
      changedFile({ path: "mango.txt" }),
    ];
    const model = buildModel(baseInput({ snapshot: { files: scrambled } }));
    expect(model.changes.map((c) => c.path)).toEqual(["apple.txt", "mango.txt", "zebra.txt"]);
  });

  test("the same files returning in a DIFFERENT order (as if staged, reordering the underlying status) renders identically", () => {
    const first = [changedFile({ path: "zebra.txt" }), changedFile({ path: "apple.txt" }), changedFile({ path: "mango.txt" })];
    const second = [changedFile({ path: "mango.txt" }), changedFile({ path: "zebra.txt" }), changedFile({ path: "apple.txt" })];
    const orderA = buildModel(baseInput({ snapshot: { files: first } })).changes.map((c) => c.path);
    const orderB = buildModel(baseInput({ snapshot: { files: second } })).changes.map((c) => c.path);
    expect(orderA).toEqual(orderB);
  });

  test("mixed-case paths sort case-insensitively, not by raw byte order", () => {
    const files = [changedFile({ path: "Banana.txt" }), changedFile({ path: "apple.txt" }), changedFile({ path: "cherry.txt" })];
    const model = buildModel(baseInput({ snapshot: { files } }));
    // Byte/ordinal order would put "Banana.txt" (capital B, 0x42) before
    // "apple.txt" and "cherry.txt" (lowercase, 0x61+); case-insensitive
    // sorts it between them instead.
    expect(model.changes.map((c) => c.path)).toEqual(["apple.txt", "Banana.txt", "cherry.txt"]);
  });

  test("the selected file's diff still resolves correctly by path after the underlying status reorders (cursor stays on the FILE, not a row index)", () => {
    const before = [changedFile({ path: "zebra.txt" }), changedFile({ path: "apple.txt" })];
    const after = [changedFile({ path: "apple.txt" }), changedFile({ path: "zebra.txt" })]; // same files, different incoming order
    const stagingDiff = { path: "zebra.txt", kind: "text" as const, untracked: false, hunks: [] };
    const beforeModel = buildModel(baseInput({ state: { selectedPath: "zebra.txt" }, snapshot: { files: before }, stagingDiff }));
    const afterModel = buildModel(baseInput({ state: { selectedPath: "zebra.txt" }, snapshot: { files: after }, stagingDiff }));
    expect(beforeModel.diff.path).toBe("zebra.txt");
    expect(afterModel.diff.path).toBe("zebra.txt");
    // Row position moved (zebra.txt sorts after apple.txt either way here),
    // but selection tracking is by path, not index, in both directions.
    expect(afterModel.changes.map((c) => c.path)).toEqual(["apple.txt", "zebra.txt"]);
  });
});

describe("changes filter", () => {
  const files = [
    changedFile({ path: "lib/mission/driver.ts", staged: true, unstaged: false }),
    changedFile({ path: "ui/internal/views/mission/mission.go", staged: false, unstaged: true }),
    changedFile({ path: "README.md", staged: false, unstaged: true }),
  ];

  test("narrows changes by case-insensitive substring of the path", () => {
    const model = buildModel(baseInput({ state: { filter: "MISSION" }, snapshot: { files: [...files] } }));
    expect(model.changes.map((change) => change.path)).toEqual([
      "lib/mission/driver.ts",
      "ui/internal/views/mission/mission.go",
    ]);
    expect(model.filter).toBe("MISSION");
  });

  test("a filter that matches nothing empties the list but keeps totals and the commit gate", () => {
    // Explicit selections: exactly one file checked, so stagedTotal (now a
    // count of checked files, GHD-style) reads a meaningful 1 rather than
    // every file's own All default.
    const selections = new Map([
      ["lib/mission/driver.ts", DiffSelection.fromInitialSelection(DiffSelectionType.All)],
      ["ui/internal/views/mission/mission.go", DiffSelection.fromInitialSelection(DiffSelectionType.None)],
      ["README.md", DiffSelection.fromInitialSelection(DiffSelectionType.None)],
    ]);
    const model = buildModel(baseInput({ state: { filter: "zzz", selections }, snapshot: { files: [...files] } }));
    expect(model.changes).toEqual([]);
    expect(model.changedTotal).toBe(3);
    expect(model.stagedTotal).toBe(1);
    expect(model.commit.canCommit).toBe(true);
  });
});

describe("canCommit", () => {
  test("true whenever anything is checked, regardless of the driver-side summary", () => {
    const model = buildModel(
      baseInput({
        state: { summary: "" },
        snapshot: { files: [changedFile({ path: "a.txt" })] }, // no selection recorded -> defaults to All
      }),
    );
    expect(model.commit.canCommit).toBe(true);
  });

  // GHD's own model (ratified 2026-09-21): a freshly-appeared file defaults
  // to checked, so getting to canCommit=false takes an EXPLICIT uncheck,
  // not merely "nothing staged in the index" (there is no index concept
  // here anymore).
  test("false with everything explicitly unchecked, even when a summary is present", () => {
    const selections = new Map([["a.txt", DiffSelection.fromInitialSelection(DiffSelectionType.None)]]);
    const model = buildModel(
      baseInput({
        state: { summary: "a summary", selections },
        snapshot: { files: [changedFile({ path: "a.txt" })] },
      }),
    );
    expect(model.commit.canCommit).toBe(false);
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

describe("diff Selected flags", () => {
  // Two hunks with interleaved context and a non-zero second
  // unifiedDiffStart: compacted selIdx 2 (hunk B's delete) sits at absolute
  // index 7, so a selection keyed on absolute indices only lights the right
  // wire line if buildDiffModel translates per line.
  function twoHunkDiff(): StagingDiff {
    const hunkALines = [
      new DiffLine("@@ -1,2 +1,2 @@", DiffLineType.Hunk, 1, null, null),
      new DiffLine(" context one", DiffLineType.Context, 2, 1, 1),
      new DiffLine("+added one", DiffLineType.Add, 3, null, 2),
      new DiffLine(" context two", DiffLineType.Context, 4, 2, 3),
      new DiffLine("-deleted one", DiffLineType.Delete, 5, 3, null),
    ];
    const hunkA = new DiffHunk(new DiffHunkHeader(1, 3, 1, 3), hunkALines, 0, hunkALines.length - 1, DiffHunkExpansionType.None);
    const hunkBLines = [
      new DiffLine("@@ -10,2 +10,2 @@", DiffLineType.Hunk, 6, null, null),
      new DiffLine(" context three", DiffLineType.Context, 7, 10, 10),
      new DiffLine("-deleted two", DiffLineType.Delete, 8, 11, null),
      new DiffLine("+added two", DiffLineType.Add, 9, null, 11),
    ];
    const hunkB = new DiffHunk(new DiffHunkHeader(10, 2, 10, 2), hunkBLines, 5, 5 + hunkBLines.length - 1, DiffHunkExpansionType.None);
    return { path: "two-hunk.txt", kind: "text", untracked: false, hunks: [hunkA, hunkB] };
  }

  test("reads the persisted selection through the compacted-to-absolute translation", () => {
    const selection = DiffSelection.fromInitialSelection(DiffSelectionType.None).withLineSelection(7, true);
    const model = buildModel(
      baseInput({
        state: { selectedPath: "two-hunk.txt", selections: new Map([["two-hunk.txt", selection]]) },
        snapshot: { files: [changedFile({ path: "two-hunk.txt", staged: true, unstaged: true })] },
        stagingDiff: twoHunkDiff(),
      }),
    );

    const selectable = model.diff.lines.filter((line) => line.selIdx >= 0);
    expect(selectable.map((line) => [line.selIdx, line.selected])).toEqual([
      [0, false],
      [1, false],
      [2, true],
      [3, false],
    ]);
  });

  // GHD's own default (ratified 2026-09-21): a freshly-appeared file's
  // selection seeds to All -- every selectable line reads checked -- not
  // derived from file.staged/unstaged (there is no index concept here
  // anymore; the checkbox is the user's own commit intent from the start).
  test("with no persisted selection every selectable line reads checked (select-all, GHD's own default)", () => {
    const model = buildModel(
      baseInput({
        state: { selectedPath: "two-hunk.txt" },
        snapshot: { files: [changedFile({ path: "two-hunk.txt" })] },
        stagingDiff: twoHunkDiff(),
      }),
    );

    const selectable = model.diff.lines.filter((line) => line.selIdx >= 0);
    expect(selectable.length).toBeGreaterThan(0);
    for (const line of selectable) {
      expect(line.selected).toBe(true);
    }
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

  function withSources(diff: StagingDiff, sources: StagingDiff["sources"]): StagingDiff {
    return { ...diff, sources };
  }

  test("a text diff carries its sources; a missing side stays absent", () => {
    const model = buildModel(
      baseInput({
        state: { selectedPath: "big.txt" },
        snapshot: { files: [changedFile({ path: "big.txt", staged: true, unstaged: false })] },
        stagingDiff: withSources(bigStagingDiff(3), { old: "a\n", new: undefined }),
      }),
    );
    expect(model.diff.kind).toBe("text");
    expect(model.diff.oldSource).toBe("a\n");
    expect("newSource" in model.diff).toBe(false);
  });

  test("a typechange diff shows read-only: it stages only whole, from its file row", () => {
    const model = buildModel(
      baseInput({
        state: { selectedPath: "big.txt" },
        snapshot: { files: [changedFile({ path: "big.txt" })] },
        stagingDiff: { ...bigStagingDiff(3), typechange: true },
      }),
    );
    expect(model.diff.kind).toBe("text");
    expect(model.diff.readOnly).toBe(true);
    expect(model.diff.lines.every((l) => l.selIdx === -1)).toBe(true);
  });

  test("an oversized diff never carries sources", () => {
    const model = buildModel(
      baseInput({
        state: { selectedPath: "big.txt" },
        snapshot: { files: [changedFile({ path: "big.txt", staged: true, unstaged: false })] },
        stagingDiff: withSources(bigStagingDiff(3001), { old: "a", new: "b" }),
      }),
    );
    expect(model.diff.kind).toBe("oversized");
    expect(model.diff.oldSource).toBeUndefined();
    expect(model.diff.newSource).toBeUndefined();
  });

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

describe("stash on the wire", () => {
  const entry: DesktopStashEntry = { name: "refs/stash@{0}", stashSha: "s1", branchName: "main", tree: "t", parents: ["p", "i"] };
  const stashedA: CommittedFileChange = { path: "a.txt", status: { kind: AppFileStatusKind.Modified }, commitish: "s1", parentCommitish: "s1^" };

  function stashDiff(): StagingDiff {
    const lines = [new DiffLine("@@ -1,1 +1,1 @@", DiffLineType.Hunk, 1, null, null), new DiffLine("+stashed", DiffLineType.Add, 2, null, 1)];
    const hunk = new DiffHunk(new DiffHunkHeader(1, 1, 1, 1), lines, 0, lines.length - 1, DiffHunkExpansionType.None);
    return { path: "a.txt", kind: "text", untracked: false, hunks: [hunk] };
  }

  function withStash(showing: boolean): MissionModel {
    return buildModel({
      ...baseInput({
        state: { selectedPath: "b.txt" },
        snapshot: { files: [changedFile({ path: "b.txt" })] },
        stagingDiff: missionGoStagingDiff(),
      }),
      stash: { entry, files: [stashedA], showing, selectedFile: "a.txt" },
      stashDiff: { path: "a.txt", status: "modified", diff: stashDiff(), oversizedOverride: false },
    });
  }

  test("an open stash view carries the entry, its file rows, and the stash file's read-only diff", () => {
    const model = withStash(true);
    expect(model.stash).toEqual({
      sha: "s1",
      branch: "main",
      files: [{ path: "a.txt", origPath: "", status: "modified", onDisk: false }],
      showing: true,
      selectedFile: "a.txt",
    });
    expect(model.diff.path).toBe("a.txt");
    expect(model.diff.readOnly).toBe(true);
  });

  test("a closed stash view leaves the Changes diff in place", () => {
    const model = withStash(false);
    expect(model.stash?.showing).toBe(false);
    expect(model.diff.path).toBe("b.txt");
    expect(model.diff.readOnly).toBe(false);
  });

  test("a stash whose files are still loading sends null files", () => {
    const model = buildModel({ ...baseInput(), stash: { entry, files: null, showing: false, selectedFile: "" } });
    expect(model.stash?.files).toBeNull();
  });

  test("stash, switchPrompt, and canStash default to null, null, and false", () => {
    const model = buildModel(baseInput());
    expect(model.stash).toBeNull();
    expect(model.switchPrompt).toBeNull();
    expect(model.canStash).toBe(false);
  });

  test("switchPrompt and canStash pass through", () => {
    const prompt = { seq: 2, branch: "other", current: "main", hasStash: true };
    const model = buildModel({ ...baseInput({ state: { switchPrompt: prompt } }), canStash: true });
    expect(model.switchPrompt).toEqual(prompt);
    expect(model.canStash).toBe(true);
  });
});
