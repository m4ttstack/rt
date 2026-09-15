import { describe, expect, test } from "bun:test";
import { joinMrsToWorktrees, type MrMapRow } from "../mr-map.ts";

describe("joinMrsToWorktrees", () => {
  test("exact-equality join: foo-1 does not match foo-10", () => {
    const mrs = [
      { iid: 1, title: "Feature A", sourceBranch: "foo-1", state: "opened", pipelineStatus: "success" },
    ];
    const trees = [{ path: "/repo/foo-1", branch: "foo-10" }];

    const result = joinMrsToWorktrees(mrs, trees);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      ref: "!1",
      title: "Feature A",
      sourceBranch: "foo-1",
      worktree: null,
      mrState: "opened",
      ciStatus: "success",
    });
  });

  test("exact-equality join: foo-1 matches foo-1 exactly", () => {
    const mrs = [
      { iid: 2, title: "Feature B", sourceBranch: "foo-1", state: "opened", pipelineStatus: null },
    ];
    const trees = [{ path: "/repo/foo-1", branch: "foo-1" }];

    const result = joinMrsToWorktrees(mrs, trees);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      ref: "!2",
      title: "Feature B",
      sourceBranch: "foo-1",
      worktree: "/repo/foo-1",
      mrState: "opened",
      ciStatus: null,
    });
  });

  test("MR with no matching tree produces worktree: null", () => {
    const mrs = [{ iid: 3, title: "Feature C", sourceBranch: "no-match", state: "opened", pipelineStatus: "running" }];
    const trees = [{ path: "/repo/foo-1", branch: "foo-1" }];

    const result = joinMrsToWorktrees(mrs, trees);

    expect(result).toHaveLength(1);
    expect(result[0].worktree).toBe(null);
  });

  test("one row per MR in input order", () => {
    const mrs = [
      { iid: 10, title: "First", sourceBranch: "branch-a", state: "opened", pipelineStatus: "success" },
      { iid: 20, title: "Second", sourceBranch: "branch-b", state: "merged", pipelineStatus: null },
      { iid: 30, title: "Third", sourceBranch: "branch-c", state: "closed", pipelineStatus: "failed" },
    ];
    const trees = [
      { path: "/path/a", branch: "branch-a" },
      { path: "/path/b", branch: "branch-b" },
    ];

    const result = joinMrsToWorktrees(mrs, trees);

    expect(result).toHaveLength(3);
    expect(result[0].ref).toBe("!10");
    expect(result[1].ref).toBe("!20");
    expect(result[2].ref).toBe("!30");
    expect(result[0].worktree).toBe("/path/a");
    expect(result[1].worktree).toBe("/path/b");
    expect(result[2].worktree).toBe(null);
  });

  test("tree with null branch never matches any MR", () => {
    const mrs = [
      { iid: 40, title: "Orphan", sourceBranch: "some-branch", state: "opened", pipelineStatus: null },
    ];
    const trees = [{ path: "/detached", branch: null }];

    const result = joinMrsToWorktrees(mrs, trees);

    expect(result).toHaveLength(1);
    expect(result[0].worktree).toBe(null);
  });

  test("multiple trees with same branch uses the last one", () => {
    const mrs = [{ iid: 50, title: "Dupe branch", sourceBranch: "shared", state: "opened", pipelineStatus: null }];
    const trees = [
      { path: "/first/shared", branch: "shared" },
      { path: "/second/shared", branch: "shared" },
    ];

    const result = joinMrsToWorktrees(mrs, trees);

    expect(result).toHaveLength(1);
    expect(result[0].worktree).toBe("/second/shared");
  });

  test("empty MRs and trees", () => {
    const result = joinMrsToWorktrees([], []);
    expect(result).toHaveLength(0);
  });

  test("empty MRs with trees", () => {
    const trees = [{ path: "/repo", branch: "main" }];
    const result = joinMrsToWorktrees([], trees);
    expect(result).toHaveLength(0);
  });

  test("MRs with no trees", () => {
    const mrs = [{ iid: 60, title: "No trees", sourceBranch: "orphan", state: "opened", pipelineStatus: null }];
    const result = joinMrsToWorktrees(mrs, []);
    expect(result).toHaveLength(1);
    expect(result[0].worktree).toBe(null);
  });
});
