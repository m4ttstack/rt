import { describe, test, expect, beforeEach } from "bun:test";
import { execSync } from "child_process";
import { mkdtempSync, realpathSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { getRemoteDefaultBranch } from "../git-ops.ts";

// Mirrors lib/worktree/__tests__/git-async.test.ts's own sandbox pattern:
// realpathSync because git canonicalizes /var -> /private/var on macOS
// (Global Constraints).
function makeRepo(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "rtgitops-")));
  execSync("git init -q -b main", { cwd: dir, shell: "/bin/zsh" });
  execSync("git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init", { cwd: dir, shell: "/bin/zsh" });
  return dir;
}

function addBareRemote(repo: string, remote = "origin"): string {
  const bare = mkdtempSync(join(tmpdir(), "rtgitops-bare-"));
  execSync(`git clone -q --bare ${repo} ${bare}/o.git`, { shell: "/bin/zsh" });
  execSync(`git -C ${repo} remote add ${remote} ${bare}/o.git`, { shell: "/bin/zsh" });
  execSync(`git -C ${repo} fetch -q ${remote}`, { shell: "/bin/zsh" });
  return bare;
}

describe("getRemoteDefaultBranch", () => {
  let repo: string;
  beforeEach(() => { repo = makeRepo(); });

  test("no remote at all resolves to null (the null path)", () => {
    expect(getRemoteDefaultBranch(repo)).toBeNull();
  });

  test("resolves origin/main on a main-default origin (existing probe, non-regression)", () => {
    addBareRemote(repo);
    expect(getRemoteDefaultBranch(repo)).toBe("origin/main");
  });

  // CodeRabbit PR #353 finding: only origin/main and origin/master were ever
  // checked, so a repo whose remote defaults to a differently-named branch
  // (develop, trunk, ...) resolved to null and lost its whole "default
  // branch" section. The bare remote's own HEAD is on "develop" here (the
  // branch checked out at clone time), so refs/remotes/origin/HEAD (set
  // automatically by a modern `git fetch`, verified empirically against the
  // git on this machine) resolves it directly -- no origin/main or
  // origin/master ref exists in this repo at all.
  test("a repo whose remote default is \"develop\" (not main/master) resolves correctly", () => {
    execSync("git checkout -q -b develop", { cwd: repo, shell: "/bin/zsh" });
    execSync("git -c user.email=t@t -c user.name=t commit -q --allow-empty -m dev", { cwd: repo, shell: "/bin/zsh" });
    addBareRemote(repo);
    expect(getRemoteDefaultBranch(repo)).toBe("origin/develop");
  });

  // Some environments' git, or a remote added without ever running `clone`/
  // `remote set-head`, never populate refs/remotes/<remote>/HEAD locally --
  // ls-remote --symref asks the remote directly instead of trusting a local
  // ref that may not exist.
  test("falls back to ls-remote --symref when refs/remotes/<remote>/HEAD is not set locally", () => {
    execSync("git checkout -q -b develop", { cwd: repo, shell: "/bin/zsh" });
    execSync("git -c user.email=t@t -c user.name=t commit -q --allow-empty -m dev", { cwd: repo, shell: "/bin/zsh" });
    addBareRemote(repo);
    execSync("git symbolic-ref -d refs/remotes/origin/HEAD", { cwd: repo, shell: "/bin/zsh" });
    expect(getRemoteDefaultBranch(repo)).toBe("origin/develop");
  });

  // The last-resort main/master probes still cover a remote whose own HEAD
  // cannot be determined at all (e.g. ls-remote itself failing) but which
  // does carry one of the two conventional branches.
  test("falls back to the origin/master probe when neither symref path resolves", () => {
    execSync("git checkout -q -b master", { cwd: repo, shell: "/bin/zsh" });
    execSync("git branch -D main", { cwd: repo, shell: "/bin/zsh" });
    addBareRemote(repo);
    execSync("git symbolic-ref -d refs/remotes/origin/HEAD", { cwd: repo, shell: "/bin/zsh" });
    // Point the remote at an unreachable path so ls-remote itself fails,
    // isolating this test to the final probe step.
    execSync("git remote set-url origin /nonexistent/o.git", { cwd: repo, shell: "/bin/zsh" });
    expect(getRemoteDefaultBranch(repo)).toBe("origin/master");
  });

  test("takes the remote name as a parameter (RT-219: the \"origin\" stub is one-line wiring, not this function's job)", () => {
    addBareRemote(repo, "upstream");
    expect(getRemoteDefaultBranch(repo, "upstream")).toBe("upstream/main");
    expect(getRemoteDefaultBranch(repo)).toBeNull(); // no "origin" remote exists in this repo
  });
});
