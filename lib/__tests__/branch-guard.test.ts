import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildWorktreeGuardMap, checkBranchGuard } from "../branch-guard.ts";
import type { StackGuardRunners } from "../stack-guard.ts";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" });
}

/** Fresh repo on branch "main" with one commit. */
function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "rt-branch-guard-"));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "test@test");
  git(dir, "config", "user.name", "test");
  git(dir, "commit", "-q", "--allow-empty", "-m", "init");
  return dir;
}

const unreachableRunners: StackGuardRunners = {
  async gitqStacks() {
    throw new Error("gitqStacks should not be called");
  },
  async forgeOpenMrs() {
    throw new Error("forgeOpenMrs should not be called");
  },
};

const benignRunners: StackGuardRunners = {
  async gitqStacks() {
    return null;
  },
  async forgeOpenMrs() {
    return { ok: true, mrs: [] };
  },
};

describe("checkBranchGuard", () => {
  test("refuses a branch checked out in another worktree, naming its path", async () => {
    const parent = mkdtempSync(join(tmpdir(), "rt-branch-guard-parent-"));
    const dir = join(parent, "main");
    mkdirSync(dir);
    git(dir, "init", "-q", "-b", "main");
    git(dir, "config", "user.email", "test@test");
    git(dir, "config", "user.name", "test");
    git(dir, "commit", "-q", "--allow-empty", "-m", "init");
    git(dir, "branch", "feature-x");
    const wtPath = join(parent, "wt");
    git(dir, "worktree", "add", wtPath, "feature-x");

    const verdict = await checkBranchGuard({
      cwd: dir,
      branch: "feature-x",
      defaultBranch: "main",
      runners: unreachableRunners,
    });

    expect(verdict.verdict).toBe("refuse");
    if (verdict.verdict === "refuse") {
      expect(verdict.reason).toBe("worktree");
      expect(verdict.detail).toContain(wtPath);
    }
    rmSync(parent, { recursive: true, force: true });
  });

  test("refuses a gitq stack member with the stack hint", async () => {
    const dir = makeRepo();
    const runners: StackGuardRunners = {
      async gitqStacks() {
        return JSON.stringify({
          stacks: [{ stackName: "s1", root: "main", nodes: [{ branch: "feature-x", parent: "main" }] }],
        });
      },
      async forgeOpenMrs() {
        throw new Error("forgeOpenMrs should not be called once gitq finds membership");
      },
    };

    const verdict = await checkBranchGuard({ cwd: dir, branch: "feature-x", defaultBranch: "main", runners });

    expect(verdict.verdict).toBe("refuse");
    if (verdict.verdict === "refuse") {
      expect(verdict.reason).toBe("stack");
      expect(verdict.detail).toContain("stack s1");
    }
    rmSync(dir, { recursive: true, force: true });
  });

  test("maps a forge-unavailable stack check to unverified", async () => {
    const dir = makeRepo();
    const runners: StackGuardRunners = {
      async gitqStacks() {
        return null;
      },
      async forgeOpenMrs() {
        return { ok: false, error: "glab not installed" };
      },
    };

    const verdict = await checkBranchGuard({ cwd: dir, branch: "feature-x", defaultBranch: "main", runners });

    expect(verdict.verdict).toBe("unverified");
    if (verdict.verdict === "unverified") {
      expect(verdict.detail).toContain("glab not installed");
    }
    rmSync(dir, { recursive: true, force: true });
  });

  test("is clear when the branch is unowned and not part of any stack", async () => {
    const dir = makeRepo();
    const runners: StackGuardRunners = {
      async gitqStacks() {
        return null;
      },
      async forgeOpenMrs() {
        return { ok: true, mrs: [] };
      },
    };

    const verdict = await checkBranchGuard({ cwd: dir, branch: "feature-x", defaultBranch: "main", runners });

    expect(verdict).toEqual({ verdict: "clear" });
    rmSync(dir, { recursive: true, force: true });
  });

  test("is unverified, not clear, when worktree state cannot be determined", async () => {
    const dir = makeRepo();

    const verdict = await checkBranchGuard({
      cwd: dir,
      branch: "feature-x",
      defaultBranch: "main",
      runners: unreachableRunners,
      listWorktrees: async () => null,
    });

    expect(verdict.verdict).toBe("unverified");
    rmSync(dir, { recursive: true, force: true });
  });

  test("is clear from a subdirectory of the caller's own worktree on its own branch", async () => {
    const dir = makeRepo();
    const subDir = join(dir, "sub");
    mkdirSync(subDir);

    const verdict = await checkBranchGuard({
      cwd: subDir,
      branch: "main",
      defaultBranch: "main",
      runners: benignRunners,
    });

    expect(verdict).toEqual({ verdict: "clear" });
    rmSync(dir, { recursive: true, force: true });
  });

  test("is unverified, not thrown, when a listed worktree path no longer exists", async () => {
    const dir = makeRepo();

    const verdict = await checkBranchGuard({
      cwd: dir,
      branch: "feature-x",
      defaultBranch: "main",
      runners: unreachableRunners,
      listWorktrees: async () => [
        { path: join(dir, "gone"), branch: "feature-x", headSha: "abc123", isBare: false },
      ],
    });

    expect(verdict.verdict).toBe("unverified");
    if (verdict.verdict === "unverified") {
      expect(verdict.detail).toContain(join(dir, "gone"));
    }
    rmSync(dir, { recursive: true, force: true });
  });

  test("is unverified, not thrown, when cwd itself does not exist", async () => {
    const parent = mkdtempSync(join(tmpdir(), "rt-branch-guard-parent-"));
    const missing = join(parent, "does-not-exist");

    // listWorktrees is stubbed to succeed so the run reaches realpathSync(cwd)
    // instead of short-circuiting on the earlier "could not list" branch.
    const verdict = await checkBranchGuard({
      cwd: missing,
      branch: "feature-x",
      defaultBranch: "main",
      runners: unreachableRunners,
      listWorktrees: async () => [],
    });

    expect(verdict.verdict).toBe("unverified");
    if (verdict.verdict === "unverified") {
      expect(verdict.detail).toContain(missing);
    }
    rmSync(parent, { recursive: true, force: true });
  });

  test("still refuses an other-worktree-owned branch when cwd is a nested subdirectory", async () => {
    const parent = mkdtempSync(join(tmpdir(), "rt-branch-guard-parent-"));
    const dir = join(parent, "main");
    mkdirSync(dir);
    git(dir, "init", "-q", "-b", "main");
    git(dir, "config", "user.email", "test@test");
    git(dir, "config", "user.name", "test");
    git(dir, "commit", "-q", "--allow-empty", "-m", "init");
    git(dir, "branch", "feature-x");
    const wtPath = join(parent, "wt");
    git(dir, "worktree", "add", wtPath, "feature-x");
    const subDir = join(dir, "sub");
    mkdirSync(subDir);

    const verdict = await checkBranchGuard({
      cwd: subDir,
      branch: "feature-x",
      defaultBranch: "main",
      runners: unreachableRunners,
    });

    expect(verdict.verdict).toBe("refuse");
    if (verdict.verdict === "refuse") {
      expect(verdict.reason).toBe("worktree");
      expect(verdict.detail).toContain(wtPath);
    }
    rmSync(parent, { recursive: true, force: true });
  });
});

describe("buildWorktreeGuardMap", () => {
  test("maps a branch checked out in another worktree to a reason naming its path", async () => {
    const parent = mkdtempSync(join(tmpdir(), "rt-branch-guard-parent-"));
    const dir = join(parent, "main");
    mkdirSync(dir);
    git(dir, "init", "-q", "-b", "main");
    git(dir, "config", "user.email", "test@test");
    git(dir, "config", "user.name", "test");
    git(dir, "commit", "-q", "--allow-empty", "-m", "init");
    git(dir, "branch", "feature-x");
    const wtPath = join(parent, "wt");
    git(dir, "worktree", "add", wtPath, "feature-x");

    const guards = await buildWorktreeGuardMap(dir);

    expect(guards.get("feature-x")).toContain(wtPath);
    expect(guards.has("main")).toBe(false);
    rmSync(parent, { recursive: true, force: true });
  });

  test("is empty (never throws) when the current worktree owns every branch it knows about", async () => {
    const dir = makeRepo();
    const guards = await buildWorktreeGuardMap(dir);
    expect(guards.size).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });

  test("is empty when worktree state cannot be listed", async () => {
    const dir = makeRepo();
    const guards = await buildWorktreeGuardMap(dir, async () => null);
    expect(guards.size).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });

  test("never guards the worktree containing cwd itself, even from a nested subdirectory", async () => {
    const parent = mkdtempSync(join(tmpdir(), "rt-branch-guard-parent-"));
    const dir = join(parent, "main");
    mkdirSync(dir);
    git(dir, "init", "-q", "-b", "main");
    git(dir, "config", "user.email", "test@test");
    git(dir, "config", "user.name", "test");
    git(dir, "commit", "-q", "--allow-empty", "-m", "init");
    const subDir = join(dir, "sub");
    mkdirSync(subDir);

    const guards = await buildWorktreeGuardMap(subDir);

    expect(guards.has("main")).toBe(false);
    rmSync(parent, { recursive: true, force: true });
  });
});
