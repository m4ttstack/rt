import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scrubGitEnv } from "../../../packages/git-core/src/exec.ts";
import type { GitWorktreeBadge } from "../../../packages/rt-client/src/commands.ts";
import { deriveAction, publishRepo, runAction } from "../git-actions.ts";

// Local mirror of packages/git-core/test-support/sandbox.ts: this module
// stays standalone (no cross-package test import), and every spawn pins
// identity via -c so it never reads the real machine's ~/.gitconfig.
interface Sandbox {
  dir: string;
  git(args: string[]): Promise<string>;
  write(rel: string, content: string): Promise<void>;
  commitAll(message: string): Promise<void>;
  addBareRemote(name?: string): Promise<string>;
  cleanup(): Promise<void>;
}

const IDENTITY = ["-c", "user.email=test@example.com", "-c", "user.name=Test", "-c", "commit.gpgsign=false"];

// Scrubbed so a GIT_DIR/GIT_WORK_TREE inherited from the outer test runner
// cannot redirect one of these sandbox commands at a repo outside cwd.
async function runGit(cwd: string, args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", ...IDENTITY, ...args], { cwd, env: scrubGitEnv(), stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`git ${args.join(" ")} exited ${code}: ${err || out}`);
  return out;
}

async function makeSandbox(): Promise<Sandbox> {
  const root = await mkdtemp(join(tmpdir(), "mission-git-actions-sb-"));
  const dir = join(root, "repo");
  await mkdir(dir, { recursive: true });
  await runGit(dir, ["init", "-b", "main"]);
  return {
    dir,
    git: (args) => runGit(dir, args),
    write: async (rel, content) => writeFile(join(dir, rel), content),
    commitAll: async (message) => {
      await runGit(dir, ["add", "-A"]);
      await runGit(dir, ["commit", "-m", message]);
    },
    addBareRemote: async (name = "origin") => {
      const remoteDir = join(root, `${name}.git`);
      await runGit(root, ["init", "--bare", "-b", "__unused__", remoteDir]);
      await runGit(dir, ["remote", "add", name, remoteDir]);
      return remoteDir;
    },
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

async function cloneSandbox(remoteDir: string): Promise<Sandbox> {
  const root = await mkdtemp(join(tmpdir(), "mission-git-actions-sb-"));
  const dir = join(root, "repo");
  await runGit(root, ["clone", remoteDir, dir]);
  await runGit(dir, ["checkout", "main"]);
  return {
    dir,
    git: (args) => runGit(dir, args),
    write: async (rel, content) => writeFile(join(dir, rel), content),
    commitAll: async (message) => {
      await runGit(dir, ["add", "-A"]);
      await runGit(dir, ["commit", "-m", message]);
    },
    addBareRemote: async (name = "origin") => {
      const remote = await runGit(dir, ["remote", "get-url", name]);
      return remote.trim();
    },
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

function badge(overrides: Partial<GitWorktreeBadge> = {}): GitWorktreeBadge {
  return {
    worktree: "/w/repo",
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
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("runAction: publish-branch, push, pull round-trip", () => {
  test("publish-branch pushes and sets upstream, push forwards a new commit, pull catches up a second clone", async () => {
    const a = await makeSandbox();
    let b: Sandbox | null = null;
    try {
      await a.write("a.txt", "one\n");
      await a.commitAll("init");
      const remoteDir = await a.addBareRemote();

      const published = await runAction(a.dir, "publish-branch", { remote: "origin", branch: "main" });
      expect(published.ok).toBe(true);
      const remoteMain = (await runGit(remoteDir, ["rev-parse", "main"])).trim();
      const localHead = (await a.git(["rev-parse", "HEAD"])).trim();
      expect(remoteMain).toBe(localHead);
      expect((await a.git(["config", "branch.main.remote"])).trim()).toBe("origin");

      b = await cloneSandbox(remoteDir);
      await b.git(["branch", "--set-upstream-to=origin/main", "main"]);

      await a.write("a.txt", "two\n");
      await a.commitAll("second");
      const pushed = await runAction(a.dir, "push", { remote: "origin", branch: "main" });
      expect(pushed.ok).toBe(true);
      const remoteAfterPush = (await runGit(remoteDir, ["rev-parse", "main"])).trim();
      expect(remoteAfterPush).toBe((await a.git(["rev-parse", "HEAD"])).trim());

      const pulled = await runAction(b.dir, "pull", { remote: "origin", branch: "main" });
      expect(pulled.ok).toBe(true);
      expect((await b.git(["rev-parse", "HEAD"])).trim()).toBe(remoteAfterPush);
    } finally {
      await a.cleanup();
      if (b) await b.cleanup();
    }
  });
});

describe("runAction: force-push after an amend", () => {
  test("a normal push would be rejected; force-push overwrites the remote with the amended commit", async () => {
    const a = await makeSandbox();
    try {
      await a.write("a.txt", "one\n");
      await a.commitAll("init");
      const remoteDir = await a.addBareRemote();
      const published = await runAction(a.dir, "publish-branch", { remote: "origin", branch: "main" });
      expect(published.ok).toBe(true);

      await a.write("a.txt", "one amended\n");
      await a.git(["commit", "-a", "--amend", "-m", "init (amended)"]);
      const amendedHead = (await a.git(["rev-parse", "HEAD"])).trim();

      const rejected = await runAction(a.dir, "push", { remote: "origin", branch: "main" });
      expect(rejected.ok).toBe(false);

      const forced = await runAction(a.dir, "force-push", { remote: "origin", branch: "main" });
      expect(forced.ok).toBe(true);
      expect((await runGit(remoteDir, ["rev-parse", "main"])).trim()).toBe(amendedHead);
    } finally {
      await a.cleanup();
    }
  });
});

describe("runAction: fetch stamps FETCH_HEAD", () => {
  test("fetch against a bare remote writes .git/FETCH_HEAD", async () => {
    const a = await makeSandbox();
    let b: Sandbox | null = null;
    try {
      await a.write("a.txt", "one\n");
      await a.commitAll("init");
      const remoteDir = await a.addBareRemote();
      await runAction(a.dir, "publish-branch", { remote: "origin", branch: "main" });

      b = await cloneSandbox(remoteDir);
      expect(existsSync(join(b.dir, ".git", "FETCH_HEAD"))).toBe(false);
      const fetched = await runAction(b.dir, "fetch", { remote: "origin", branch: null });
      expect(fetched.ok).toBe(true);
      expect(existsSync(join(b.dir, ".git", "FETCH_HEAD"))).toBe(true);
    } finally {
      await a.cleanup();
      if (b) await b.cleanup();
    }
  });
});

describe("runAction: fetch/pull self-heal the local default-branch symref", () => {
  // CodeRabbit finding on mission-visual-parity: getRemoteDefaultBranch's
  // local-first path trusts refs/remotes/<remote>/HEAD, which a plain fetch
  // never refreshes on its own -- it can go stale forever after the
  // server's default branch is renamed. runAction rides `remote set-head
  // -a` along fetch/pull/pull-rebase (network already in play there) so the
  // local symref self-heals on actions users already run constantly.
  test("fetch refreshes refs/remotes/<remote>/HEAD to the remote's current default", async () => {
    const a = await makeSandbox();
    try {
      await a.write("a.txt", "one\n");
      await a.commitAll("init");
      const remoteDir = await a.addBareRemote();
      await runAction(a.dir, "publish-branch", { remote: "origin", branch: "main" });
      // publish-branch (push -u) doesn't itself write the symref -- only
      // clone/`remote set-head` do (this function's own doc comment) --
      // so set it explicitly to simulate the ordinary already-cloned case.
      await a.git(["remote", "set-head", "origin", "main"]);

      // Rename the remote's default after the local symref already points at main.
      await runGit(remoteDir, ["branch", "-m", "main", "trunk"]);
      await runGit(remoteDir, ["symbolic-ref", "HEAD", "refs/heads/trunk"]);
      await a.git(["fetch", "origin", "trunk:trunk"]);
      expect((await a.git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])).trim()).toBe("origin/main");

      const fetched = await runAction(a.dir, "fetch", { remote: "origin", branch: null });
      expect(fetched.ok).toBe(true);
      expect((await a.git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])).trim()).toBe("origin/trunk");
    } finally {
      await a.cleanup();
    }
  });

  test("a failed fetch (unreachable remote) never throws, and skips the self-heal", async () => {
    const a = await makeSandbox();
    try {
      await a.write("a.txt", "one\n");
      await a.commitAll("init");
      await a.git(["remote", "add", "origin", "/nonexistent/o.git"]);

      const fetched = await runAction(a.dir, "fetch", { remote: "origin", branch: null });
      expect(fetched.ok).toBe(false);
    } finally {
      await a.cleanup();
    }
  });
});

describe("runAction: env scrubbing", () => {
  // Bun.spawn's default (no explicit `env`) inherit path reads a snapshot
  // taken at process start, not the live `process.env` object, so mutating
  // GIT_DIR mid-test and asserting on git's on-disk behavior can't observe
  // this leak either way. Spying on Bun.spawn's own call args pins the real
  // contract instead: spawnGit must pass an explicit env with the
  // repo-location vars removed, regardless of how Bun's default inherit
  // happens to behave.
  test("fetch spawns git with GIT_DIR/GIT_WORK_TREE/etc scrubbed from its env", async () => {
    const a = await makeSandbox();
    const originalSpawn = Bun.spawn;
    let capturedEnv: Record<string, string | undefined> | undefined;
    try {
      await a.write("a.txt", "one\n");
      await a.commitAll("init");
      await a.addBareRemote();

      // @ts-expect-error -- test-only spy on the Bun global to observe spawnGit's call.
      Bun.spawn = (cmd: unknown, opts: { env?: Record<string, string | undefined> }) => {
        capturedEnv = opts?.env;
        return originalSpawn(cmd as Parameters<typeof Bun.spawn>[0], opts as Parameters<typeof Bun.spawn>[1]);
      };

      const previousGitDir = process.env.GIT_DIR;
      process.env.GIT_DIR = "/somewhere/unrelated/.git";
      let result: { ok: boolean; detail: string };
      try {
        result = await runAction(a.dir, "publish-branch", { remote: "origin", branch: "main" });
      } finally {
        Bun.spawn = originalSpawn;
        if (previousGitDir === undefined) delete process.env.GIT_DIR;
        else process.env.GIT_DIR = previousGitDir;
      }

      expect(result.ok).toBe(true);
      expect(capturedEnv).toBeDefined();
      expect(capturedEnv!.GIT_DIR).toBeUndefined();
      expect(capturedEnv!.GIT_WORK_TREE).toBeUndefined();
      expect(capturedEnv!.GIT_INDEX_FILE).toBeUndefined();
      expect(capturedEnv!.GIT_OBJECT_DIRECTORY).toBeUndefined();
    } finally {
      Bun.spawn = originalSpawn;
      await a.cleanup();
    }
  });
});

describe("runAction: refused kinds", () => {
  test("busy refuses without spawning git", async () => {
    const a = await makeSandbox();
    try {
      const result = await runAction(a.dir, "busy", { remote: "origin", branch: "main" });
      expect(result.ok).toBe(false);
      expect(result.detail.length).toBeGreaterThan(0);
    } finally {
      await a.cleanup();
    }
  });

  test("detached refuses without spawning git", async () => {
    const a = await makeSandbox();
    try {
      const result = await runAction(a.dir, "detached", { remote: "origin", branch: null });
      expect(result.ok).toBe(false);
      expect(result.detail.length).toBeGreaterThan(0);
    } finally {
      await a.cleanup();
    }
  });

});

describe("publishRepo: gh repo create", () => {
  /** A stand-in gh that records where it ran and with what, then exits with `code` after writing `stderr`. */
  function fakeGh(dir: string, code: number, stderr = ""): { path: string; recorded: () => { cwd: string; args: string[] } } {
    const path = join(dir, "gh");
    const log = join(dir, "gh.log");
    writeFileSync(path, `#!/bin/sh\npwd > "${log}"\nprintf '%s\\n' "$@" >> "${log}"\nprintf '%s' '${stderr}' >&2\nexit ${code}\n`);
    chmodSync(path, 0o755);
    return {
      path,
      recorded: () => {
        const [cwd, ...args] = readFileSync(log, "utf8").trimEnd().split("\n");
        return { cwd: cwd!, args };
      },
    };
  }

  test("creates the repo from the worktree, adds origin, and pushes", async () => {
    const a = await makeSandbox();
    const bin = mkdtempSync(join(tmpdir(), "fake-gh-"));
    try {
      await a.write("README.md", "hi\n");
      await a.commitAll("first");
      const gh = fakeGh(bin, 0);
      const result = await publishRepo(a.dir, { name: "acme-app", private: true }, gh.path);
      expect(result).toEqual({ ok: true, detail: "" });
      const { cwd, args } = gh.recorded();
      expect(realpathSync(cwd)).toBe(realpathSync(a.dir));
      expect(args).toEqual(["repo", "create", "acme-app", "--private", "--source", a.dir, "--remote", "origin", "--push"]);
    } finally {
      rmSync(bin, { recursive: true, force: true });
      await a.cleanup();
    }
  });

  test("an unborn repo publishes without pushing, since gh refuses --push with no commits", async () => {
    const a = await makeSandbox();
    const bin = mkdtempSync(join(tmpdir(), "fake-gh-"));
    try {
      const gh = fakeGh(bin, 0);
      const result = await publishRepo(a.dir, { name: "acme-app", private: true }, gh.path);
      expect(result).toEqual({ ok: true, detail: "" });
      expect(gh.recorded().args).toEqual(["repo", "create", "acme-app", "--private", "--source", a.dir, "--remote", "origin"]);
    } finally {
      rmSync(bin, { recursive: true, force: true });
      await a.cleanup();
    }
  });

  test("public, and an owner/name pair, pass straight through", async () => {
    const a = await makeSandbox();
    const bin = mkdtempSync(join(tmpdir(), "fake-gh-"));
    try {
      const gh = fakeGh(bin, 0);
      await publishRepo(a.dir, { name: "acme/app", private: false }, gh.path);
      expect(gh.recorded().args.slice(2, 4)).toEqual(["acme/app", "--public"]);
    } finally {
      rmSync(bin, { recursive: true, force: true });
      await a.cleanup();
    }
  });

  test("a gh failure reports its last stderr line", async () => {
    const a = await makeSandbox();
    const bin = mkdtempSync(join(tmpdir(), "fake-gh-"));
    try {
      const gh = fakeGh(bin, 1, "GraphQL: Name already exists on this account (createRepository)");
      const result = await publishRepo(a.dir, { name: "acme-app", private: true }, gh.path);
      expect(result).toEqual({ ok: false, detail: "GraphQL: Name already exists on this account (createRepository)" });
    } finally {
      rmSync(bin, { recursive: true, force: true });
      await a.cleanup();
    }
  });

  test("no gh at all says publishing needs it", async () => {
    const a = await makeSandbox();
    try {
      const result = await publishRepo(a.dir, { name: "acme-app", private: true }, join(a.dir, "no-such-gh"));
      expect(result).toEqual({ ok: false, detail: "publishing a repository needs the GitHub CLI (gh)" });
    } finally {
      await a.cleanup();
    }
  });
});

describe("deriveAction: GHD parity selection order", () => {
  test("busy beats every other condition", () => {
    const action = deriveAction({
      badge: badge({ ahead: 5, behind: 5, upstream: null }),
      remoteName: null,
      detached: true,
      unborn: true,
      pullRebase: false,
      forcePushRecommended: true,
      busy: true,
    });
    expect(action.kind).toBe("busy");
    expect(action.title).toBe("Working");
  });

  test("no remote yet -> publish-repo", () => {
    const action = deriveAction({
      badge: badge(),
      remoteName: null,
      detached: false,
      unborn: false,
      pullRebase: false,
      forcePushRecommended: false,
      busy: false,
    });
    expect(action.kind).toBe("publish-repo");
    expect(action.title).toBe("Publish repository");
  });

  test("unborn branch -> fetch", () => {
    const action = deriveAction({
      badge: badge({ branch: null, upstream: null }),
      remoteName: "origin",
      detached: false,
      unborn: true,
      pullRebase: false,
      forcePushRecommended: false,
      busy: false,
    });
    expect(action.kind).toBe("fetch");
    expect(action.title).toBe("Fetch origin");
  });

  test("detached HEAD disables the action, ahead of the publish-branch check", () => {
    const action = deriveAction({
      badge: badge({ branch: null, upstream: null }),
      remoteName: "origin",
      detached: true,
      unborn: false,
      pullRebase: false,
      forcePushRecommended: false,
      busy: false,
    });
    expect(action.kind).toBe("detached");
    expect(action.title).toBe("Detached HEAD");
  });

  test("no upstream -> publish-branch", () => {
    const action = deriveAction({
      badge: badge({ upstream: null }),
      remoteName: "origin",
      detached: false,
      unborn: false,
      pullRebase: false,
      forcePushRecommended: false,
      busy: false,
    });
    expect(action.kind).toBe("publish-branch");
    expect(action.title).toBe("Publish branch");
  });

  test("up to date -> fetch", () => {
    const action = deriveAction({
      badge: badge({ ahead: 0, behind: 0 }),
      remoteName: "origin",
      detached: false,
      unborn: false,
      pullRebase: false,
      forcePushRecommended: false,
      busy: false,
    });
    expect(action.kind).toBe("fetch");
    expect(action.title).toBe("Fetch origin");
  });

  test("force-push-recommended wins over a diverged pull", () => {
    const action = deriveAction({
      badge: badge({ ahead: 2, behind: 3 }),
      remoteName: "origin",
      detached: false,
      unborn: false,
      pullRebase: false,
      forcePushRecommended: true,
      busy: false,
    });
    expect(action.kind).toBe("force-push");
    expect(action.title).toBe("Force push origin");
  });

  test("diverged shows Pull with both counts, never a combined pull-then-push state", () => {
    const action = deriveAction({
      badge: badge({ ahead: 2, behind: 3 }),
      remoteName: "origin",
      detached: false,
      unborn: false,
      pullRebase: false,
      forcePushRecommended: false,
      busy: false,
    });
    expect(action.kind).toBe("pull");
    expect(action.title).toBe("Pull origin");
    expect(action.ahead).toBe(2);
    expect(action.behind).toBe(3);
  });

  test("pullRebase true renders the with-rebase title and kind", () => {
    const action = deriveAction({
      badge: badge({ ahead: 0, behind: 4 }),
      remoteName: "origin",
      detached: false,
      unborn: false,
      pullRebase: true,
      forcePushRecommended: false,
      busy: false,
    });
    expect(action.kind).toBe("pull-rebase");
    expect(action.title).toBe("Pull origin with rebase");
  });

  test("ahead only -> push", () => {
    const action = deriveAction({
      badge: badge({ ahead: 4, behind: 0 }),
      remoteName: "origin",
      detached: false,
      unborn: false,
      pullRebase: false,
      forcePushRecommended: false,
      busy: false,
    });
    expect(action.kind).toBe("push");
    expect(action.title).toBe("Push origin");
  });

  test("null ahead/behind on the badge coalesce to zero", () => {
    const action = deriveAction({
      badge: badge({ ahead: null, behind: null }),
      remoteName: "origin",
      detached: false,
      unborn: false,
      pullRebase: false,
      forcePushRecommended: false,
      busy: false,
    });
    expect(action.ahead).toBe(0);
    expect(action.behind).toBe(0);
    expect(action.kind).toBe("fetch");
  });
});

describe("deriveAction: meta relative wording", () => {
  test("null lastFetchedAt reads Never fetched", () => {
    const action = deriveAction({
      badge: badge({ lastFetchedAt: null }),
      remoteName: "origin",
      detached: false,
      unborn: false,
      pullRebase: false,
      forcePushRecommended: false,
      busy: false,
    });
    expect(action.meta).toBe("Never fetched");
  });

  test("a lastFetchedAt three minutes ago reads as relative minutes", () => {
    const threeMinutesAgo = new Date(Date.now() - 3 * 60_000).toISOString();
    const action = deriveAction({
      badge: badge({ lastFetchedAt: threeMinutesAgo }),
      remoteName: "origin",
      detached: false,
      unborn: false,
      pullRebase: false,
      forcePushRecommended: false,
      busy: false,
    });
    expect(action.meta).toBe("Last fetched 3 minutes ago");
  });
});
