/**
 * Compose-level test: a real MissionDriver over real git-core against a
 * sandbox repo, fed the intent sequence a live Go view emits (select a
 * file, deselect one line, toggle-file another, commit with a summary,
 * undo), asserting on the actual git index and history after each step
 * rather than on emitted models alone. This is the seam none of the unit
 * suites on either side of the wire cover.
 *
 * rt adopts GitHub Desktop's own staging model (ratified 2026-09-21):
 * mission:stage only ever mutates the driver's own commit-intent
 * selection now, never the real git index (every file defaults to fully
 * checked the moment it appears) -- so the index stays untouched all the
 * way through selecting/deselecting/toggling, and only the commit step
 * rebuilds it (reset to HEAD, then re-stage exactly what's checked) and
 * proves the round trip: a file with a partial selection commits exactly
 * its checked lines and leaves the rest in the working tree; a file
 * toggled off entirely is excluded from the commit and stays untouched.
 */
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGitClient } from "../../../packages/git-core/src/index.ts";
import type { BranchGuardVerdict } from "../../branch-guard.ts";
import type { DaemonSubscription } from "../../daemon-client.ts";
import { amendStaged, commitStaged } from "../../commit-ops.ts";
import { getPullRebase, getRemoteDefaultBranch } from "../../git-ops.ts";
import { listWorktreesAsync } from "../../worktree/git-async.ts";
import type { SessionIntent } from "../../ui/protocol.ts";
import type { SessionEnd, SessionHandle } from "../../ui/spawn.ts";
import { MissionDriver, type MissionDeps } from "../driver.ts";
import type { MissionModel } from "../model.ts";

const IDENTITY = ["-c", "user.email=test@example.com", "-c", "user.name=Test", "-c", "commit.gpgsign=false"];

async function runGit(cwd: string, args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", ...IDENTITY, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`git ${args.join(" ")} exited ${code}: ${err || out}`);
  return out;
}

interface Sandbox {
  dir: string;
  git(args: string[]): Promise<string>;
  write(rel: string, content: string): Promise<void>;
  cleanup(): Promise<void>;
}

// Mirrors lib/mission/__tests__/git-actions.test.ts's sandbox: mkdtemp plus
// a bare remote, with identity pinned in repo-local config as well because
// the driver's own commit dep spawns git without the -c identity flags.
async function makeSandbox(): Promise<Sandbox> {
  const root = await mkdtemp(join(tmpdir(), "mission-compose-sb-"));
  const dir = join(root, "repo");
  await mkdir(dir, { recursive: true });
  await runGit(dir, ["init", "-b", "main"]);
  await runGit(dir, ["config", "user.email", "test@example.com"]);
  await runGit(dir, ["config", "user.name", "Test"]);
  await runGit(dir, ["config", "commit.gpgsign", "false"]);
  const remoteDir = join(root, "origin.git");
  await runGit(root, ["init", "--bare", "-b", "__unused__", remoteDir]);
  await runGit(dir, ["remote", "add", "origin", remoteDir]);
  return {
    dir,
    git: (args) => runGit(dir, args),
    write: async (rel, content) => writeFile(join(dir, rel), content),
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

/** A scripted stand-in for the Go view: intents go in via step(), models come back via push(). */
class LiveSession implements SessionHandle {
  pushed: MissionModel[] = [];
  exited: Promise<number>;
  private finish!: (code: number) => void;
  private queue: SessionIntent[] = [];
  private intentWaiter: ((r: IteratorResult<SessionIntent>) => void) | null = null;
  private pushWaiters: Array<() => void> = [];

  constructor() {
    this.exited = new Promise((r) => {
      this.finish = r;
    });
  }

  get intents(): AsyncIterable<SessionIntent> {
    const self = this;
    return {
      [Symbol.asyncIterator]() {
        return { next: () => self.next() };
      },
    };
  }

  private next(): Promise<IteratorResult<SessionIntent>> {
    const it = this.queue.shift();
    if (it) return Promise.resolve({ value: it, done: false });
    return new Promise((resolve) => {
      this.intentWaiter = resolve;
    });
  }

  send(intent: SessionIntent): void {
    const w = this.intentWaiter;
    if (w) {
      this.intentWaiter = null;
      w({ value: intent, done: false });
    } else {
      this.queue.push(intent);
    }
  }

  push(m: unknown): void {
    this.pushed.push(m as MissionModel);
    const waiters = this.pushWaiters;
    this.pushWaiters = [];
    for (const w of waiters) w();
  }

  /** Sends intent, then resolves with the next pushed model (5s timeout so a dead handler fails the test rather than hanging it). */
  async step(intent: SessionIntent): Promise<MissionModel> {
    const before = this.pushed.length;
    this.send(intent);
    const deadline = Date.now() + 5_000;
    while (this.pushed.length === before) {
      if (Date.now() > deadline) throw new Error(`no model push after ${intent.name}`);
      await new Promise<void>((resolve) => {
        this.pushWaiters.push(resolve);
        setTimeout(resolve, 50);
      });
    }
    return this.pushed.at(-1)!;
  }

  async close(): Promise<SessionEnd> {
    this.finish(0);
    return { reason: "closed", code: 0 };
  }
}

function realDeps(sandbox: Sandbox, session: LiveSession, opened: (model: MissionModel) => void): MissionDeps {
  return {
    openSession: async (_view, model) => {
      opened(model as MissionModel);
      return session;
    },
    client: (dir: string) => createGitClient(dir),
    daemonQuery: (async (cmd: string) =>
      cmd === "worktree:list"
        ? { ok: true, data: { trees: [{ path: sandbox.dir, name: "sb", branch: "main", state: "claimed" }] } }
        : { ok: true, data: { repos: [{ repo: "sandbox", error: null, worktrees: [] }] } }) as MissionDeps["daemonQuery"],
    subscribe: (): DaemonSubscription => ({ close: () => {} }),
    runAction: async () => ({ ok: true, detail: "" }),
    commit: commitStaged,
    amend: amendStaged,
    guard: async () => ({ verdict: "clear" }) as BranchGuardVerdict,
    now: () => new Date(),
    resolveDefaultBranch: getRemoteDefaultBranch,
    readPullRebase: getPullRebase,
    buildGuards: async () => new Map(),
    listGitWorktrees: listWorktreesAsync,
    fileActions: { copy: () => {}, reveal: () => {}, open: () => {} },
    resolveEditor: () => null,
    launchEditor: async () => false,
    pathExists: existsSync,
  };
}

describe("mission compose: driver + git-core against a real repo", () => {
  test("select, line-stage, toggle-file, commit, undo land in the actual git state", async () => {
    const sandbox = await makeSandbox();
    try {
      await sandbox.write("a.txt", "alpha\nbeta\n");
      await sandbox.git(["add", "-A"]);
      await sandbox.git(["commit", "-m", "init"]);
      await sandbox.write("a.txt", "alpha\nbeta\ngamma\ndelta\n");
      await sandbox.write("b.txt", "new file\n");

      const session = new LiveSession();
      const openedModels: MissionModel[] = [];
      const deps = realDeps(sandbox, session, (model) => {
        openedModels.push(model);
      });
      const driver = new MissionDriver(deps, { repo: "sandbox", worktree: sandbox.dir });
      const runPromise = driver.run();

      const deadline = Date.now() + 5_000;
      while (openedModels.length === 0) {
        if (Date.now() > deadline) throw new Error("driver never opened the session");
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      // The seed already points the diff pane at the first change.
      const seed = openedModels[0]!;
      expect(seed.diff.path).toBe("a.txt");
      expect(seed.diff.kind).toBe("text");

      // 1. Select the modified file: the diff pane shows its FULL change
      // vs HEAD (GHD's own model: staged or not never affects what's
      // shown), and every selectable line defaults to CHECKED -- GHD's own
      // default, not "nothing selected."
      const selected = await session.step({ t: "intent", name: "mission:select", payload: { path: "a.txt" } });
      expect(selected.diff.path).toBe("a.txt");
      const addLines = selected.diff.lines.filter((line) => line.kind === "add");
      expect(addLines.map((line) => line.text)).toEqual(["gamma", "delta"]);
      expect(addLines.every((line) => line.selected)).toBe(true);
      // Still nothing in the real index: mission:stage is a pure selection
      // mutation now, never a git call.
      expect((await sandbox.git(["diff", "--cached"])).trim()).toBe("");

      // 2. Deselect "delta" (compacted selIdx 1): a pure selection flip,
      // still no git effect at all.
      const lineDeselected = await session.step({ t: "intent", name: "mission:stage", payload: { path: "a.txt", mode: "line", selIdx: 1 } });
      expect((await sandbox.git(["diff", "--cached"])).trim()).toBe("");
      expect(lineDeselected.notice).toBe("");
      expect(lineDeselected.changes.find((change) => change.path === "a.txt")?.include).toBe("partial");

      // 3. Toggle-file the untracked file OFF: it defaulted to fully
      // checked (GHD's own default for a freshly-appeared file), so one
      // toggle-file press unchecks it entirely -- still no git effect.
      const toggled = await session.step({ t: "intent", name: "mission:stage", payload: { path: "b.txt", mode: "toggle-file" } });
      expect((await sandbox.git(["status", "--porcelain", "--", "b.txt"])).trim()).toBe("?? b.txt"); // untouched
      expect(toggled.notice).toBe("");
      expect(toggled.changes.find((change) => change.path === "b.txt")?.include).toBe("none");

      // 4. An all-whitespace summary refuses and commits nothing.
      const refused = await session.step({ t: "intent", name: "mission:commit", payload: { summary: "   " } });
      expect(refused.notice).toBe("a summary is required to commit");
      expect((await sandbox.git(["log", "-n", "1", "--format=%s"])).trim()).toBe("init");

      // 5. THE ROUND TRIP: commit rebuilds the index from the current
      // selections (GHD's own reset-then-rebuild sequencing) and takes
      // exactly what's checked -- gamma (a.txt is Partial: delta stayed
      // deselected), never b.txt (None, toggled off in step 3) -- leaving
      // both delta and the whole of b.txt behind in the working tree.
      const committed = await session.step({ t: "intent", name: "mission:commit", payload: { summary: "stage gamma only" } });
      expect((await sandbox.git(["log", "-n", "1", "--format=%s"])).trim()).toBe("stage gamma only");
      expect((await sandbox.git(["diff", "--cached"])).trim()).toBe("");
      const committedA = await sandbox.git(["show", "HEAD:a.txt"]);
      expect(committedA).toBe("alpha\nbeta\ngamma\n"); // delta did NOT commit
      const committedNames = await sandbox.git(["ls-tree", "-r", "--name-only", "HEAD"]);
      expect(committedNames.split("\n")).not.toContain("b.txt"); // b.txt did NOT commit
      const porcelainAfterCommit = await sandbox.git(["status", "--porcelain"]);
      expect(porcelainAfterCommit).toContain(" M a.txt"); // delta remains, unstaged
      expect(porcelainAfterCommit).toContain("?? b.txt"); // still untracked, untouched
      expect(committed.commit.summary).toBe("");
      // GHD's own post-commit reconciliation: a.txt's selection was
      // Partial (some of it just committed), so its remaining diff's shape
      // shifted underneath those absolute indices -- downgraded to None,
      // not reseeded to All, so the user reviews delta fresh rather than
      // it silently riding along into the next commit. b.txt's selection
      // was already None (deliberately toggled off in step 3) and a
      // commit it wasn't part of at all must not change that.
      expect(committed.stagedTotal).toBe(0);
      expect(committed.changes.find((c) => c.path === "a.txt")?.include).toBe("none");
      expect(committed.changes.find((c) => c.path === "b.txt")?.include).toBe("none");

      // 6. Undo restores the pre-commit history and returns the changes to
      // the working tree (mixed reset: nothing staged, b.txt untracked again).
      const undone = await session.step({ t: "intent", name: "mission:undo" });
      expect((await sandbox.git(["log", "-n", "1", "--format=%s"])).trim()).toBe("init");
      expect((await sandbox.git(["diff", "--cached"])).trim()).toBe("");
      const porcelain = await sandbox.git(["status", "--porcelain"]);
      expect(porcelain).toContain(" M a.txt");
      expect(porcelain).toContain("?? b.txt");
      expect(undone.notice).toBe("");

      session.send({ t: "intent", name: "quit" });
      await runPromise;
    } finally {
      await sandbox.cleanup();
    }
  }, 30_000);

  // GHD's own contract, the whole point of the reset-then-rebuild sequencing:
  // the commit takes what's CHECKED, never what happens to already be in the
  // index. A file entirely pre-staged by a raw `git add` -- outside glitter
  // entirely, exactly like another agent working the same repo concurrently
  // -- must NOT reach the commit once its checkbox is unchecked.
  test("a file staged outside the app (a raw `git add`) commits per its checkbox, not per the index", async () => {
    const sandbox = await makeSandbox();
    try {
      await sandbox.write("a.txt", "alpha\n");
      await sandbox.git(["add", "-A"]);
      await sandbox.git(["commit", "-m", "init"]);
      await sandbox.write("a.txt", "alpha\nbeta\n");
      await sandbox.git(["add", "-A"]); // staged entirely OUTSIDE the driver, before it ever runs
      await sandbox.write("b.txt", "new file\n"); // a second, ordinary change so the commit isn't empty

      const session = new LiveSession();
      const openedModels: MissionModel[] = [];
      const deps = realDeps(sandbox, session, (model) => openedModels.push(model));
      const driver = new MissionDriver(deps, { repo: "sandbox", worktree: sandbox.dir });
      const runPromise = driver.run();

      const deadline = Date.now() + 5_000;
      while (openedModels.length === 0) {
        if (Date.now() > deadline) throw new Error("driver never opened the session");
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      // Defaults to All (GHD's own default) despite already being fully
      // staged -- the checkbox has no idea and doesn't care what's in the
      // index.
      expect(openedModels[0]!.changes.find((c) => c.path === "a.txt")?.include).toBe("all");

      // Uncheck a.txt entirely; leave b.txt at its own All default.
      const toggled = await session.step({ t: "intent", name: "mission:stage", payload: { path: "a.txt", mode: "toggle-file" } });
      expect(toggled.changes.find((c) => c.path === "a.txt")?.include).toBe("none");
      // Still fully staged in the real index -- toggling is selection-only.
      expect((await sandbox.git(["diff", "--cached", "--name-only"])).trim()).toBe("a.txt");

      const committed = await session.step({ t: "intent", name: "mission:commit", payload: { summary: "commit b only" } });
      // The rebuild reset the index and rebuilt it from selections alone,
      // so a.txt's pre-existing external staging never reached the commit
      // -- only b.txt (still All, untouched) did.
      expect((await sandbox.git(["log", "-n", "1", "--format=%s"])).trim()).toBe("commit b only");
      const committedNames = await sandbox.git(["ls-tree", "-r", "--name-only", "HEAD"]);
      expect(committedNames.split("\n")).toContain("b.txt");
      const committedA = await sandbox.git(["show", "HEAD:a.txt"]);
      expect(committedA).toBe("alpha\n"); // beta did NOT commit, despite being externally staged
      const porcelain = await sandbox.git(["status", "--porcelain"]);
      expect(porcelain.split("\n").filter(Boolean)).toEqual([" M a.txt"]); // back to unstaged, untouched
      expect(committed.notice).toBe("");

      session.send({ t: "intent", name: "quit" });
      await runPromise;
    } finally {
      await sandbox.cleanup();
    }
  }, 30_000);

  test("amend still works with the reset-then-rebuild sequencing", async () => {
    const sandbox = await makeSandbox();
    try {
      await sandbox.write("a.txt", "alpha\n");
      await sandbox.git(["add", "-A"]);
      await sandbox.git(["commit", "-m", "init"]);
      await sandbox.write("a.txt", "alpha\nbeta\n");
      await sandbox.write("c.txt", "extra\n"); // present from the start, deliberately excluded below

      const session = new LiveSession();
      const openedModels: MissionModel[] = [];
      const deps = realDeps(sandbox, session, (model) => openedModels.push(model));
      const driver = new MissionDriver(deps, { repo: "sandbox", worktree: sandbox.dir });
      const runPromise = driver.run();

      const deadline = Date.now() + 5_000;
      while (openedModels.length === 0) {
        if (Date.now() > deadline) throw new Error("driver never opened the session");
        await new Promise((resolve) => setTimeout(resolve, 25));
      }

      // Uncheck c.txt (defaults to All like everything else) before the
      // first commit, so only a.txt lands in it.
      await session.step({ t: "intent", name: "mission:stage", payload: { path: "c.txt", mode: "toggle-file" } });
      await session.step({ t: "intent", name: "mission:commit", payload: { summary: "first commit" } });
      expect((await sandbox.git(["log", "-n", "1", "--format=%s"])).trim()).toBe("first commit");
      const namesAfterFirst = await sandbox.git(["ls-tree", "-r", "--name-only", "HEAD"]);
      expect(namesAfterFirst.split("\n")).not.toContain("c.txt");
      // c.txt's own None selection persisted across the commit (it was
      // never touched by it) rather than springing back to checked.
      expect((session.pushed.at(-1) as MissionModel).changes.find((c) => c.path === "c.txt")?.include).toBe("none");

      // Now check it and amend: the same reset-then-rebuild sequencing
      // runs again before `git commit --amend`, folding c.txt in alongside
      // a.txt's already-committed content.
      await session.step({ t: "intent", name: "mission:stage", payload: { path: "c.txt", mode: "toggle-file" } });
      const amended = await session.step({ t: "intent", name: "mission:commit", payload: { summary: "amended commit", amend: true } });
      expect((await sandbox.git(["log", "-n", "1", "--format=%s"])).trim()).toBe("amended commit");
      // init + amended commit -- REPLACED "first commit", not a third commit
      // stacked on top of it.
      expect((await sandbox.git(["log", "--format=%s"])).trim().split("\n")).toEqual(["amended commit", "init"]);
      const amendedA = await sandbox.git(["show", "HEAD:a.txt"]);
      expect(amendedA).toBe("alpha\nbeta\n");
      const amendedNames = await sandbox.git(["ls-tree", "-r", "--name-only", "HEAD"]);
      expect(amendedNames.split("\n")).toContain("c.txt");
      expect(amended.notice).toBe("");

      session.send({ t: "intent", name: "quit" });
      await runPromise;
    } finally {
      await sandbox.cleanup();
    }
  }, 30_000);
});
