import { describe, expect, test } from "bun:test";
import { branchSyncPreflight, gitPull, gitPush, gitRebase, gitToolDefs, type GitRunner } from "../git-tools.ts";
import type { TreeGuardDeps } from "../tree-guard.ts";

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
const onFeature: Script = {
  "symbolic-ref --quiet --short HEAD": { stdout: "feat/x\n" },
  "symbolic-ref --quiet --short refs/remotes/origin/HEAD": { stdout: "origin/develop\n" },
  "rev-parse --abbrev-ref --symbolic-full-name @{u}": { stdout: "origin/feat/x\n" },
};

describe("gitPush", () => {
  test("pushes HEAD to the upstream by explicit refspec, force only as --force-with-lease", async () => {
    const calls: string[] = [];
    const r = await gitPush("/t", { forceWithLease: true }, fakeGit({ ...onFeature, "push --force-with-lease origin HEAD:refs/heads/feat/x": {} }, calls));
    expect(r.ok).toBe(true);
    expect(calls.at(-1)).toBe("push --force-with-lease origin HEAD:refs/heads/feat/x");
  });
  test("an upstream with a different branch name is pushed to THAT name, never to origin/<local>", async () => {
    const calls: string[] = [];
    const script = { ...onFeature, "rev-parse --abbrev-ref --symbolic-full-name @{u}": { stdout: "origin/feat/renamed\n" }, "push origin HEAD:refs/heads/feat/renamed": {} };
    const r = await gitPush("/t", {}, fakeGit(script, calls));
    expect(r.ok).toBe(true);
    expect(calls.at(-1)).toBe("push origin HEAD:refs/heads/feat/renamed");
    expect((r.body as { upstream: string }).upstream).toBe("origin/feat/renamed");
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
      "symbolic-ref --quiet --short HEAD": { stdout: "develop\n" },
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
      "symbolic-ref --quiet --short HEAD": { stdout: "feat/x\n" },
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
      "symbolic-ref --quiet --short HEAD": { stdout: "feat/x\n" },
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
  test("refuses a detached HEAD", async () => {
    const calls: string[] = [];
    const r = await gitPush("/t", {}, fakeGit({ "symbolic-ref --quiet --short HEAD": { code: 1 } }, calls));
    expect(r.ok).toBe(false);
    expect(r.error).toContain("detached");
    expect(calls.some((c) => c.startsWith("push"))).toBe(false);
  });
  test("refuses main, master and the remote default branch", async () => {
    for (const branch of ["main", "master", "develop"]) {
      const calls: string[] = [];
      const r = await gitPush("/t", { forceWithLease: true }, fakeGit({ ...onFeature, "symbolic-ref --quiet --short HEAD": { stdout: `${branch}\n` } }, calls));
      expect(r.ok, branch).toBe(false);
      expect(calls.some((c) => c.startsWith("push")), branch).toBe(false);
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
    const r = await gitRebase("/t", { onto: "origin/develop" }, fakeGit({ "fetch origin": {}, "rebase origin/develop": {} }, calls));
    expect(r).toEqual({ ok: true, body: { status: "ok", onto: "origin/develop", fetched: "origin" } });
    expect(calls).toEqual(["remote", "fetch origin", "rebase origin/develop"]);
  });
  test("a local ref is not fetched", async () => {
    const calls: string[] = [];
    const r = await gitRebase("/t", { onto: "develop" }, fakeGit({ "rebase develop": {} }, calls));
    expect(r).toEqual({ ok: true, body: { status: "ok", onto: "develop", fetched: null } });
    expect(calls).toEqual(["rebase develop"]);
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
    const r = await gitRebase("/t", { onto: "origin/develop" }, fakeGit({ "fetch origin": {}, "rebase origin/develop": { code: 1, stderr: "CONFLICT" }, "diff --name-only --diff-filter=U": { stdout: "a.ts\nb.ts\n" } }, calls));
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
    for (const [name, input] of [["git_push", {}], ["git_pull", {}], ["git_rebase", { onto: "x" }]] as const) {
      const tool = gitToolDefs({ git: fakeGit({}, calls), guard, sync: async () => ({ code: 0, stdout: "{}", stderr: "" }) }).find((t) => t.name === name)!;
      const r = await tool.handler({ tree: "/elsewhere", ...input }, {} as NodeJS.ProcessEnv);
      expect(r.ok, name).toBe(false);
      expect(r.error, name).toContain("registered");
    }
    expect(calls).toEqual([]);
  });
});

describe("branchSyncPreflight", () => {
  const base: Script = {
    "symbolic-ref --quiet --short HEAD": { stdout: "feat/x\n" },
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
  test("diverged with every local commit patch-equivalent on origin passes (the GitLab-rebased case)", async () => {
    const r = await branchSyncPreflight("/t", fakeGit({ ...base, "rev-list --left-right --count origin/feat/x...HEAD": { stdout: "3\t2\n" }, "rev-list --cherry-pick --right-only --no-merges origin/feat/x...HEAD ^origin/develop": {} }));
    expect(r).toEqual({ ok: true, diverged: true });
  });
  test("diverged with an unpushed local commit refuses and names it", async () => {
    const r = await branchSyncPreflight("/t", fakeGit({ ...base, "rev-list --left-right --count origin/feat/x...HEAD": { stdout: "3\t2\n" }, "rev-list --cherry-pick --right-only --no-merges origin/feat/x...HEAD ^origin/develop": { stdout: "0123456\n" } }));
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toContain("0123456");
  });
  test("a local rebase onto a newer default does not read the rebase-carried commits as unpushed work", async () => {
    const r = await branchSyncPreflight("/t", fakeGit({ ...base, "rev-list --left-right --count origin/feat/x...HEAD": { stdout: "2\t4\n" }, "rev-list --cherry-pick --right-only --no-merges origin/feat/x...HEAD ^origin/develop": {} }));
    expect(r).toEqual({ ok: true, diverged: true });
  });
  test("no remote branch yet passes; a detached HEAD refuses", async () => {
    expect(await branchSyncPreflight("/t", fakeGit({ ...base, "rev-parse --verify --quiet origin/feat/x": { code: 1 } }))).toEqual({ ok: true, diverged: false });
    expect((await branchSyncPreflight("/t", fakeGit({ "symbolic-ref --quiet --short HEAD": { code: 1 } }))).ok).toBe(false);
  });
  test("main, master and the remote default branch refuse before any fetch (rt sync would force-push them)", async () => {
    for (const branch of ["main", "master", "develop"]) {
      const calls: string[] = [];
      const r = await branchSyncPreflight("/t", fakeGit({ ...base, "symbolic-ref --quiet --short HEAD": { stdout: `${branch}\n` }, "symbolic-ref --quiet --short refs/remotes/origin/HEAD": { stdout: "origin/develop\n" } }, calls));
      expect(r.ok, branch).toBe(false);
      expect(calls, branch).not.toContain("fetch origin");
    }
  });

  describe("branch names rt sync cannot pass safely", () => {
    test("a branch with shell metacharacters or whitespace refuses before any config read or fetch", async () => {
      for (const branch of ["x$(touch${IFS}PWNED)", "a;id|sh", "a b"]) {
        const calls: string[] = [];
        const r = await branchSyncPreflight("/t", fakeGit({ ...base, "symbolic-ref --quiet --short HEAD": { stdout: `${branch}\n` } }, calls));
        expect(r.ok, branch).toBe(false);
        expect((r as { error: string }).error, branch).toContain("cannot pass safely");
        expect(calls.filter((c) => c.startsWith("config") || c.startsWith("fetch")), branch).toEqual([]);
      }
    });
    test("a branch of letters, digits, dots, slashes, dashes and underscores passes", async () => {
      const r = await branchSyncPreflight("/t", fakeGit({ ...base, "symbolic-ref --quiet --short HEAD": { stdout: "feat/x-1.2_y\n" }, "rev-parse --verify --quiet origin/feat/x-1.2_y": { code: 1 } }));
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
    "symbolic-ref --quiet --short HEAD": { stdout: "feat/x\n" }, "symbolic-ref --quiet --short refs/remotes/origin/HEAD": { stdout: "origin/develop\n" },
    "config --get-all remote.origin.push": { code: 1 }, "config --get push.default": { code: 1 },
    "fetch origin": {}, "rev-parse --verify --quiet origin/feat/x": {},
    "rev-list --left-right --count origin/feat/x...HEAD": { stdout: "0\t1\n" },
  };
  test("exit 0 is synced, exit 3 is a conflict bundle, exit 4 is a refusal", async () => {
    for (const [code, stdout, expectOk, status] of [[0, '{"pushed":true}', true, "synced"], [3, '{"conflicts":["a.ts"]}', true, "conflict"], [4, '{"error":"stack member"}', false, ""]] as const) {
      const tool = gitToolDefs({ git: fakeGit(clean), guard, sync: async () => ({ code, stdout, stderr: "" }) }).find((t) => t.name === "branch_sync")!;
      const r = await tool.handler({ tree: "/t" }, {} as NodeJS.ProcessEnv);
      expect(r.ok, String(code)).toBe(expectOk);
      if (expectOk) expect((r.body as { status: string }).status).toBe(status);
    }
  });
  test("a failed preflight never runs rt sync", async () => {
    let ran = false;
    const tool = gitToolDefs({ git: fakeGit({ ...clean, "rev-list --left-right --count origin/feat/x...HEAD": { stdout: "1\t1\n" }, "rev-list --cherry-pick --right-only --no-merges origin/feat/x...HEAD ^origin/develop": { stdout: "9999\n" } }), guard, sync: async () => { ran = true; return { code: 0, stdout: "{}", stderr: "" }; } }).find((t) => t.name === "branch_sync")!;
    const r = await tool.handler({ tree: "/t" }, {} as NodeJS.ProcessEnv);
    expect(r.ok).toBe(false);
    expect(ran).toBe(false);
  });
  test("a branch name carrying shell never reaches rt sync", async () => {
    let ran = false;
    const calls: string[] = [];
    const tool = gitToolDefs({ git: fakeGit({ ...clean, "symbolic-ref --quiet --short HEAD": { stdout: "x$(touch${IFS}PWNED)\n" } }, calls), guard, sync: async () => { ran = true; return { code: 0, stdout: "", stderr: "" }; } }).find((t) => t.name === "branch_sync")!;
    const r = await tool.handler({ tree: "/t" }, {} as NodeJS.ProcessEnv);
    expect(r.ok).toBe(false);
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
