import { describe, test, expect, beforeEach } from "bun:test";
import { execSync } from "child_process";
import { mkdtempSync, realpathSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { containmentOf, patchIdenticalToMr } from "../containment.ts";

const GIT_ID = "-c user.email=t@t -c user.name=t";
const sh = (cmd: string, cwd?: string) => execSync(cmd, { cwd, shell: "/bin/zsh", stdio: "pipe" }).toString().trim();

function repoWithOrigin(): { repo: string } {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "rtcontain-")));
  sh(`git init -q -b main ${repo}`);
  sh(`git ${GIT_ID} commit -q --allow-empty -m init`, repo);
  const bare = mkdtempSync(join(tmpdir(), "rtcontain-bare-"));
  sh(`git clone -q --bare ${repo} ${bare}/o.git && git -C ${repo} remote add origin ${bare}/o.git && git -C ${repo} fetch -q origin`);
  return { repo };
}

function commit(cwd: string, file: string, body: string): string {
  writeFileSync(join(cwd, file), body);
  sh(`git add -A && git ${GIT_ID} commit -q -m ${file}`, cwd);
  return sh("git rev-parse HEAD", cwd);
}

describe("containmentOf", () => {
  let repo: string;
  beforeEach(() => ({ repo } = repoWithOrigin()));

  test("a branch whose HEAD is in the default branch is in-default", async () => {
    sh("git checkout -q -b feat", repo);
    commit(repo, "a.txt", "a\n");
    sh("git push -q origin feat:main", repo);
    sh("git fetch -q origin", repo);
    expect(await containmentOf(repo, "feat", null)).toBe("in-default");
  });

  test("a pushed branch not in main is on-remote", async () => {
    sh("git checkout -q -b feat", repo);
    commit(repo, "a.txt", "a\n");
    sh("git push -q origin feat", repo);
    expect(await containmentOf(repo, "feat", null)).toBe("on-remote");
  });

  test("a branch rebased before merge is patch-identical to the merged MR", async () => {
    sh("git checkout -q -b feat", repo);
    commit(repo, "a.txt", "a\n");
    commit(repo, "b.txt", "b\n");
    const local = sh("git rev-parse HEAD", repo);
    // What the forge saw: the same two patches rebased onto a moved main.
    sh("git checkout -q main", repo);
    commit(repo, "other.txt", "o\n");
    sh("git checkout -q -b rebased", repo);
    sh(`git ${GIT_ID} cherry-pick feat~1 feat`, repo);
    const mrSha = sh("git rev-parse HEAD", repo);
    sh("git push -q origin main", repo);
    sh("git checkout -q feat", repo);
    expect(sh("git rev-parse HEAD", repo)).toBe(local);
    expect(await containmentOf(repo, "feat", { state: "merged", sha: mrSha })).toBe("patch-identical");
  });

  test("a local branch named origin/main never vouches for HEAD", async () => {
    sh("git checkout -q -b feat", repo);
    commit(repo, "a.txt", "a\n");
    sh("git branch origin/main feat", repo);
    expect(await containmentOf(repo, "feat", null)).toBe("none");
  });

  test("a squash-merged HEAD whose branch never reached the remote is in the merged MR", async () => {
    sh("git checkout -q -b feat", repo);
    const mrSha = commit(repo, "a.txt", "a\n");
    expect(await containmentOf(repo, "feat", { state: "merged", sha: mrSha })).toBe("in-merged-mr");
  });

  test("a branch holding a commit the merged MR lacks is none even when HEAD is in the MR", async () => {
    sh("git checkout -q -b feat", repo);
    const mrSha = commit(repo, "a.txt", "a\n");
    commit(repo, "later.txt", "never merged\n");
    sh(`git checkout -q --detach ${mrSha}`, repo);
    expect(await containmentOf(repo, "feat", { state: "merged", sha: mrSha })).toBe("none");
  });

  test("one extra local commit beyond the merged MR is none", async () => {
    sh("git checkout -q -b feat", repo);
    commit(repo, "a.txt", "a\n");
    const mrSha = sh("git rev-parse HEAD", repo);
    commit(repo, "extra.txt", "x\n");
    expect(await containmentOf(repo, "feat", { state: "merged", sha: mrSha })).toBe("none");
  });

  test("an MR sha that is not local and cannot be fetched fails closed", async () => {
    sh("git checkout -q -b feat", repo);
    commit(repo, "a.txt", "a\n");
    const missing = "0123456789abcdef0123456789abcdef01234567";
    expect(await patchIdenticalToMr(repo, missing, "origin/main", async () => false)).toBe(false);
    expect(await containmentOf(repo, "feat", { state: "merged", sha: missing }, async () => false)).toBe("none");
  });

  test("a rebase merged into main via an explicit merge commit is patch-identical", async () => {
    sh("git checkout -q -b feat", repo);
    commit(repo, "a.txt", "a\n");
    const local = sh("git rev-parse HEAD", repo);
    // What the forge saw: the same patch rebased onto a moved main, landed
    // with a real merge commit (GitLab's semi-linear merge method).
    sh("git checkout -q main", repo);
    commit(repo, "other.txt", "o\n");
    sh("git checkout -q -b rebased", repo);
    sh(`git ${GIT_ID} cherry-pick feat`, repo);
    const mrSha = sh("git rev-parse HEAD", repo);
    sh("git checkout -q main", repo);
    sh(`git ${GIT_ID} merge --no-ff -m merge rebased`, repo);
    sh("git push -q origin main", repo);
    sh("git fetch -q origin", repo);
    sh("git checkout -q feat", repo);
    expect(sh("git rev-parse HEAD", repo)).toBe(local);
    expect(await containmentOf(repo, "feat", { state: "merged", sha: mrSha })).toBe("patch-identical");
  });

  test("a rebase merged into main by fast-forward is patch-identical", async () => {
    sh("git checkout -q -b feat", repo);
    commit(repo, "a.txt", "a\n");
    const local = sh("git rev-parse HEAD", repo);
    // A moved main (so the rebased commit's parent differs from feat's own
    // parent) landed by fast-forward: mrSha becomes main's tip verbatim.
    sh("git checkout -q main", repo);
    commit(repo, "other.txt", "o\n");
    sh("git checkout -q -b rebased", repo);
    sh(`git ${GIT_ID} cherry-pick feat`, repo);
    const mrSha = sh("git rev-parse HEAD", repo);
    sh("git checkout -q main", repo);
    sh("git merge -q --ff-only rebased", repo);
    sh("git push -q origin main", repo);
    sh("git fetch -q origin", repo);
    sh("git checkout -q feat", repo);
    expect(sh("git rev-parse HEAD", repo)).toBe(local);
    expect(await containmentOf(repo, "feat", { state: "merged", sha: mrSha })).toBe("patch-identical");
  });

  test("a local merge commit that adds content the MR lacks fails closed", async () => {
    sh("git checkout -q -b feat", repo);
    commit(repo, "a.txt", "a\n");
    sh("git checkout -q -b side", repo);
    sh(`git ${GIT_ID} commit -q --allow-empty -m empty`, repo);
    sh("git checkout -q feat", repo);
    sh(`git ${GIT_ID} merge --no-ff --no-commit side`, repo);
    writeFileSync(join(repo, "sneaky.txt"), "s\n");
    sh("git add -A", repo);
    sh(`git ${GIT_ID} commit -q -m merge`, repo);

    // What the forge saw: only the a.txt patch, rebased onto main.
    sh("git checkout -q -b rebased main", repo);
    sh(`git ${GIT_ID} cherry-pick feat~1`, repo);
    const mrSha = sh("git rev-parse HEAD", repo);
    sh("git push -q origin rebased:main", repo);
    sh("git fetch -q origin", repo);
    sh("git checkout -q feat", repo);

    expect(await containmentOf(repo, "feat", { state: "merged", sha: mrSha })).toBe("none");
  });
});
