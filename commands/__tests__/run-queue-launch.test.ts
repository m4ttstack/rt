import { afterEach, test, expect, mock } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { queueToSeed, launchQueue, __test__ } from "../run.ts";
import { __test__ as gate } from "../../lib/ui/gate.ts";
import { __test__ as pickTest, type PickHandle } from "../../lib/ui/pick.ts";
import type { PickRequest, PickResult } from "../../lib/ui/protocol.ts";

/** A real git repo with a neutral remote (so deriveRepoIdentity yields a
    remote identity savePreset can write under) and two workspace packages,
    so getWorkspacePackages inside selectPackageAndScript returns 2+ and the
    manual package picker (with the queue rows) actually renders instead of
    auto-selecting a lone package. */
function makeQueueRepoFixture(container: string): string {
  const root = join(container, "fixture");
  mkdirSync(root, { recursive: true });
  for (const args of [["init", "-q"], ["remote", "add", "origin", "https://example.com/acme/fixture.git"]]) {
    const r = Bun.spawnSync(["git", "-C", root, ...args]);
    if (r.exitCode !== 0) throw new Error(`git ${args[0]} failed: ${r.stderr.toString()}`);
  }
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fixture", workspaces: ["packages/*"] }));
  for (const pkg of ["a", "b"]) {
    const dir = join(root, "packages", pkg);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: pkg, scripts: { dev: "vite" } }));
  }
  return root;
}

/** One scripted PickResult per runPick call, in order (mirrors run-resolve.test.ts's installSequentialPick). */
function installSequentialPick(results: Array<Omit<PickResult, "t">>): { calls: PickRequest[]; restore: () => void } {
  const calls: PickRequest[] = [];
  let i = 0;
  pickTest.setImpl((req) => {
    calls.push(req);
    const r = results[i] ?? results[results.length - 1]!;
    i++;
    return {
      update() {},
      modal: async () => null,
      result: Promise.resolve({ t: "result", ...r }),
    } satisfies PickHandle;
  });
  return { calls, restore: () => pickTest.setImpl(undefined) };
}

const realRunner = { ...(await import("../runner.ts")) };
const realHerdrLaunch = { ...(await import("../../lib/herdr-launch.ts")) };
const realRtRender = { ...(await import("../../lib/rt-render.ts")) };

afterEach(() => {
  gate.setInteractive(undefined);
  pickTest.setImpl(undefined);
  mock.module("../runner.ts", () => realRunner);
  mock.module("../../lib/herdr-launch.ts", () => realHerdrLaunch);
  mock.module("../../lib/rt-render.ts", () => realRtRender);
});

// ─── queueToSeed ─────────────────────────────────────────────────────────────

test("queueToSeed keeps queue order, carries pkg/repo/command, and re-resolves cwd against the launch worktree", () => {
  const queue = [
    {
      packageRelPath: "apps/web",
      // A different worktree than the one being launched into -- cwd must
      // come from packageRelPath + worktreePath, never this stale path.
      packagePath: "/queued/from/some/other/worktree/apps/web",
      packageLabel: "web",
      script: "dev",
      command: "bun run dev",
    },
    {
      packageRelPath: "apps/api",
      packagePath: "/queued/from/some/other/worktree/apps/api",
      packageLabel: "api",
      script: "start",
      command: "node server.js",
      variationName: "debug",
    },
  ];

  const seed = queueToSeed(queue, "/home/me/repo");

  expect(seed).toEqual([
    { name: "dev", command: "bun run dev", cwd: "/home/me/repo/apps/web", pkg: "web", repo: "repo" },
    { name: "start (debug)", command: "node server.js", cwd: "/home/me/repo/apps/api", pkg: "api", repo: "repo" },
  ]);
});

// ─── The board path: selectPackageAndScript ─────────────────────────────────

test("Launch all while resolving for a board returns seed rows, not QUEUE_LAUNCHED", async () => {
  const container = mkdtempSync(join(tmpdir(), "rt-run-queue-board-"));
  const root = makeQueueRepoFixture(container);
  try {
    const queue = [
      { packageRelPath: "packages/a", packagePath: join(root, "packages/a"), packageLabel: "a", script: "dev", command: "bun run dev" },
    ];
    const fake = installSequentialPick([
      { action: "select", value: __test__.LAUNCH_ALL_SENTINEL, query: "" },
    ]);
    try {
      const result = await __test__.selectPackageAndScript(root, undefined, {} as never, undefined, queue, true);
      expect(result).toEqual({ seed: queueToSeed(queue, root) });
    } finally {
      fake.restore();
    }
  } finally {
    rmSync(container, { recursive: true, force: true });
  }
});

test("save-preset run-now while resolving for a board returns seed rows, not QUEUE_LAUNCHED", async () => {
  const container = mkdtempSync(join(tmpdir(), "rt-run-queue-board-savepreset-"));
  const root = makeQueueRepoFixture(container);
  try {
    const queue = [
      { packageRelPath: "packages/a", packagePath: join(root, "packages/a"), packageLabel: "a", script: "dev", command: "bun run dev" },
      { packageRelPath: "packages/b", packagePath: join(root, "packages/b"), packageLabel: "b", script: "dev", command: "bun run dev" },
    ];
    mock.module("../../lib/rt-render.ts", () => ({
      ...realRtRender,
      textInput: async () => "queue-preset",
      confirm: async () => true,
    }));
    const fake = installSequentialPick([
      { action: "select", value: __test__.SAVE_PRESET_SENTINEL, query: "" },
    ]);
    try {
      const result = await __test__.selectPackageAndScript(root, undefined, {} as never, undefined, queue, true);
      expect(result).toEqual({ seed: queueToSeed(queue, root) });
    } finally {
      fake.restore();
    }
  } finally {
    rmSync(container, { recursive: true, force: true });
  }
});

// ─── launchQueue routing ─────────────────────────────────────────────────────

test("launchQueue opens a seeded board with queueToSeed's rows when interactive and tmux is available", async () => {
  gate.setInteractive(() => true);
  let seedSeen: unknown;
  let boardCtxSeen: unknown;
  mock.module("../runner.ts", () => ({
    ...realRunner,
    tmuxAvailable: () => true,
    runSeededBoard: async (seed: unknown, ctx: unknown) => {
      seedSeen = seed;
      boardCtxSeen = ctx;
    },
  }));

  const queue = [
    { packageRelPath: "apps/web", packagePath: "/wherever", packageLabel: "web", script: "dev", command: "bun run dev" },
  ];
  const ctx = { marker: "the-ctx" };
  await launchQueue(queue, "/home/me/repo", ctx as never);

  expect(seedSeen).toEqual(queueToSeed(queue, "/home/me/repo"));
  expect(boardCtxSeen).toBe(ctx);
});

test("launchQueue falls back to running sequentially when not interactive", async () => {
  gate.setInteractive(() => false);
  const fallbackCalls: unknown[][] = [];
  let boardCalled = false;
  mock.module("../../lib/herdr-launch.ts", () => ({
    ...realHerdrLaunch,
    launchFallback: (items: unknown[]) => {
      fallbackCalls.push(items);
    },
  }));
  mock.module("../runner.ts", () => ({
    ...realRunner,
    tmuxAvailable: () => true,
    runSeededBoard: async () => {
      boardCalled = true;
    },
  }));

  const queue = [
    { packageRelPath: "apps/web", packagePath: "/wherever", packageLabel: "web", script: "dev", command: "bun run dev" },
  ];
  await launchQueue(queue, "/home/me/repo", {} as never);

  expect(fallbackCalls).toHaveLength(1);
  expect(boardCalled).toBe(false);
});

test("launchQueue is a no-op on an empty queue", async () => {
  gate.setInteractive(() => true);
  let boardCalled = false;
  mock.module("../runner.ts", () => ({
    ...realRunner,
    tmuxAvailable: () => true,
    runSeededBoard: async () => {
      boardCalled = true;
    },
  }));

  await launchQueue([], "/home/me/repo", {} as never);

  expect(boardCalled).toBe(false);
});
