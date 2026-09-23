import { describe, expect, test } from "bun:test";
import { extname } from "node:path";
import {
  AppFileStatusKind,
  type ChangedFile,
  type Commit,
  type CommittedFileChange,
  type GitClient,
  type RepoSnapshot,
  type StagingDiff,
} from "../../../packages/git-core/src/index.ts";
import type { ResolvedEditor } from "../../../commands/code.ts";
import type { BranchGuardVerdict } from "../../branch-guard.ts";
import type { DaemonEvent, DaemonSubscription } from "../../daemon-client.ts";
import type { FileActions } from "../../file-actions.ts";
import type { SessionIntent } from "../../ui/protocol.ts";
import type { SessionEnd, SessionHandle } from "../../ui/spawn.ts";
import { MissionDriver, type MissionDeps } from "../driver.ts";
import type { MissionModel } from "../model.ts";

const ROOT = "/repo";
const START = { repo: "repo-tools", worktree: ROOT };
const ZED: ResolvedEditor = { command: "zed", label: "Zed" };

interface MenuPayload {
  action: string;
  path?: string;
  sha?: string;
  name?: string;
}

// ─── fakes (driver.test.ts's shapes, trimmed to what these intents reach) ──

function changed(path: string): ChangedFile {
  return { path, kind: "modified", staged: false, unstaged: true };
}

function snapshotOf(files: ChangedFile[]): RepoSnapshot {
  return { branch: "main", detached: false, upstream: "origin/main", ahead: 0, behind: 0, files, clean: files.length === 0 };
}

function emptyDiff(path: string): StagingDiff {
  return { path, kind: "text", untracked: false, hunks: [] };
}

function fakeCommit(sha: string): Commit {
  const id = { name: "Pat", email: "pat@example.com", date: new Date("2026-09-20T00:00:00Z"), tzOffset: 0 };
  return { sha, shortSha: sha.slice(0, 7), summary: sha, body: "", author: id, committer: id, parentSHAs: [], trailers: [], tags: [], coAuthors: [], authoredByCommitter: true, isMergeCommit: false };
}

function historyFile(path: string, commitish: string): CommittedFileChange {
  return { path, status: { kind: AppFileStatusKind.Modified }, commitish, parentCommitish: `${commitish}^` };
}

interface ClientCalls {
  snapshot: number;
  appendIgnoreFile: (string | string[])[];
  appendIgnoreRule: (string | string[])[];
  discardChanges: ChangedFile[][];
  createTag: { name: string; opts?: { message?: string; sha?: string } }[];
}

function fakeClient(over: {
  files?: () => ChangedFile[];
  discardChanges?: GitClient["discardChanges"];
  createTag?: GitClient["createTag"];
  historyFiles?: string[];
} = {}): { client: GitClient; calls: ClientCalls } {
  const calls: ClientCalls = { snapshot: 0, appendIgnoreFile: [], appendIgnoreRule: [], discardChanges: [], createTag: [] };
  const client = {
    dir: ROOT,
    snapshot: async () => {
      calls.snapshot++;
      return snapshotOf(over.files?.() ?? []);
    },
    branches: async () => [],
    remotes: async () => [{ name: "origin" }],
    stashes: async () => [],
    log: async () => [],
    stagingDiff: async (path: string) => emptyDiff(path),
    commits: async (_range?: string, limit?: number) => (limit === 1 ? [fakeCommit("h1")] : [fakeCommit("h1"), fakeCommit("h2")]),
    localCommits: async () => [],
    changedFiles: async (sha: string) => ({ files: (over.historyFiles ?? ["src/a.ts"]).map((p) => historyFile(p, sha)), linesAdded: 1, linesDeleted: 0 }),
    commitDiff: async (file: CommittedFileChange) => emptyDiff(file.path),
    appendIgnoreFile: async (paths: string | string[]) => {
      calls.appendIgnoreFile.push(paths);
    },
    appendIgnoreRule: async (patterns: string | string[]) => {
      calls.appendIgnoreRule.push(patterns);
    },
    discardChanges: async (files: ChangedFile[], opts?: { moveToTrash?: (absPath: string) => Promise<void> }) => {
      calls.discardChanges.push(files);
      await over.discardChanges?.(files, opts);
    },
    createTag: async (name: string, opts?: { message?: string; sha?: string }) => {
      calls.createTag.push({ name, opts });
      await over.createTag?.(name, opts);
    },
  } satisfies Partial<GitClient>;
  return { client: client as unknown as GitClient, calls };
}

class FakeSession implements SessionHandle {
  pushed: MissionModel[] = [];
  private queue: SessionIntent[];
  exited: Promise<number>;
  private finish!: (code: number) => void;
  constructor(intents: SessionIntent[], private endResult: SessionEnd = { reason: "closed", code: 0 }) {
    this.queue = [...intents];
    this.exited = new Promise((r) => { this.finish = r; });
  }
  get intents(): AsyncIterable<SessionIntent> {
    const self = this;
    return { [Symbol.asyncIterator]() { return { next: () => self.next() }; } };
  }
  private next(): Promise<IteratorResult<SessionIntent>> {
    const it = this.queue.shift();
    if (it) return Promise.resolve({ value: it, done: false });
    return Promise.resolve({ value: undefined as never, done: true });
  }
  push(m: unknown): void { this.pushed.push(m as MissionModel); }
  async close(): Promise<SessionEnd> {
    this.finish(this.endResult.code);
    return this.endResult;
  }
}

/** Intents arrive on demand via `send`, so a test can fire a daemon event between them. */
class QueueSession implements SessionHandle {
  pushed: MissionModel[] = [];
  private queue: SessionIntent[] = [];
  private waiter: ((v: IteratorResult<SessionIntent>) => void) | null = null;
  exited: Promise<number>;
  private finish!: (code: number) => void;
  constructor(private endResult: SessionEnd = { reason: "closed", code: 0 }) {
    this.exited = new Promise((r) => { this.finish = r; });
  }
  get intents(): AsyncIterable<SessionIntent> {
    const self = this;
    return { [Symbol.asyncIterator]() { return { next: () => self.next() }; } };
  }
  private next(): Promise<IteratorResult<SessionIntent>> {
    const it = this.queue.shift();
    if (it) return Promise.resolve({ value: it, done: false });
    return new Promise((resolve) => { this.waiter = resolve; });
  }
  send(i: SessionIntent): void {
    const w = this.waiter;
    if (w) {
      this.waiter = null;
      w({ value: i, done: false });
    } else {
      this.queue.push(i);
    }
  }
  push(m: unknown): void { this.pushed.push(m as MissionModel); }
  async close(): Promise<SessionEnd> {
    this.finish(this.endResult.code);
    return this.endResult;
  }
}

async function flushMicrotasks(times = 30): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

interface Effects {
  copy: string[];
  reveal: Parameters<FileActions["reveal"]>[];
  open: string[];
  launch: [string, string][];
  resolveEditor: string[];
  pathExists: string[];
}

function baseDeps(over: {
  session: SessionHandle;
  client: GitClient;
  editor?: ResolvedEditor | null;
  launchOk?: boolean;
  exists?: (absPath: string) => boolean;
  subscribe?: MissionDeps["subscribe"];
}): { deps: MissionDeps; effects: Effects } {
  const effects: Effects = { copy: [], reveal: [], open: [], launch: [], resolveEditor: [], pathExists: [] };
  const editor = over.editor === undefined ? ZED : over.editor;
  const deps: MissionDeps = {
    openSession: async () => over.session,
    client: () => over.client,
    daemonQuery: async (cmd: string) =>
      cmd === "worktree:list"
        ? { ok: true, data: { trees: [{ path: ROOT, name: "repo", branch: "main", state: "claimed" }] } }
        : { ok: true, data: { repos: [] } },
    subscribe: over.subscribe ?? ((): DaemonSubscription => ({ close: () => {} })),
    runAction: async () => ({ ok: true, detail: "" }),
    commit: () => "[main abc] msg",
    amend: () => "[main abc] msg",
    guard: async () => ({ verdict: "clear" }) as BranchGuardVerdict,
    now: () => new Date("2026-09-22T00:00:00Z"),
    resolveDefaultBranch: () => null,
    readPullRebase: () => false,
    buildGuards: async () => new Map(),
    listGitWorktrees: async () => null,
    fileActions: {
      copy: (text) => {
        effects.copy.push(text);
      },
      reveal: (...args) => {
        effects.reveal.push(args);
      },
      open: (absPath) => {
        effects.open.push(absPath);
      },
    },
    resolveEditor: (dir) => {
      effects.resolveEditor.push(dir);
      return editor;
    },
    launchEditor: async (command, target) => {
      effects.launch.push([command, target]);
      return over.launchOk ?? true;
    },
    pathExists: (absPath) => {
      effects.pathExists.push(absPath);
      return over.exists ? over.exists(absPath) : true;
    },
  };
  return { deps, effects };
}

function menu(payload: MenuPayload): SessionIntent {
  return { t: "intent", name: "mission:menu-action", payload };
}

async function run(
  intents: SessionIntent[],
  opts: { client?: Parameters<typeof fakeClient>[0]; editor?: ResolvedEditor | null; launchOk?: boolean; exists?: (absPath: string) => boolean } = {},
) {
  const { client, calls } = fakeClient(opts.client);
  const session = new FakeSession([...intents, { t: "intent", name: "quit" }]);
  let opened: MissionModel | null = null;
  const { deps, effects } = baseDeps({ session, client, editor: opts.editor, launchOk: opts.launchOk, exists: opts.exists });
  deps.openSession = async (_view, model) => {
    opened = model as MissionModel;
    return session;
  };
  await new MissionDriver(deps, START).run();
  return { calls, effects, session, opened: opened as MissionModel | null, last: session.pushed.at(-1) as MissionModel };
}

// ─── one test per action ────────────────────────────────────────────────────

describe("mission:menu-action: clipboard", () => {
  test("copy-path copies the absolute path and says so", async () => {
    const { effects, last } = await run([menu({ action: "copy-path", path: "src/a b.ts" })]);
    expect(effects.copy).toEqual([`${ROOT}/src/a b.ts`]);
    expect(last.notice).toBe("Copied");
  });

  test("copy-relative-path copies the normalized repo-relative path", async () => {
    const { effects, last } = await run([menu({ action: "copy-relative-path", path: "src/./a.ts" })]);
    expect(effects.copy).toEqual(["src/a.ts"]);
    expect(last.notice).toBe("Copied");
  });

  test("copy-sha copies the full sha", async () => {
    const { effects, last } = await run([menu({ action: "copy-sha", sha: "abc123" })]);
    expect(effects.copy).toEqual(["abc123"]);
    expect(last.notice).toBe("Copied");
  });
});

describe("mission:menu-action: Finder and the default app", () => {
  test("reveal selects the file in Finder", async () => {
    const { effects } = await run([menu({ action: "reveal", path: "src/a.ts" })]);
    expect(effects.reveal).toEqual([[`${ROOT}/src/a.ts`]]);
  });

  test("reveal-repo opens the worktree root as a folder", async () => {
    const { effects } = await run([menu({ action: "reveal-repo" })]);
    expect(effects.reveal).toEqual([[ROOT, "folder"]]);
  });

  test("open-default opens the file with its default app", async () => {
    const { effects } = await run([menu({ action: "open-default", path: "src/a.ts" })]);
    expect(effects.open).toEqual([`${ROOT}/src/a.ts`]);
  });
});

describe("mission:menu-action: editor", () => {
  test("open-editor launches the resolved editor on the file", async () => {
    const { effects, last } = await run([menu({ action: "open-editor", path: "src/a.ts" })]);
    expect(effects.launch).toEqual([["zed", `${ROOT}/src/a.ts`]]);
    expect(last.notice).toBe("");
  });

  test("open-editor with no editor resolved launches nothing and says how to pick one", async () => {
    const { effects, last } = await run([menu({ action: "open-editor", path: "src/a.ts" })], { editor: null });
    expect(effects.launch).toEqual([]);
    expect(last.notice).toBe("No editor set: run rt code once to pick one");
  });

  test("open-repo-editor launches the resolved editor on the worktree root", async () => {
    const { effects } = await run([menu({ action: "open-repo-editor" })]);
    expect(effects.launch).toEqual([["zed", ROOT]]);
  });

  test("a launch that fails names the editor in the notice", async () => {
    const { last } = await run([menu({ action: "open-repo-editor" })], { launchOk: false });
    expect(last.notice).toBe("Could not open Zed");
  });

  test("the editor resolves once per refresh against the current worktree, never per push", async () => {
    const { effects, session } = await run([menu({ action: "copy-sha", sha: "a" }), menu({ action: "copy-sha", sha: "b" })]);
    expect(session.pushed.length).toBe(2);
    expect(effects.resolveEditor).toEqual([ROOT]);
  });
});

describe("mission:menu-action: ignore", () => {
  test("ignore-file appends the path as given", async () => {
    const { calls } = await run([menu({ action: "ignore-file", path: "dist/[x].js" })]);
    expect(calls.appendIgnoreFile).toEqual(["dist/[x].js"]);
  });

  test("ignore-folder appends the folder label as given", async () => {
    const { calls } = await run([menu({ action: "ignore-folder", path: "/dist/sub" })]);
    expect(calls.appendIgnoreFile).toEqual(["/dist/sub"]);
  });

  test("ignore-extension appends a glob for the last extension", async () => {
    const { calls } = await run([menu({ action: "ignore-extension", path: "src/a.test.ts" })]);
    expect(calls.appendIgnoreRule).toEqual(["*.ts"]);
  });

  test("ignore-extension on a dotfile with no extension appends nothing", async () => {
    const { calls } = await run([menu({ action: "ignore-extension", path: ".env" })]);
    expect(calls.appendIgnoreRule).toEqual([]);
  });
});

describe("mission:menu-action: discard", () => {
  test("discard-file discards the snapshot's own ChangedFile and drops its selection", async () => {
    const { calls, last } = await run(
      [
        { t: "intent", name: "mission:stage", payload: { path: "a.txt", mode: "toggle-file" } },
        menu({ action: "discard-file", path: "a.txt" }),
      ],
      { client: { files: () => [changed("a.txt")] } },
    );
    expect(calls.discardChanges).toEqual([[changed("a.txt")]]);
    // The fake tree still reports a.txt, so a dropped selection reseeds to All;
    // a kept one would still read "none" from the toggle above.
    expect(last.changes[0]!.include).toBe("all");
  });

  test("discard-file on a path with no changes calls nothing and says so", async () => {
    const { calls, last } = await run([menu({ action: "discard-file", path: "gone.txt" })], { client: { files: () => [changed("a.txt")] } });
    expect(calls.discardChanges).toEqual([]);
    expect(last.notice).toBe("gone.txt has no changes to discard");
  });

  test("a discard that throws still refreshes, and its message becomes the notice", async () => {
    let trashed = false;
    const { calls, last } = await run([menu({ action: "discard-file", path: "a.txt" })], {
      client: {
        files: () => (trashed ? [] : [changed("a.txt")]),
        discardChanges: async () => {
          trashed = true;
          throw new Error("could not move b.txt to the Trash");
        },
      },
    });
    expect(calls.discardChanges).toHaveLength(1);
    expect(calls.snapshot).toBe(2);
    expect(last.changes).toEqual([]);
    expect(last.notice).toBe("could not move b.txt to the Trash");
  });
});

describe("mission:menu-action: tags", () => {
  test("create-tag trims the name and tags the given sha", async () => {
    const { calls } = await run([menu({ action: "create-tag", sha: "abc123", name: " v1 " })]);
    expect(calls.createTag).toEqual([{ name: "v1", opts: { sha: "abc123" } }]);
  });

  test("a createTag failure lands as the notice", async () => {
    const { last } = await run([menu({ action: "create-tag", sha: "abc123", name: "bad..name" })], {
      client: {
        createTag: async () => {
          throw new Error("invalid tag name");
        },
      },
    });
    expect(last.notice).toBe("invalid tag name");
  });
});

describe("mission:menu-action: refresh", () => {
  test("ignore and create-tag refresh the snapshot; clipboard, Finder, and editor rows do not", async () => {
    const { calls } = await run([
      menu({ action: "copy-path", path: "a.txt" }),
      menu({ action: "reveal-repo" }),
      menu({ action: "open-repo-editor" }),
      menu({ action: "ignore-file", path: "a.txt" }),
      menu({ action: "create-tag", sha: "abc123", name: "v1" }),
    ]);
    expect(calls.snapshot).toBe(3);
  });
});

// The Go view labels the ignore-extension row from the same extension, so
// both languages pin this exact table.
describe("extname parity table", () => {
  test.each([
    ["a.go", ".go"],
    [".gitignore", ""],
    [".env.local", ".local"],
    ["a.tar.gz", ".gz"],
    ["Makefile", ""],
    ["dir.d/file", ""],
    ["a.", "."],
  ] as const)("extname(%p) is %p", (path, want) => {
    expect(extname(path)).toBe(want);
  });
});

// ─── wire fields ────────────────────────────────────────────────────────────

describe("editorLabel", () => {
  test("carries the resolved editor's label", async () => {
    const { opened } = await run([]);
    expect(opened!.editorLabel).toBe("Zed");
  });

  test("is empty when no editor resolves", async () => {
    const { opened } = await run([], { editor: null });
    expect(opened!.editorLabel).toBe("");
  });
});

describe("History file rows: onDisk", () => {
  const historyTab: SessionIntent = { t: "intent", name: "mission:tab", payload: { tab: "history" } };

  test("each row carries the driver's lookup against the worktree root", async () => {
    const { last } = await run([historyTab], {
      client: { historyFiles: ["src/a.ts", "src/b.ts"] },
      exists: (p) => p === `${ROOT}/src/a.ts`,
    });
    expect(last.history.files.map((f) => [f.path, f.onDisk])).toEqual([
      ["src/a.ts", true],
      ["src/b.ts", false],
    ]);
  });

  test("is looked up once per changeset, not once per push", async () => {
    const { effects, session } = await run([historyTab, { t: "intent", name: "mission:select", payload: { filter: "x" } }], {
      client: { historyFiles: ["src/a.ts", "src/b.ts"] },
    });
    expect(session.pushed.length).toBeGreaterThan(2);
    expect(effects.pathExists).toEqual([`${ROOT}/src/a.ts`, `${ROOT}/src/b.ts`]);
  });

  test("a new selection's changeset is looked up afresh", async () => {
    const { effects } = await run([historyTab, { t: "intent", name: "mission:history-select", payload: { shas: ["h2"] } }]);
    expect(effects.pathExists).toEqual([`${ROOT}/src/a.ts`, `${ROOT}/src/a.ts`]);
  });

  test("a refresh clears the lookup even when the changeset is unchanged", async () => {
    const { effects } = await run([historyTab, menu({ action: "ignore-file", path: "dist" })]);
    expect(effects.pathExists).toEqual([`${ROOT}/src/a.ts`, `${ROOT}/src/a.ts`]);
  });

  test("a git-status sweep clears the lookup too", async () => {
    const { client } = fakeClient();
    const session = new QueueSession();
    let captured: ((ev: DaemonEvent) => void) | null = null;
    const { deps, effects } = baseDeps({
      session,
      client,
      subscribe: (onEvent) => {
        captured = onEvent;
        return { close: () => {} };
      },
    });

    const running = new MissionDriver(deps, START).run();
    await flushMicrotasks();
    session.send(historyTab);
    await flushMicrotasks();
    expect(effects.pathExists).toEqual([`${ROOT}/src/a.ts`]);

    captured!({ type: "git-status", data: {} });
    await flushMicrotasks();
    expect(effects.pathExists).toEqual([`${ROOT}/src/a.ts`, `${ROOT}/src/a.ts`]);

    session.send({ t: "intent", name: "quit" });
    await running;
  });
});
