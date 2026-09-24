import { afterEach, test, expect, mock } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { queueToSeed, launchQueue, runCommand, __test__ } from "../run.ts";
import { __test__ as gate } from "../../lib/ui/gate.ts";
import { installSequentialPick } from "../../lib/ui/pick-fake.ts";

/** A real git repo with a neutral remote (so deriveRepoIdentity yields a
    remote identity savePreset can write under) and two workspace packages,
    so getWorkspacePackages inside selectPackageAndScript returns 2+ and the
    manual package picker (with the queue rows) actually renders instead of
    auto-selecting a lone package. Package "a" carries two scripts so its
    script picker is a real pick (a single-script package auto-queues
    without ever showing one), for tests that build the queue by tabbing
    through the picker rather than passing one in pre-built. */
function makeQueueRepoFixture(container: string): string {
  const root = join(container, "fixture");
  mkdirSync(root, { recursive: true });
  for (const args of [["init", "-q"], ["remote", "add", "origin", "https://example.com/acme/fixture.git"]]) {
    const r = Bun.spawnSync(["git", "-C", root, ...args]);
    if (r.exitCode !== 0) throw new Error(`git ${args[0]} failed: ${r.stderr.toString()}`);
  }
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fixture", workspaces: ["packages/*"] }));
  mkdirSync(join(root, "packages", "a"), { recursive: true });
  writeFileSync(join(root, "packages", "a", "package.json"), JSON.stringify({ name: "a", scripts: { dev: "vite", build: "vite build" } }));
  mkdirSync(join(root, "packages", "b"), { recursive: true });
  writeFileSync(join(root, "packages", "b", "package.json"), JSON.stringify({ name: "b", scripts: { dev: "vite" } }));
  return root;
}

const realRunner = { ...(await import("../runner.ts")) };
const realHerdrLaunch = { ...(await import("../../lib/herdr-launch.ts")) };
const realRtRender = { ...(await import("../../lib/rt-render.ts")) };

afterEach(() => {
  gate.setInteractive(undefined);
  mock.module("../runner.ts", () => realRunner);
  mock.module("../../lib/herdr-launch.ts", () => realHerdrLaunch);
  mock.module("../../lib/rt-render.ts", () => realRtRender);
});

// ─── queueToSeed ─────────────────────────────────────────────────────────────

test("queueToSeed keeps queue order and pkg/repo, rebuilds a plain item's command against the launch worktree, and keeps a variation's stored command", () => {
  const queue = [
    {
      packageRelPath: "apps/web",
      // A different worktree than the one being launched into -- cwd must
      // come from packageRelPath + worktreePath, never this stale path, and
      // neither must the package-manager prefix baked into a plain item's
      // stored command (it was detected at QUEUE time, against this path).
      packagePath: "/queued/from/some/other/worktree/apps/web",
      packageLabel: "web",
      script: "dev",
      command: "yarn run dev",
    },
    {
      packageRelPath: "apps/api",
      packagePath: "/queued/from/some/other/worktree/apps/api",
      packageLabel: "api",
      script: "start",
      // A variation's command is a user-authored override, not a detected
      // package-manager prefix -- it must survive verbatim.
      command: "node server.js",
      variationName: "debug",
    },
  ];

  const seed = queueToSeed(queue, "/home/me/repo");

  expect(seed).toEqual([
    { name: "dev", command: expect.stringContaining("run dev"), cwd: "/home/me/repo/apps/web", pkg: "web", repo: "repo" },
    { name: "start (debug)", command: "node server.js", cwd: "/home/me/repo/apps/api", pkg: "api", repo: "repo" },
  ]);
  // Not just a loose match: the plain item's stale, queued-from command must
  // actually be replaced, not merely happen to contain "run dev".
  expect(seed[0]!.command).not.toBe("yarn run dev");
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

// ─── rt run --resolve-only on a queue ───────────────────────────────────────

test("runCommand with --resolve-only on a queue prints the seed envelope to stdout and launches nothing", async () => {
  const container = mkdtempSync(join(tmpdir(), "rt-run-queue-resolveonly-"));
  const root = makeQueueRepoFixture(container);
  let boardCalled = false;
  let fallbackCalled = false;
  mock.module("../runner.ts", () => ({
    ...realRunner,
    runSeededBoard: async () => { boardCalled = true; },
  }));
  mock.module("../../lib/herdr-launch.ts", () => ({
    ...realHerdrLaunch,
    launchFallback: () => { fallbackCalled = true; },
  }));

  const fake = installSequentialPick([
    { action: "select", value: join(root, "packages/a"), query: "" }, // 0: package picker -- pick a
    { action: "tab", value: "dev", query: "" }, // 1: script picker (a has 2 scripts) -- queue dev via tab
    { action: "select", value: __test__.LAUNCH_ALL_SENTINEL, query: "" }, // 2: package picker (1 queued) -- Launch all
  ]);

  const outs: string[] = [];
  const realWrite = process.stdout.write;
  process.stdout.write = ((c: string | Uint8Array) => { outs.push(String(c)); return true; }) as typeof process.stdout.write;

  const ctx = {
    identity: { repoName: "fixture", identity: `test-queue-resolveonly-${Date.now()}`, repoRoot: root, dataDir: "", remoteUrl: "", baseUrl: "" },
  } as never;

  try {
    await runCommand(["--resolve-only"], ctx);
  } finally {
    process.stdout.write = realWrite;
    fake.restore();
    rmSync(container, { recursive: true, force: true });
  }

  expect(boardCalled).toBe(false);
  expect(fallbackCalled).toBe(false);
  expect(outs).toHaveLength(1);
  expect(JSON.parse(outs[0]!)).toEqual({
    seed: [
      { name: "dev", command: expect.stringContaining("run dev"), cwd: join(root, "packages/a"), pkg: "a", repo: "fixture" },
    ],
  });
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
  const fallbackCalls: Array<{ items: unknown; reason: unknown }> = [];
  let boardCalled = false;
  mock.module("../../lib/herdr-launch.ts", () => ({
    ...realHerdrLaunch,
    launchFallback: (items: unknown, reason: unknown) => {
      fallbackCalls.push({ items, reason });
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
  expect(fallbackCalls[0]!.reason).toContain("interactive");
  expect(boardCalled).toBe(false);
});

// Pins the review's Important finding: inside herdr but with no tmux on
// PATH is a reachable fallback (interactive is true), so the banner must
// name tmux, never "not inside herdr" -- a cause that was never even checked
// once the routing gate became interactive() && tmuxAvailable().
test("launchQueue falls back to running sequentially, naming tmux, when interactive but tmux is missing", async () => {
  gate.setInteractive(() => true);
  const fallbackCalls: Array<{ items: unknown; reason: unknown }> = [];
  let boardCalled = false;
  mock.module("../../lib/herdr-launch.ts", () => ({
    ...realHerdrLaunch,
    launchFallback: (items: unknown, reason: unknown) => {
      fallbackCalls.push({ items, reason });
    },
  }));
  mock.module("../runner.ts", () => ({
    ...realRunner,
    tmuxAvailable: () => false,
    runSeededBoard: async () => {
      boardCalled = true;
    },
  }));

  const queue = [
    {
      packageRelPath: "apps/web",
      // A different worktree than the one being launched into -- the
      // fallback item's cwd must come from packageRelPath + worktreePath,
      // and so must a plain item's package-manager prefix, never this
      // stale queued-from path.
      packagePath: "/queued/from/some/other/worktree/apps/web",
      packageLabel: "web",
      script: "dev",
      command: "yarn run dev",
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
  await launchQueue(queue, "/home/me/repo", {} as never);

  expect(boardCalled).toBe(false);
  expect(fallbackCalls).toHaveLength(1);
  expect(fallbackCalls[0]!.reason).toContain("tmux");
  const items = fallbackCalls[0]!.items as Array<{ label: string; command: string; cwd: string }>;
  expect(items).toHaveLength(2);
  expect(items[0]).toMatchObject({ label: "web → dev", cwd: "/home/me/repo/apps/web" });
  expect(items[0]!.command).not.toBe("yarn run dev");
  expect(items[0]!.command).toContain("run dev");
  expect(items[1]).toEqual({ label: "api → start (debug)", command: "node server.js", cwd: "/home/me/repo/apps/api" });
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
