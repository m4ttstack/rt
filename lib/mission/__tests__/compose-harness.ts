import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGitClient } from "../../../packages/git-core/src/index.ts";
import type { BranchGuardVerdict } from "../../branch-guard.ts";
import type { DaemonEvent } from "../../daemon-client.ts";
import { amendStaged, commitStaged } from "../../commit-ops.ts";
import { getPullRebase, getRemoteDefaultBranch } from "../../git-ops.ts";
import { listWorktreesAsync } from "../../worktree/git-async.ts";
import type { SessionIntent } from "../../ui/protocol.ts";
import type { SessionEnd, SessionHandle } from "../../ui/spawn.ts";
import type { MissionDeps } from "../driver.ts";
import type { MissionModel } from "../model.ts";

const IDENTITY = ["-c", "user.email=test@example.com", "-c", "user.name=Test", "-c", "commit.gpgsign=false"];

export async function runGit(cwd: string, args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", ...IDENTITY, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`git ${args.join(" ")} exited ${code}: ${err || out}`);
  return out;
}

export interface Sandbox {
  dir: string;
  git(args: string[]): Promise<string>;
  write(rel: string, content: string): Promise<void>;
  cleanup(): Promise<void>;
}

// Mirrors lib/mission/__tests__/git-actions.test.ts's sandbox: mkdtemp plus
// a bare remote, with identity pinned in repo-local config as well because
// the driver's own commit dep spawns git without the -c identity flags.
export async function makeSandbox(): Promise<Sandbox> {
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
export class LiveSession implements SessionHandle {
  pushed: MissionModel[] = [];
  exited: Promise<number>;
  /** The driver's git-status subscriber, captured by realDeps. */
  onEvent: ((ev: DaemonEvent) => void) | null = null;
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
    return this.nextPush(before, intent.name);
  }

  /** Fires the driver's git-status subscriber, then resolves with the next pushed model, as step() does. */
  async sweep(): Promise<MissionModel> {
    const before = this.pushed.length;
    this.onEvent?.({ type: "git-status", data: {} });
    return this.nextPush(before, "git-status");
  }

  private async nextPush(before: number, label: string): Promise<MissionModel> {
    const deadline = Date.now() + 5_000;
    while (this.pushed.length === before) {
      if (Date.now() > deadline) throw new Error(`no model push after ${label}`);
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

export function realDeps(sandbox: Sandbox, session: LiveSession, opened: (model: MissionModel) => void): MissionDeps {
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
    subscribe: (onEvent) => {
      session.onEvent = onEvent;
      return { close: () => {} };
    },
    runAction: async () => ({ ok: true, detail: "" }),
    commit: commitStaged,
    amend: amendStaged,
    guard: async () => ({ verdict: "clear" }) as BranchGuardVerdict,
    now: () => new Date(),
    resolveDefaultBranch: getRemoteDefaultBranch,
    readPullRebase: getPullRebase,
    buildGuards: async () => new Map(),
    listGitWorktrees: listWorktreesAsync,
    fileActions: { copy: () => true, reveal: () => true, open: () => true },
    resolveEditor: () => null,
    launchEditor: async () => false,
    pathExists: existsSync,
  };
}
