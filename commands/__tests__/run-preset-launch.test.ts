import { afterEach, test, expect, mock } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { presetToSeed, launchPreset, resolveRun } from "../run.ts";
import { savePreset, type Preset } from "../../lib/run-presets.ts";
import { deriveRepoIdentity } from "../../lib/settings/identity.ts";
import { __test__ as gate } from "../../lib/ui/gate.ts";

/** A real repo with a neutral remote, so deriveRepoIdentity yields a remote
    identity presets can be saved under (savePreset(null) refuses). */
function makeRemoteRepoFixture(container: string): string {
  const root = join(container, "fixture");
  mkdirSync(root, { recursive: true });
  for (const args of [["init", "-q"], ["remote", "add", "origin", "https://example.com/acme/fixture.git"]]) {
    const r = Bun.spawnSync(["git", "-C", root, ...args]);
    if (r.exitCode !== 0) throw new Error(`git ${args[0]} failed: ${r.stderr.toString()}`);
  }
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fixture" }));
  mkdirSync(join(root, "apps", "web"), { recursive: true });
  writeFileSync(join(root, "apps", "web", "package.json"), JSON.stringify({ name: "web", scripts: { dev: "vite" } }));
  return root;
}

async function savePresetFor(root: string, name: string): Promise<void> {
  const ident = await deriveRepoIdentity(root);
  if (ident.kind !== "remote") throw new Error(`fixture identity not remote: ${ident.kind}`);
  const res = savePreset(ident.id, { name, entries: [{ packageRelPath: "apps/web", packageLabel: "web", script: "dev" }] });
  if (!res.ok) throw new Error(`savePreset failed: ${"reason" in res ? res.reason : ""}`);
}

// mock.module mutates the live module namespace object IN PLACE (matches
// commands/__tests__/worktree.test.ts), so the real bindings must be
// captured BEFORE any mock.module call in this file, and restored with
// THOSE, not a fresh re-import of the module specifier.
//
// They are COPIES for that same reason: holding the namespace itself hands
// the restore an object the mock has already overwritten, so the stub
// outlives afterEach and leaks to every later suite in the process. A
// mocked herdrAvailable then answers true without touching a socket, and
// lib/herdr's own test sees an empty `seen`.
const realHerdrClient = { ...(await import("../../lib/herdr/client.ts")) };
const realHerdrLaunch = { ...(await import("../../lib/herdr-launch.ts")) };
const realRunner = { ...(await import("../runner.ts")) };

afterEach(() => {
  gate.setInteractive(undefined);
  mock.module("../../lib/herdr/client.ts", () => realHerdrClient);
  mock.module("../../lib/herdr-launch.ts", () => realHerdrLaunch);
  mock.module("../runner.ts", () => realRunner);
});

test("presetToSeed maps preset entries to seed entries", () => {
  const preset = {
    name: "backend-lite",
    entries: [
      { packageRelPath: "apps/web", packageLabel: "web", script: "dev" },
      {
        packageRelPath: "apps/api",
        packageLabel: "api",
        script: "start",
        command: "node server.js",
      },
    ],
  };
  const seed = presetToSeed(preset, "/home/me/repo");
  expect(seed).toEqual([
    {
      name: "dev",
      command: expect.stringContaining("run dev"),
      cwd: "/home/me/repo/apps/web",
      pkg: "web",
      repo: "repo",
    },
    {
      name: "start",
      command: "node server.js",
      cwd: "/home/me/repo/apps/api",
      pkg: "api",
      repo: "repo",
    },
  ]);
});

// Pins the regression: launchPreset used to route on herdrAvailable() alone,
// so a non-interactive caller (piped stdin, RT_BATCH) with the herdr daemon
// up hit the board's own `if (!interactive())` gate and hard-exited instead
// of ever reaching launchFallback.
test("non-interactive caller with herdr available falls back instead of routing to the board", async () => {
  gate.setInteractive(() => false);

  const fallbackCalls: unknown[][] = [];
  let boardCalled = false;
  mock.module("../../lib/herdr/client.ts", () => ({
    ...realHerdrClient,
    herdrAvailable: async () => true,
  }));
  mock.module("../../lib/herdr-launch.ts", () => ({
    ...realHerdrLaunch,
    launchFallback: (items: unknown[]) => {
      fallbackCalls.push(items);
    },
  }));
  mock.module("../runner.ts", () => ({
    ...realRunner,
    runSeededBoard: async () => {
      boardCalled = true;
    },
  }));

  const preset: Preset = {
    name: "backend-lite",
    entries: [
      { packageRelPath: "apps/web", packageLabel: "web", script: "dev" },
    ],
  };

  const exitSpy = mock(() => {
    throw new Error("unexpected exit");
  });
  const realExit = process.exit;
  process.exit = exitSpy as never;
  try {
    await launchPreset(preset, "/home/me/repo", {} as never);
  } finally {
    process.exit = realExit;
  }

  expect(fallbackCalls).toHaveLength(1);
  expect(boardCalled).toBe(false);
  expect(exitSpy).not.toHaveBeenCalled();
});

// Pins the fix for the nested-board bug: a live board's resolve used to hit
// launchPreset, which opened a SECOND seeded board on the tmux default --
// silently abandoning a --herdr board's bg server and leaking its claim.
// Under the board option the preset resolves to seed entries for the board
// that asked.
test("resolveRun with a preset arg under the board option returns seed entries and never nests a board", async () => {
  gate.setInteractive(() => true);
  let boardCalled = false;
  mock.module("../runner.ts", () => ({
    ...realRunner,
    tmuxAvailable: () => true,
    runSeededBoard: async () => { boardCalled = true; },
  }));

  const container = mkdtempSync(join(tmpdir(), "rt-run-board-seed-"));
  const root = makeRemoteRepoFixture(container);
  await savePresetFor(root, "board-seed-preset");

  try {
    const ctx = {
      identity: { repoName: "fixture", identity: "board-seed-fixture", repoRoot: root, dataDir: "", remoteUrl: "", baseUrl: "" },
    } as never;
    const res = await resolveRun(["board-seed-preset"], ctx, { board: true });
    expect(res.kind).toBe("seed");
    if (res.kind === "seed") {
      expect(res.entries).toEqual(presetToSeed({ name: "board-seed-preset", entries: [{ packageRelPath: "apps/web", packageLabel: "web", script: "dev" }] }, root));
    }
    expect(boardCalled).toBe(false);
  } finally {
    rmSync(container, { recursive: true, force: true });
  }
});

test("resolveRun with a preset arg WITHOUT the board option still launches the seeded board (CLI path pinned)", async () => {
  gate.setInteractive(() => true);
  let boardCalled = false;
  mock.module("../runner.ts", () => ({
    ...realRunner,
    tmuxAvailable: () => true,
    runSeededBoard: async () => { boardCalled = true; },
  }));

  const container = mkdtempSync(join(tmpdir(), "rt-run-cli-preset-"));
  const root = makeRemoteRepoFixture(container);
  await savePresetFor(root, "cli-path-preset");

  try {
    const ctx = {
      identity: { repoName: "fixture", identity: "cli-path-fixture", repoRoot: root, dataDir: "", remoteUrl: "", baseUrl: "" },
    } as never;
    const res = await resolveRun(["cli-path-preset"], ctx);
    expect(res.kind).toBe("launched");
    expect(boardCalled).toBe(true);
  } finally {
    rmSync(container, { recursive: true, force: true });
  }
});
