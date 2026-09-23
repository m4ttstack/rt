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
import type { SessionHandle } from "../../ui/spawn.ts";
import { MissionDriver, type MissionDeps } from "../driver.ts";
import type { MissionModel } from "../model.ts";
import { FakeSession, flushMicrotasks, QueueSession } from "./fake-sessions.ts";

const ROOT = "/repo";
const START = { repo: "repo-tools", worktree: ROOT };
const ZED: ResolvedEditor = { command: "zed", label: "Zed" };
const ODD = "a b/[x]#!.txt";

interface MenuPayload {
  action: string;
  path?: string;
  sha?: string;
  name?: string;
}

// ─── fakes (driver.test.ts's shapes, trimmed to what these intents reach) ──

function changed(path: string, kind: ChangedFile["kind"] = "modified"): ChangedFile {
  return { path, kind, staged: false, unstaged: true };
}

function snapshotOf(files: ChangedFile[]): RepoSnapshot {
  return { branch: "main", detached: false, upstream: "origin/main", ahead: 0, behind: 0, files, clean: files.length === 0 };
}

function emptyDiff(path: string): StagingDiff {
  return { path, kind: "text", untracked: false, hunks: [] };
}

function fakeCommit(sha: string, tags: string[] = []): Commit {
  const id = { name: "Pat", email: "pat@example.com", date: new Date("2026-09-20T00:00:00Z"), tzOffset: 0 };
  return { sha, shortSha: sha.slice(0, 7), summary: sha, body: "", author: id, committer: id, parentSHAs: [], trailers: [], tags, coAuthors: [], authoredByCommitter: true, isMergeCommit: false };
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

/** createTag tags the fake history by default, so the next commits() read decorates that commit. */
function fakeClient(over: {
  files?: (snapshotCall: number) => ChangedFile[];
  discardChanges?: GitClient["discardChanges"];
  createTag?: GitClient["createTag"];
  historyFiles?: string[];
} = {}): { client: GitClient; calls: ClientCalls } {
  const calls: ClientCalls = { snapshot: 0, appendIgnoreFile: [], appendIgnoreRule: [], discardChanges: [], createTag: [] };
  const tags = new Map<string, string[]>();
  const history = () => ["h1", "h2"].map((sha) => fakeCommit(sha, tags.get(sha) ?? []));
  const client = {
    dir: ROOT,
    snapshot: async () => {
      calls.snapshot++;
      return snapshotOf(over.files?.(calls.snapshot) ?? []);
    },
    branches: async () => [],
    remotes: async () => [{ name: "origin" }],
    stashes: async () => [],
    log: async () => [],
    stagingDiff: async (path: string) => emptyDiff(path),
    commits: async (_range?: string, limit?: number) => history().slice(0, limit ?? 2),
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
      if (over.createTag) return over.createTag(name, opts);
      const sha = opts?.sha ?? "h1";
      tags.set(sha, [...(tags.get(sha) ?? []), name]);
    },
  } satisfies Partial<GitClient>;
  return { client: client as unknown as GitClient, calls };
}

interface Effects {
  copy: string[];
  reveal: Parameters<FileActions["reveal"]>[];
  open: string[];
  launch: [string, string][];
  resolveEditor: string[];
  pathExists: string[];
}

interface DepOptions {
  editor?: ResolvedEditor | null | ((call: number) => ResolvedEditor | null);
  launch?: (command: string, target: string) => Promise<boolean>;
  fileActionsOk?: boolean;
  exists?: (absPath: string) => boolean;
}

function baseDeps(over: DepOptions & { session: SessionHandle; client: GitClient; subscribe?: MissionDeps["subscribe"] }): { deps: MissionDeps; effects: Effects } {
  const effects: Effects = { copy: [], reveal: [], open: [], launch: [], resolveEditor: [], pathExists: [] };
  const editor = over.editor === undefined ? ZED : over.editor;
  const ok = over.fileActionsOk ?? true;
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
        return ok;
      },
      reveal: (...args) => {
        effects.reveal.push(args);
        return ok;
      },
      open: (absPath) => {
        effects.open.push(absPath);
        return ok;
      },
    },
    resolveEditor: (dir) => {
      effects.resolveEditor.push(dir);
      return typeof editor === "function" ? editor(effects.resolveEditor.length) : editor;
    },
    launchEditor: (command, target) => {
      effects.launch.push([command, target]);
      return over.launch ? over.launch(command, target) : Promise.resolve(true);
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

const historyTab: SessionIntent = { t: "intent", name: "mission:tab", payload: { tab: "history" } };

async function run(intents: SessionIntent[], opts: DepOptions & { client?: Parameters<typeof fakeClient>[0] } = {}) {
  const { client, calls } = fakeClient(opts.client);
  const session = new FakeSession([...intents, { t: "intent", name: "quit" }]);
  let opened: MissionModel | null = null;
  const { deps, effects } = baseDeps({ ...opts, session, client });
  deps.openSession = async (_view, model) => {
    opened = model as MissionModel;
    return session;
  };
  await new MissionDriver(deps, START).run();
  return { calls, effects, session, opened: opened as MissionModel | null, last: session.pushed.at(-1) as MissionModel };
}

/** Drives the driver one intent at a time, for effects that settle after their intent was handled. */
async function live(opts: DepOptions & { client?: Parameters<typeof fakeClient>[0] } = {}) {
  const { client, calls } = fakeClient(opts.client);
  const session = new QueueSession();
  let captured: ((ev: DaemonEvent) => void) | null = null;
  const { deps, effects } = baseDeps({
    ...opts,
    session,
    client,
    subscribe: (onEvent) => {
      captured = onEvent;
      return { close: () => {} };
    },
  });
  const running = new MissionDriver(deps, START).run();
  await flushMicrotasks();
  return {
    calls,
    effects,
    session,
    last: () => session.pushed.at(-1) as MissionModel,
    send: async (intent: SessionIntent) => {
      session.send(intent);
      await flushMicrotasks();
    },
    gitStatus: async () => {
      captured!({ type: "git-status", data: {} });
      await flushMicrotasks();
    },
    quit: async () => {
      session.send({ t: "intent", name: "quit" });
      await running;
    },
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
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

  test("a clipboard failure never claims Copied", async () => {
    const { last } = await run([menu({ action: "copy-sha", sha: "abc123" })], { fileActionsOk: false });
    expect(last.notice).toBe("Could not copy");
  });
});

describe("mission:menu-action: Finder and the default app", () => {
  test("reveal selects the file in Finder", async () => {
    const { effects } = await run([menu({ action: "reveal", path: "src/a.ts" }), menu({ action: "reveal", path: ODD })]);
    expect(effects.reveal).toEqual([[`${ROOT}/src/a.ts`], [`${ROOT}/${ODD}`]]);
  });

  test("reveal-repo opens the worktree root as a folder", async () => {
    const { effects } = await run([menu({ action: "reveal-repo" })]);
    expect(effects.reveal).toEqual([[ROOT, "folder"]]);
  });

  test("open-default opens the file with its default app", async () => {
    const { effects } = await run([menu({ action: "open-default", path: "src/a.ts" }), menu({ action: "open-default", path: ODD })]);
    expect(effects.open).toEqual([`${ROOT}/src/a.ts`, `${ROOT}/${ODD}`]);
  });

  test("a failed reveal or open names the path", async () => {
    const reveal = await run([menu({ action: "reveal", path: "src/a.ts" })], { fileActionsOk: false });
    expect(reveal.last.notice).toBe("Could not reveal src/a.ts");
    const revealRepo = await run([menu({ action: "reveal-repo" })], { fileActionsOk: false });
    expect(revealRepo.last.notice).toBe("Could not reveal repo");
    const open = await run([menu({ action: "open-default", path: "src/a.ts" })], { fileActionsOk: false });
    expect(open.last.notice).toBe("Could not open src/a.ts");
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

  test("open-editor with no editor cached re-resolves once before giving up", async () => {
    const { effects, last } = await run([menu({ action: "open-editor", path: "src/a.ts" })], {
      editor: (call) => (call === 1 ? null : ZED),
    });
    expect(effects.resolveEditor).toEqual([ROOT, ROOT]);
    expect(effects.launch).toEqual([["zed", `${ROOT}/src/a.ts`]]);
    expect(last.notice).toBe("");
  });

  test("open-repo-editor launches the resolved editor on the worktree root", async () => {
    const { effects } = await run([menu({ action: "open-repo-editor" })]);
    expect(effects.launch).toEqual([["zed", ROOT]]);
  });

  test("a launch that never settles does not hold up the next intent", async () => {
    const board = await live({ launch: () => new Promise<boolean>(() => {}) });
    await board.send(menu({ action: "open-repo-editor" }));
    await board.send({ t: "intent", name: "mission:select", payload: { filter: "next" } });
    expect(board.effects.launch).toEqual([["zed", ROOT]]);
    expect(board.last().filter).toBe("next");
    await board.quit();
  });

  test("a launch that settles false names the editor in the notice once it lands", async () => {
    const launched = deferred<boolean>();
    const board = await live({ launch: () => launched.promise });
    await board.send(menu({ action: "open-repo-editor" }));
    expect(board.last().notice).toBe("");
    launched.resolve(false);
    await flushMicrotasks();
    expect(board.last().notice).toBe("Could not open Zed");
    await board.quit();
  });
});

describe("mission:menu-action: editor resolution", () => {
  test("resolves once at start; a refresh after a mutation does not re-resolve", async () => {
    const { effects } = await run([menu({ action: "ignore-file", path: "dist" }), menu({ action: "copy-sha", sha: "a" })]);
    expect(effects.resolveEditor).toEqual([ROOT]);
  });

  test("a worktree change re-resolves against the new tree", async () => {
    const { effects } = await run([{ t: "intent", name: "mission:worktree", payload: { path: "/repo2" } }]);
    expect(effects.resolveEditor).toEqual([ROOT, "/repo2"]);
  });

  test("mission:refresh re-resolves, so a newly picked editor shows up without a restart", async () => {
    const { effects, calls, opened, last } = await run([{ t: "intent", name: "mission:refresh" }], {
      editor: (call) => (call === 1 ? null : ZED),
    });
    expect(effects.resolveEditor).toEqual([ROOT, ROOT]);
    expect(opened!.editorLabel).toBe("");
    expect(last.editorLabel).toBe("Zed");
    expect(calls.snapshot).toBe(2);
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
  test("discard-file discards the ChangedFile and drops its selection", async () => {
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

  test("discard-file reads the file's status fresh rather than trusting the last snapshot", async () => {
    const { calls } = await run([menu({ action: "discard-file", path: "a.txt" })], {
      client: { files: (call) => [changed("a.txt", call === 1 ? "deleted" : "untracked")] },
    });
    expect(calls.discardChanges).toEqual([[changed("a.txt", "untracked")]]);
  });

  test("discard-file on a path with no changes calls nothing and says so", async () => {
    const { calls, last } = await run([menu({ action: "discard-file", path: "gone.txt" })], { client: { files: () => [changed("a.txt")] } });
    expect(calls.discardChanges).toEqual([]);
    expect(last.notice).toBe("gone.txt has no changes to discard");
  });

  test("a path the board still lists but the tree no longer has refreshes the board instead", async () => {
    const { calls, last } = await run([menu({ action: "discard-file", path: "gone.txt" })], {
      client: { files: (call) => (call === 1 ? [changed("gone.txt")] : []) },
    });
    expect(calls.discardChanges).toEqual([]);
    expect(calls.snapshot).toBe(3);
    expect(last.changes).toEqual([]);
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
    expect(calls.snapshot).toBe(3);
    expect(last.changes).toEqual([]);
    expect(last.notice).toBe("could not move b.txt to the Trash");
  });
});

describe("mission:menu-action: tags", () => {
  test("create-tag trims the name and tags the given sha", async () => {
    const { calls } = await run([menu({ action: "create-tag", sha: "abc123", name: " v1 " })]);
    expect(calls.createTag).toEqual([{ name: "v1", opts: { sha: "abc123" } }]);
  });

  test("a new tag shows on its commit row and header without HEAD moving", async () => {
    const { last } = await run([historyTab, menu({ action: "create-tag", sha: "h1", name: "v1" })]);
    expect(last.history.commits.map((c) => [c.sha, c.tags])).toEqual([
      ["h1", ["v1"]],
      ["h2", []],
    ]);
    expect(last.history.header?.sha).toBe("h1");
    expect(last.history.header?.tags).toEqual(["v1"]);
  });

  test("a tag made off the History tab shows on the next History open", async () => {
    const { last } = await run([historyTab, { t: "intent", name: "mission:tab", payload: { tab: "changes" } }, menu({ action: "create-tag", sha: "h1", name: "v1" }), historyTab]);
    expect(last.history.commits[0]!.tags).toEqual(["v1"]);
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
    const board = await live();
    await board.send(historyTab);
    expect(board.effects.pathExists).toEqual([`${ROOT}/src/a.ts`]);
    await board.gitStatus();
    expect(board.effects.pathExists).toEqual([`${ROOT}/src/a.ts`, `${ROOT}/src/a.ts`]);
    await board.quit();
  });
});
