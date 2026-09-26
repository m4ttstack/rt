import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { branchSyncPreflight, gitPull, gitPush, gitRebase, gitToolDefs, realGitRunner, type GitRunner } from "../git-tools.ts";
import type { TreeGuardDeps } from "../tree-guard.ts";

const GIT_PATHS = "rev-parse --git-path rebase-merge --git-path rebase-apply";

type Script = Record<string, { code?: number; stdout?: string; stderr?: string }>;
// `git remote` answers "origin\nfork" unless the script overrides it, so the
// fetch-before-rebase branch has remotes to recognize.
function fakeGit(script: Script, calls: string[] = []): GitRunner {
  return async (args) => {
    const key = args.join(" ");
    calls.push(key);
    const hit = script[key] ?? (key === "remote" ? { stdout: "origin\nfork\n" } : { code: 1, stderr: `unscripted: ${key}` });
    return { code: hit.code ?? 0, stdout: hit.stdout ?? "", stderr: hit.stderr ?? "" };
  };
}
const FULL_HEAD = "symbolic-ref --quiet HEAD";
const SHORT_HEAD = "symbolic-ref --quiet --short HEAD";
const on = (branch: string): Script => ({ [FULL_HEAD]: { stdout: `refs/heads/${branch}\n` }, [SHORT_HEAD]: { stdout: `${branch}\n` } });
// What `git symbolic-ref` prints on feat/x when a tag feat/x also exists.
const onTagAmbiguous: Script = { [FULL_HEAD]: { stdout: "refs/heads/feat/x\n" }, [SHORT_HEAD]: { stdout: "heads/feat/x\n" } };
const onFeature: Script = {
  ...on("feat/x"),
  "symbolic-ref --quiet --short refs/remotes/origin/HEAD": { stdout: "origin/develop\n" },
  "rev-parse --abbrev-ref --symbolic-full-name @{u}": { stdout: "origin/feat/x\n" },
};

describe("gitPush", () => {
  test("pushes HEAD to the upstream by explicit refspec, force only as --force-with-lease --force-if-includes", async () => {
    const calls: string[] = [];
    const r = await gitPush("/t", { forceWithLease: true }, fakeGit({ ...onFeature, "push --force-with-lease --force-if-includes origin HEAD:refs/heads/feat/x": {} }, calls));
    expect(r.ok).toBe(true);
    expect(calls.at(-1)).toBe("push --force-with-lease --force-if-includes origin HEAD:refs/heads/feat/x");
  });
  test("a forced setUpstream push carries both lease flags before -u", async () => {
    const calls: string[] = [];
    const r = await gitPush("/t", { forceWithLease: true, setUpstream: true }, fakeGit({ ...onFeature, "push --force-with-lease --force-if-includes -u origin HEAD:refs/heads/feat/x": {} }, calls));
    expect(r.ok).toBe(true);
    expect(calls.at(-1)).toBe("push --force-with-lease --force-if-includes -u origin HEAD:refs/heads/feat/x");
  });
  test("an upstream with a different branch name is refused, naming both and setUpstream", async () => {
    const calls: string[] = [];
    const script = { ...onFeature, "rev-parse --abbrev-ref --symbolic-full-name @{u}": { stdout: "origin/feat/parent\n" }, "push origin HEAD:refs/heads/feat/parent": {} };
    const r = await gitPush("/t", {}, fakeGit(script, calls));
    expect(r.ok).toBe(false);
    expect(r.error).toContain("feat/x");
    expect(r.error).toContain("origin/feat/parent");
    expect(r.error).toContain("setUpstream");
    expect(calls.some((c) => c.startsWith("push"))).toBe(false);
  });
  test("setUpstream pushes as origin/<branch> whatever the existing upstream, without reading it", async () => {
    const calls: string[] = [];
    const script = { ...onFeature, "rev-parse --abbrev-ref --symbolic-full-name @{u}": { stdout: "origin/main\n" }, "push -u origin HEAD:refs/heads/feat/x": {} };
    const r = await gitPush("/t", { setUpstream: true }, fakeGit(script, calls));
    expect(r.ok).toBe(true);
    expect(calls.at(-1)).toBe("push -u origin HEAD:refs/heads/feat/x");
    expect(calls).not.toContain("rev-parse --abbrev-ref --symbolic-full-name @{u}");
    expect((r.body as { upstream: string }).upstream).toBe("origin/feat/x");
  });
  test("an upstream on another remote goes to that remote", async () => {
    const calls: string[] = [];
    const script = { ...onFeature, "rev-parse --abbrev-ref --symbolic-full-name @{u}": { stdout: "fork/feat/x\n" }, "symbolic-ref --quiet --short refs/remotes/fork/HEAD": { code: 128 }, "ls-remote --symref fork HEAD": { stdout: "ref: refs/heads/main\tHEAD\n<sha>\tHEAD\n" }, "push fork HEAD:refs/heads/feat/x": {} };
    const r = await gitPush("/t", {}, fakeGit(script, calls));
    expect(r.ok).toBe(true);
    expect(calls.at(-1)).toBe("push fork HEAD:refs/heads/feat/x");
  });
  test("a remote name with a regex special character is matched by its literal prefix, not left unstripped by a broken RegExp", async () => {
    const calls: string[] = [];
    const script = { ...onFeature, "rev-parse --abbrev-ref --symbolic-full-name @{u}": { stdout: "fork+x/trunk\n" }, "symbolic-ref --quiet --short refs/remotes/fork+x/HEAD": { stdout: "fork+x/trunk\n" } };
    const r = await gitPush("/t", {}, fakeGit(script, calls));
    expect(r.ok).toBe(false);
    expect(calls.some((c) => c.startsWith("push"))).toBe(false);
  });
  test("origin's default resolved via ls-remote when its HEAD symref is missing refuses the current branch develop", async () => {
    const calls: string[] = [];
    const script: Script = {
      ...on("develop"),
      "symbolic-ref --quiet --short refs/remotes/origin/HEAD": { code: 128 },
      "ls-remote --symref origin HEAD": { stdout: "ref: refs/heads/develop\tHEAD\n<sha>\tHEAD\n" },
      "rev-parse --abbrev-ref --symbolic-full-name @{u}": { stdout: "origin/develop\n" },
      "push origin HEAD:refs/heads/develop": {},
    };
    const r = await gitPush("/t", {}, fakeGit(script, calls));
    expect(r.ok).toBe(false);
    expect(calls.some((c) => c.startsWith("push"))).toBe(false);
  });
  test("an upstream's remote default resolved via ls-remote when its HEAD symref is missing refuses origin/trunk", async () => {
    const calls: string[] = [];
    const script: Script = {
      ...on("feat/x"),
      "rev-parse --abbrev-ref --symbolic-full-name @{u}": { stdout: "origin/trunk\n" },
      "symbolic-ref --quiet --short refs/remotes/origin/HEAD": { code: 128 },
      "ls-remote --symref origin HEAD": { stdout: "ref: refs/heads/trunk\tHEAD\n<sha>\tHEAD\n" },
    };
    const r = await gitPush("/t", {}, fakeGit(script, calls));
    expect(r.ok).toBe(false);
    expect(calls.some((c) => c.startsWith("push"))).toBe(false);
  });
  test("origin's default unknown when both the symref and ls-remote fail refuses with a named error", async () => {
    const calls: string[] = [];
    const script: Script = {
      ...on("feat/x"),
      "symbolic-ref --quiet --short refs/remotes/origin/HEAD": { code: 128 },
      "ls-remote --symref origin HEAD": { code: 128 },
    };
    const r = await gitPush("/t", {}, fakeGit(script, calls));
    expect(r.ok).toBe(false);
    expect(r.error).toContain("could not be determined");
    expect(calls.some((c) => c.startsWith("push"))).toBe(false);
  });
  test("a feature branch whose upstream is origin/main (checkout -b feat/x origin/main) is refused", async () => {
    for (const up of ["origin/main", "origin/master", "origin/develop"]) {
      const calls: string[] = [];
      const r = await gitPush("/t", { forceWithLease: true }, fakeGit({ ...onFeature, "rev-parse --abbrev-ref --symbolic-full-name @{u}": { stdout: `${up}\n` } }, calls));
      expect(r.ok, up).toBe(false);
      expect(r.error, up).toContain(up);
      expect(r.error, up).toContain("setUpstream: true");
      expect(calls.some((c) => c.startsWith("push")), up).toBe(false);
    }
  });
  test("an upstream on another remote is checked against THAT remote's default", async () => {
    const calls: string[] = [];
    const script = { ...onFeature, "rev-parse --abbrev-ref --symbolic-full-name @{u}": { stdout: "fork/trunk\n" }, "symbolic-ref --quiet --short refs/remotes/fork/HEAD": { stdout: "fork/trunk\n" } };
    const r = await gitPush("/t", {}, fakeGit(script, calls));
    expect(r.ok).toBe(false);
    expect(calls.some((c) => c.startsWith("push"))).toBe(false);
  });
  test("setUpstream pushes -u origin HEAD:refs/heads/<branch>", async () => {
    const calls: string[] = [];
    const script = { ...onFeature, "rev-parse --abbrev-ref --symbolic-full-name @{u}": { code: 128 }, "push -u origin HEAD:refs/heads/feat/x": {} };
    const r = await gitPush("/t", { setUpstream: true }, fakeGit(script, calls));
    expect(r.ok).toBe(true);
    expect(calls.at(-1)).toBe("push -u origin HEAD:refs/heads/feat/x");
  });
  test("no upstream and no setUpstream is an error naming setUpstream", async () => {
    const r = await gitPush("/t", {}, fakeGit({ ...onFeature, "rev-parse --abbrev-ref --symbolic-full-name @{u}": { code: 128 } }));
    expect(r.ok).toBe(false);
    expect(r.error).toContain("setUpstream");
  });
  test("a rejected push reports the rejection line, not git's trailing hints", async () => {
    const stderr = [
      "To example.com:acme/app.git",
      " ! [rejected]        feat/x -> feat/x (fetch first)",
      "error: failed to push some refs to 'example.com:acme/app.git'",
      "hint: Updates were rejected because the remote contains work that you do not",
      "hint: have locally.",
      "hint: See the 'Note about fast-forwards' in 'git push --help' for details.",
    ].join("\n");
    const r = await gitPush("/t", {}, fakeGit({ ...onFeature, "push origin HEAD:refs/heads/feat/x": { code: 1, stderr } }));
    expect(r.ok).toBe(false);
    expect(r.error).toContain("! [rejected]");
    expect(r.error).not.toContain("hint:");
  });
  test("refuses a detached HEAD", async () => {
    const calls: string[] = [];
    const r = await gitPush("/t", {}, fakeGit({ [FULL_HEAD]: { code: 1 } }, calls));
    expect(r.ok).toBe(false);
    expect(r.error).toContain("detached");
    expect(calls.some((c) => c.startsWith("push"))).toBe(false);
  });
  test("refuses main, master and the remote default branch", async () => {
    for (const branch of ["main", "master", "develop"]) {
      const calls: string[] = [];
      const r = await gitPush("/t", { forceWithLease: true }, fakeGit({ ...onFeature, ...on(branch) }, calls));
      expect(r.ok, branch).toBe(false);
      expect(calls.some((c) => c.startsWith("push")), branch).toBe(false);
    }
  });
  test("reads the full HEAD ref, so main is refused whatever the short form prints", async () => {
    const calls: string[] = [];
    const r = await gitPush("/t", {}, fakeGit({ ...onFeature, [FULL_HEAD]: { stdout: "refs/heads/main\n" }, [SHORT_HEAD]: { stdout: "heads/main\n" } }, calls));
    expect(r.ok).toBe(false);
    expect(r.error).toContain("refusing to push main:");
    expect(calls.some((c) => c.startsWith("push"))).toBe(false);
  });
  test("a HEAD outside refs/heads is refused like a detached HEAD", async () => {
    const calls: string[] = [];
    const r = await gitPush("/t", {}, fakeGit({ ...onFeature, [FULL_HEAD]: { stdout: "refs/remotes/origin/feat/x\n" } }, calls));
    expect(r.ok).toBe(false);
    expect(r.error).toContain("detached");
    expect(calls.some((c) => c.startsWith("push"))).toBe(false);
  });
  test("setUpstream on a branch that shares its name with a tag pushes the stripped branch name", async () => {
    const calls: string[] = [];
    const r = await gitPush("/t", { setUpstream: true }, fakeGit({ ...onFeature, ...onTagAmbiguous, "push -u origin HEAD:refs/heads/feat/x": {} }, calls));
    expect(r.ok).toBe(true);
    expect(calls.at(-1)).toBe("push -u origin HEAD:refs/heads/feat/x");
    expect((r.body as { upstream: string }).upstream).toBe("origin/feat/x");
  });
});

describe("realGitRunner", () => {
  test("runs git with terminal prompts disabled so a credential prompt fails instead of hanging", async () => {
    const dir = mkdtempSync(join(tmpdir(), "git-runner-"));
    try {
      const r = await realGitRunner(["-c", 'alias.envp=!printf %s "$GIT_TERMINAL_PROMPT"', "envp"], dir);
      expect(r.code).toBe(0);
      expect(r.stdout).toBe("0");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("gitPull", () => {
  test("is --ff-only and reports a diverged branch as an error", async () => {
    const calls: string[] = [];
    const ok = await gitPull("/t", fakeGit({ "pull --ff-only": { stdout: "Fast-forward" } }, calls));
    expect(ok.ok).toBe(true);
    expect(calls).toEqual(["pull --ff-only"]);
    const diverged = await gitPull("/t", fakeGit({ "pull --ff-only": { code: 128, stderr: "fatal: Not possible to fast-forward, aborting." } }));
    expect(diverged.ok).toBe(false);
    expect(diverged.error).toContain("fast-forward");
  });
});

describe("gitRebase", () => {
  test("rebases onto a remote-tracking ref after fetching its remote", async () => {
    const calls: string[] = [];
    const r = await gitRebase("/t", { onto: "origin/develop" }, fakeGit({ "fetch origin": {}, "rebase --end-of-options origin/develop": {} }, calls));
    expect(r).toEqual({ ok: true, body: { status: "ok", onto: "origin/develop", fetched: "origin" } });
    expect(calls).toEqual(["remote", "fetch origin", "rebase --end-of-options origin/develop"]);
  });
  test("a local ref is not fetched", async () => {
    const calls: string[] = [];
    const r = await gitRebase("/t", { onto: "develop" }, fakeGit({ "rebase --end-of-options develop": {} }, calls));
    expect(r).toEqual({ ok: true, body: { status: "ok", onto: "develop", fetched: null } });
    expect(calls).toEqual(["rebase --end-of-options develop"]);
  });
  test("an onto that starts with a dash is refused before git runs", async () => {
    for (const onto of ["--exec=touch /tmp/x", "-i", "--onto=x"]) {
      const calls: string[] = [];
      const r = await gitRebase("/t", { onto }, fakeGit({}, calls));
      expect(r.ok, onto).toBe(false);
      expect(calls.filter((c) => c.startsWith("rebase")), onto).toEqual([]);
    }
  });
  test("a conflict returns the conflicted files and leaves the tree mid-rebase", async () => {
    const calls: string[] = [];
    const r = await gitRebase("/t", { onto: "origin/develop" }, fakeGit({ "fetch origin": {}, "rebase --end-of-options origin/develop": { code: 1, stderr: "CONFLICT" }, "diff --name-only --diff-filter=U": { stdout: "a.ts\nb.ts\n" } }, calls));
    expect(r).toEqual({ ok: true, body: { status: "conflict", onto: "origin/develop", files: ["a.ts", "b.ts"] } });
    expect(calls).not.toContain("rebase --abort");
  });
  test("abort runs rebase --abort; onto and abort together are refused", async () => {
    const calls: string[] = [];
    const r = await gitRebase("/t", { abort: true }, fakeGit({ "rebase --abort": {} }, calls));
    expect(r).toEqual({ ok: true, body: { status: "aborted" } });
    const both = await gitRebase("/t", { abort: true, onto: "x" }, fakeGit({}));
    expect(both.ok).toBe(false);
    const neither = await gitRebase("/t", {}, fakeGit({}));
    expect(neither.ok).toBe(false);
  });
});

describe("gitToolDefs guard", () => {
  test("every git tool refuses an unregistered tree before running git", async () => {
    const calls: string[] = [];
    const guard: TreeGuardDeps = { repoIndex: () => ({}), treeByPath: () => null, realpath: (p) => p };
    let synced = false;
    for (const [name, input] of [["git_push", {}], ["git_pull", {}], ["git_rebase", { onto: "x" }], ["branch_sync", {}]] as const) {
      const tool = gitToolDefs({ git: fakeGit({}, calls), guard, sync: async () => { synced = true; return { code: 0, stdout: "", stderr: "" }; } }).find((t) => t.name === name)!;
      const r = await tool.handler({ tree: "/elsewhere", ...input }, {} as NodeJS.ProcessEnv);
      expect(r.ok, name).toBe(false);
      expect(r.error, name).toContain("registered");
    }
    expect(calls).toEqual([]);
    expect(synced).toBe(false);
  });
});

describe("branchSyncPreflight", () => {
  const base: Script = {
    [GIT_PATHS]: { stdout: "/t/.git/rebase-merge\n/t/.git/rebase-apply\n" },
    ...on("feat/x"),
    "symbolic-ref --quiet --short refs/remotes/origin/HEAD": { stdout: "origin/develop\n" },
    "config --get-all remote.origin.push": { code: 1 },
    "config --get push.default": { code: 1 },
    "fetch origin": {},
    "rev-parse --verify --quiet origin/feat/x": {},
  };
  test("not diverged passes", async () => {
    const r = await branchSyncPreflight("/t", fakeGit({ ...base, "rev-list --left-right --count origin/feat/x...HEAD": { stdout: "0\t2\n" } }));
    expect(r).toEqual({ ok: true, diverged: false });
  });
  const COUNT = "rev-list --left-right --count origin/feat/x...HEAD";
  const RIGHT_ONLY = "rev-list --cherry-pick --right-only --no-merges origin/feat/x...HEAD ^origin/develop";
  const LEFT_ONLY = "rev-list --cherry-pick --left-only --no-merges origin/feat/x...HEAD ^origin/develop";
  const LOCAL_BASE = "merge-base HEAD origin/develop";
  const REMOTE_BASE = "merge-base origin/feat/x origin/develop";
  const localNewer: Script = {
    [COUNT]: { stdout: "2\t4\n" },
    [RIGHT_ONLY]: {},
    [LOCAL_BASE]: { stdout: "newbase\n" },
    [REMOTE_BASE]: { stdout: "oldbase\n" },
    "merge-base --is-ancestor oldbase newbase": {},
  };
  test("diverged with every local commit patch-equivalent on origin passes (the GitLab-rebased case)", async () => {
    const r = await branchSyncPreflight("/t", fakeGit({ ...base, [COUNT]: { stdout: "3\t2\n" }, [RIGHT_ONLY]: {}, [LOCAL_BASE]: { stdout: "b1\n" }, [REMOTE_BASE]: { stdout: "b1\n" } }));
    expect(r).toEqual({ ok: true, diverged: true });
  });
  test("behind origin with nothing local refuses and points at git_pull", async () => {
    const calls: string[] = [];
    const r = await branchSyncPreflight("/t", fakeGit({ ...base, [COUNT]: { stdout: "2\t0\n" } }, calls));
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toBe("origin/feat/x has commits this tree lacks; run git_pull first");
  });
  test("a local-newer rewrite with a commit only origin has refuses and names it", async () => {
    const r = await branchSyncPreflight("/t", fakeGit({ ...base, ...localNewer, [LEFT_ONLY]: { stdout: "abc1234\n" } }));
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toContain("origin/feat/x has commits this tree lacks");
    expect((r as { error: string }).error).toContain("abc1234");
  });
  test("a local-newer rewrite with nothing only on origin passes", async () => {
    const r = await branchSyncPreflight("/t", fakeGit({ ...base, ...localNewer, [LEFT_ONLY]: {} }));
    expect(r).toEqual({ ok: true, diverged: true });
  });
  test("a GitLab-rebased branch (remote base not older) with a remote-only suggestion commit passes without the remote-only check", async () => {
    const calls: string[] = [];
    const r = await branchSyncPreflight("/t", fakeGit({ ...base, [COUNT]: { stdout: "4\t2\n" }, [RIGHT_ONLY]: {}, [LOCAL_BASE]: { stdout: "oldbase\n" }, [REMOTE_BASE]: { stdout: "newbase\n" }, "merge-base --is-ancestor newbase oldbase": { code: 1 } }, calls));
    expect(r).toEqual({ ok: true, diverged: true });
    expect(calls).not.toContain(LEFT_ONLY);
  });
  test("a failing local-newer probe refuses", async () => {
    const brokenProbes: Script[] = [{ [LOCAL_BASE]: { code: 128, stderr: "fatal: bad" } }, { [REMOTE_BASE]: { code: 1 } }, { "merge-base --is-ancestor oldbase newbase": { code: 128 } }, { [LEFT_ONLY]: { code: 128 } }];
    for (const broken of brokenProbes) {
      const r = await branchSyncPreflight("/t", fakeGit({ ...base, ...localNewer, [LEFT_ONLY]: {}, ...broken }));
      expect(r.ok, Object.keys(broken)[0]).toBe(false);
    }
  });
  test("diverged with an unpushed local commit refuses and names it", async () => {
    const r = await branchSyncPreflight("/t", fakeGit({ ...base, "rev-list --left-right --count origin/feat/x...HEAD": { stdout: "3\t2\n" }, "rev-list --cherry-pick --right-only --no-merges origin/feat/x...HEAD ^origin/develop": { stdout: "0123456\n" } }));
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toContain("0123456");
  });
  test("a local rebase onto a newer default does not read the rebase-carried commits as unpushed work", async () => {
    const r = await branchSyncPreflight("/t", fakeGit({ ...base, ...localNewer, [LEFT_ONLY]: {} }));
    expect(r).toEqual({ ok: true, diverged: true });
  });
  test("no remote branch yet passes; a detached HEAD refuses", async () => {
    expect(await branchSyncPreflight("/t", fakeGit({ ...base, "rev-parse --verify --quiet origin/feat/x": { code: 1 } }))).toEqual({ ok: true, diverged: false });
    const broken = await branchSyncPreflight("/t", fakeGit({ ...base, "rev-parse --verify --quiet origin/feat/x": { code: 128, stderr: "fatal: bad object" }, "rev-list --left-right --count origin/feat/x...HEAD": { stdout: "0\t1\n" } }));
    expect(broken.ok).toBe(false);
    expect((broken as { error: string }).error).toContain("fatal: bad object");
    const detached = await branchSyncPreflight("/t", fakeGit({ ...base, [FULL_HEAD]: { code: 1 } }));
    expect(detached.ok).toBe(false);
    expect((detached as { error: string }).error).toContain("detached");
  });
  test("a tree paused mid-rebase refuses with how to finish it, before the detached-HEAD refusal", async () => {
    for (const [gitPaths, present] of [
      [".git/rebase-merge\n.git/rebase-apply\n", "/t/.git/rebase-merge"],
      ["/repo/.git/worktrees/t/rebase-merge\n/repo/.git/worktrees/t/rebase-apply\n", "/repo/.git/worktrees/t/rebase-apply"],
    ] as const) {
      const calls: string[] = [];
      const r = await branchSyncPreflight("/t", fakeGit({ ...base, [GIT_PATHS]: { stdout: gitPaths }, [FULL_HEAD]: { code: 1 } }, calls), (p) => p === present);
      expect(r.ok, present).toBe(false);
      expect((r as { error: string }).error, present).toBe("a rebase is in progress; finish it with git rebase --continue or git_rebase {abort: true}");
      expect(calls, present).not.toContain("fetch origin");
    }
  });
  test("the rebase-in-progress probe failing refuses", async () => {
    const r = await branchSyncPreflight("/t", fakeGit({ ...base, [COUNT]: { stdout: "0\t1\n" }, [GIT_PATHS]: { code: 128, stderr: "fatal: not a git repository" } }), () => false);
    expect(r.ok).toBe(false);
  });
  test("main, master and the remote default branch refuse before any fetch (rt sync would force-push them)", async () => {
    for (const branch of ["main", "master", "develop"]) {
      const calls: string[] = [];
      const r = await branchSyncPreflight("/t", fakeGit({ ...base, ...on(branch), "symbolic-ref --quiet --short refs/remotes/origin/HEAD": { stdout: "origin/develop\n" } }, calls));
      expect(r.ok, branch).toBe(false);
      expect(calls, branch).not.toContain("fetch origin");
    }
  });
  test("a full HEAD ref of refs/heads/main refuses whatever the short form prints", async () => {
    const calls: string[] = [];
    const r = await branchSyncPreflight("/t", fakeGit({ ...base, [FULL_HEAD]: { stdout: "refs/heads/main\n" }, [SHORT_HEAD]: { stdout: "main\n" } }, calls));
    expect(r.ok).toBe(false);
    expect(calls).not.toContain("fetch origin");
  });

  describe("a branch name ambiguous with another ref", () => {
    test("a short HEAD that differs from the stripped full ref refuses before any fetch", async () => {
      const calls: string[] = [];
      const r = await branchSyncPreflight("/t", fakeGit({ ...base, ...onTagAmbiguous }, calls));
      expect(r.ok).toBe(false);
      expect((r as { error: string }).error).toContain("ambiguous");
      expect(calls).not.toContain("fetch origin");
    });
    test("the short HEAD read failing refuses", async () => {
      const calls: string[] = [];
      const r = await branchSyncPreflight("/t", fakeGit({ ...base, [SHORT_HEAD]: { code: 128, stderr: "fatal: bad" } }, calls));
      expect(r.ok).toBe(false);
      expect(calls).not.toContain("fetch origin");
    });
    test("real git: a branch sharing its name with a tag refuses before any fetch", async () => {
      const dir = mkdtempSync(join(tmpdir(), "git-ambiguous-"));
      try {
        const setup = [
          ["init", "-q", "-b", "develop"],
          ["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "a"],
          ["checkout", "-q", "-b", "feat/x"],
          ["tag", "feat/x"],
        ];
        for (const args of setup) expect((await realGitRunner(args, dir)).code, args.join(" ")).toBe(0);
        const calls: string[] = [];
        const recording: GitRunner = (args, cwd) => { calls.push(args.join(" ")); return realGitRunner(args, cwd); };
        const r = await branchSyncPreflight(dir, recording);
        expect(r.ok).toBe(false);
        expect((r as { error: string }).error).toContain("ambiguous");
        expect(calls.some((c) => c.startsWith("fetch"))).toBe(false);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("branch names rt sync cannot pass safely", () => {
    test("a branch with shell metacharacters, whitespace or a leading dash refuses before any config read or fetch", async () => {
      for (const branch of ["x$(touch${IFS}PWNED)", "a;id|sh", "a b", "--mirror", "--all", "-f"]) {
        const calls: string[] = [];
        const r = await branchSyncPreflight("/t", fakeGit({ ...base, ...on(branch) }, calls));
        expect(r.ok, branch).toBe(false);
        expect((r as { error: string }).error, branch).toContain("cannot pass safely");
        expect(calls.filter((c) => c.startsWith("config") || c.startsWith("fetch")), branch).toEqual([]);
      }
    });
    test("a branch of letters, digits, dots, slashes, dashes and underscores passes", async () => {
      const r = await branchSyncPreflight("/t", fakeGit({ ...base, ...on("feat/x-1.2_y"), "rev-parse --verify --quiet origin/feat/x-1.2_y": { code: 1 } }));
      expect(r).toEqual({ ok: true, diverged: false });
    });
  });

  describe("push redirection", () => {
    test("remote.origin.push set refuses, naming the setting, before any fetch", async () => {
      const calls: string[] = [];
      const r = await branchSyncPreflight("/t", fakeGit({ ...base, "config --get-all remote.origin.push": { stdout: "+refs/heads/*:refs/heads/*\n" } }, calls));
      expect(r.ok).toBe(false);
      expect((r as { error: string }).error).toContain("remote.origin.push");
      expect(calls).not.toContain("fetch origin");
    });
    test("push.default upstream with branch.<b>.merge pointing elsewhere refuses", async () => {
      const r = await branchSyncPreflight("/t", fakeGit({ ...base, "config --get push.default": { stdout: "upstream\n" }, "config --get branch.feat/x.merge": { stdout: "refs/heads/develop\n" } }));
      expect(r.ok).toBe(false);
    });
    test("push.default upstream with branch.<b>.merge unset refuses", async () => {
      const r = await branchSyncPreflight("/t", fakeGit({ ...base, "config --get push.default": { stdout: "upstream\n" }, "config --get branch.feat/x.merge": { code: 1 } }));
      expect(r.ok).toBe(false);
    });
    test("push.default upstream with branch.<b>.merge matching the current branch passes the redirect check", async () => {
      const r = await branchSyncPreflight("/t", fakeGit({ ...base, "config --get push.default": { stdout: "upstream\n" }, "config --get branch.feat/x.merge": { stdout: "refs/heads/feat/x\n" }, "rev-list --left-right --count origin/feat/x...HEAD": { stdout: "0\t2\n" } }));
      expect(r).toEqual({ ok: true, diverged: false });
    });
    test("push.default tracking is treated the same as upstream", async () => {
      const r = await branchSyncPreflight("/t", fakeGit({ ...base, "config --get push.default": { stdout: "tracking\n" }, "config --get branch.feat/x.merge": { stdout: "refs/heads/develop\n" } }));
      expect(r.ok).toBe(false);
    });
    test("a git config error other than unset refuses", async () => {
      const r = await branchSyncPreflight("/t", fakeGit({ ...base, "config --get-all remote.origin.push": { code: 2, stderr: "fatal: bad config" } }));
      expect(r.ok).toBe(false);
    });
  });

  describe("failing closed on a git error", () => {
    test("rev-list --left-right --count failing refuses instead of reading as not diverged", async () => {
      const r = await branchSyncPreflight("/t", fakeGit({ ...base, "rev-list --left-right --count origin/feat/x...HEAD": { code: 128, stderr: "fatal: bad revision" } }));
      expect(r.ok).toBe(false);
    });
    test("a garbled count refuses instead of parsing as 0", async () => {
      const r = await branchSyncPreflight("/t", fakeGit({ ...base, "rev-list --left-right --count origin/feat/x...HEAD": { stdout: "not-a-number\n" } }));
      expect(r.ok).toBe(false);
    });
    test("the unpushed-commit check failing refuses instead of reading as nothing unpushed", async () => {
      const r = await branchSyncPreflight("/t", fakeGit({ ...base, "rev-list --left-right --count origin/feat/x...HEAD": { stdout: "3\t2\n" }, "rev-list --cherry-pick --right-only --no-merges origin/feat/x...HEAD ^origin/develop": { code: 128, stderr: "fatal: bad revision" } }));
      expect(r.ok).toBe(false);
    });
  });
});

describe("branch_sync tool", () => {
  const guard: TreeGuardDeps = { repoIndex: () => ({ r: "/t" }), treeByPath: () => null, realpath: (p) => p };
  const clean: Script = {
    [GIT_PATHS]: { stdout: "/t/.git/rebase-merge\n/t/.git/rebase-apply\n" },
    ...on("feat/x"), "symbolic-ref --quiet --short refs/remotes/origin/HEAD": { stdout: "origin/develop\n" },
    "config --get-all remote.origin.push": { code: 1 }, "config --get push.default": { code: 1 },
    "fetch origin": {}, "rev-parse --verify --quiet origin/feat/x": {},
    "rev-list --left-right --count origin/feat/x...HEAD": { stdout: "0\t1\n" },
  };
  test("exit 0 with empty stdout is synced, reporting whether the preflight saw a divergence", async () => {
    const tool = gitToolDefs({ git: fakeGit(clean), guard, sync: async () => ({ code: 0, stdout: "", stderr: "" }) }).find((t) => t.name === "branch_sync")!;
    const r = await tool.handler({ tree: "/t" }, {} as NodeJS.ProcessEnv);
    expect(r).toEqual({ ok: true, body: { status: "synced", divergedFromOrigin: false } });
  });
  const runSync = async (code: number, stdout: string) => {
    const tool = gitToolDefs({ git: fakeGit(clean), guard, sync: async () => ({ code, stdout, stderr: "" }) }).find((t) => t.name === "branch_sync")!;
    return tool.handler({ tree: "/t" }, {} as NodeJS.ProcessEnv);
  };
  test("exit 3 is a conflict carrying rt sync's bundle", async () => {
    const bundle = { kind: "rebase-conflict", state: "mid-rebase", branch: "feat/x", target: "origin/develop", commitsBehind: 2, unresolvedFiles: ["a.ts"], autoResolvedFiles: [], backupBranch: null, branchCommits: [], targetCommits: [], hint: "resolve and continue" };
    const r = await runSync(3, JSON.stringify(bundle, null, 2));
    expect(r.ok).toBe(true);
    expect(r.body).toMatchObject({ status: "conflict", unresolvedFiles: ["a.ts"], state: "mid-rebase" });
  });
  test("exit 4 is a refusal whose error carries the stack refusal's hint", async () => {
    const refusal = { kind: "stack-refusal", branch: "feat/x", source: "gitq", stack: null, mrs: null, tool: "/gitq:sync", hint: "feat/x is a member of stack s; sync the stack instead" };
    const r = await runSync(4, JSON.stringify(refusal, null, 2));
    expect(r.ok).toBe(false);
    expect(r.error).toBe("rt sync refused (exit 4): feat/x is a member of stack s; sync the stack instead. Run: /gitq:sync");
  });
  test("a failed preflight never runs rt sync", async () => {
    let ran = false;
    const tool = gitToolDefs({ git: fakeGit({ ...clean, "rev-list --left-right --count origin/feat/x...HEAD": { stdout: "1\t1\n" }, "rev-list --cherry-pick --right-only --no-merges origin/feat/x...HEAD ^origin/develop": { stdout: "9999\n" } }), guard, sync: async () => { ran = true; return { code: 0, stdout: "{}", stderr: "" }; } }).find((t) => t.name === "branch_sync")!;
    const r = await tool.handler({ tree: "/t" }, {} as NodeJS.ProcessEnv);
    expect(r.ok).toBe(false);
    expect(ran).toBe(false);
  });
  test("a branch name carrying shell or a git option never reaches rt sync", async () => {
    for (const branch of ["x$(touch${IFS}PWNED)", "--mirror", "--all", "-f"]) {
      let ran = false;
      const calls: string[] = [];
      const tool = gitToolDefs({ git: fakeGit({ ...clean, ...on(branch) }, calls), guard, sync: async () => { ran = true; return { code: 0, stdout: "", stderr: "" }; } }).find((t) => t.name === "branch_sync")!;
      const r = await tool.handler({ tree: "/t" }, {} as NodeJS.ProcessEnv);
      expect(r.ok, branch).toBe(false);
      expect(ran, branch).toBe(false);
      expect(calls, branch).not.toContain("fetch origin");
    }
  });
  test("a branch name ambiguous with a tag never reaches rt sync", async () => {
    let ran = false;
    const calls: string[] = [];
    const tool = gitToolDefs({ git: fakeGit({ ...clean, ...onTagAmbiguous }, calls), guard, sync: async () => { ran = true; return { code: 0, stdout: "", stderr: "" }; } }).find((t) => t.name === "branch_sync")!;
    const r = await tool.handler({ tree: "/t" }, {} as NodeJS.ProcessEnv);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("ambiguous");
    expect(ran).toBe(false);
    expect(calls).not.toContain("fetch origin");
  });
  test("a push redirect never runs rt sync", async () => {
    let ran = false;
    const tool = gitToolDefs({ git: fakeGit({ ...clean, "config --get-all remote.origin.push": { stdout: "+refs/heads/*:refs/heads/*\n" } }), guard, sync: async () => { ran = true; return { code: 0, stdout: "{}", stderr: "" }; } }).find((t) => t.name === "branch_sync")!;
    const r = await tool.handler({ tree: "/t" }, {} as NodeJS.ProcessEnv);
    expect(r.ok).toBe(false);
    expect(ran).toBe(false);
  });
});
