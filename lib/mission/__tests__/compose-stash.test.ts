import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MissionDriver } from "../driver.ts";
import type { MissionModel } from "../model.ts";
import { LiveSession, makeSandbox, realDeps, type Sandbox } from "./compose-harness.ts";

async function start(sandbox: Sandbox): Promise<{ session: LiveSession; seed: MissionModel; stop: () => Promise<void> }> {
  const session = new LiveSession();
  const opened: MissionModel[] = [];
  const driver = new MissionDriver(realDeps(sandbox, session, (m) => opened.push(m)), { repo: "sandbox", worktree: sandbox.dir });
  const run = driver.run();
  const deadline = Date.now() + 5_000;
  while (opened.length === 0) {
    if (Date.now() > deadline) throw new Error("driver never opened the session");
    await new Promise((r) => setTimeout(r, 25));
  }
  return {
    session,
    seed: opened[0]!,
    stop: async () => {
      session.send({ t: "intent", name: "quit" });
      await run;
    },
  };
}

async function desktopStashes(sandbox: Sandbox): Promise<string[]> {
  const out = await sandbox.git(["log", "-g", "--format=%gs", "refs/stash", "--"]).catch(() => "");
  return out.split("\n").filter((l) => l.includes("!!GitHub_Desktop<"));
}

async function seeded(): Promise<Sandbox> {
  const sandbox = await makeSandbox();
  await sandbox.write("a.txt", "1\n2\n3\n4\n5\n");
  await sandbox.git(["add", "-A"]);
  await sandbox.git(["commit", "-m", "init"]);
  return sandbox;
}

describe("mission compose: stash against a real repo", () => {
  test("Stash All Changes, the view, and Restore land in git", async () => {
    const sandbox = await seeded();
    try {
      await sandbox.write("a.txt", "1\n2\n3\n4\nfive\n");
      await sandbox.write("u.txt", "untracked\n");
      const { session, seed, stop } = await start(sandbox);
      expect(seed.canStash).toBe(true);
      expect(seed.stash).toBeNull();

      let m = await session.step({ t: "intent", name: "mission:stash", payload: {} });
      expect(m.stash?.branch).toBe("main");
      expect(m.changes).toEqual([]);
      expect(existsSync(join(sandbox.dir, "u.txt"))).toBe(false);
      expect(await desktopStashes(sandbox)).toEqual(["On main: !!GitHub_Desktop<main>"]);

      m = await session.step({ t: "intent", name: "mission:stash-select", payload: {} });
      expect(m.stash?.showing).toBe(true);
      expect(m.stash?.files?.map((f) => f.path).sort()).toEqual(["a.txt", "u.txt"]);
      expect(m.diff.readOnly).toBe(true);
      expect(m.stash!.selectedFile).not.toBe("");
      expect(m.diff.path).toBe(m.stash!.selectedFile);

      m = await session.step({ t: "intent", name: "mission:stash-restore", payload: { sha: m.stash!.sha } });
      expect(m.stash).toBeNull();
      expect(readFileSync(join(sandbox.dir, "a.txt"), "utf8")).toBe("1\n2\n3\n4\nfive\n");
      expect(existsSync(join(sandbox.dir, "u.txt"))).toBe(true);
      expect(await desktopStashes(sandbox)).toEqual([]);
      await stop();
    } finally {
      await sandbox.cleanup();
    }
  }, 30_000);

  test("a second Stash All Changes leaves one entry, and Discard drops it", async () => {
    const sandbox = await seeded();
    try {
      await sandbox.write("a.txt", "first\n");
      const { session, stop } = await start(sandbox);
      await session.step({ t: "intent", name: "mission:stash", payload: {} });
      await sandbox.write("a.txt", "second\n");
      await session.step({ t: "intent", name: "mission:refresh", payload: {} });
      let m = await session.step({ t: "intent", name: "mission:stash", payload: {} });
      expect(await desktopStashes(sandbox)).toEqual(["On main: !!GitHub_Desktop<main>"]);
      m = await session.step({ t: "intent", name: "mission:stash-discard", payload: { sha: m.stash!.sha } });
      expect(m.stash).toBeNull();
      expect(await desktopStashes(sandbox)).toEqual([]);
      await stop();
    } finally {
      await sandbox.cleanup();
    }
  }, 30_000);

  test("a stash whose old-entry drop fails keeps the new stash and names the drop", async () => {
    const sandbox = await seeded();
    // git's reflog rewrite needs a lock file beside the log; the append a stash push makes does not.
    const reflogDir = join(sandbox.dir, ".git", "logs", "refs");
    try {
      await sandbox.write("a.txt", "first\n");
      const { session, stop } = await start(sandbox);
      await session.step({ t: "intent", name: "mission:stash", payload: {} });
      await sandbox.write("a.txt", "second\n");
      await session.step({ t: "intent", name: "mission:refresh", payload: {} });
      chmodSync(reflogDir, 0o555);
      const m = await session.step({ t: "intent", name: "mission:stash", payload: {} });
      chmodSync(reflogDir, 0o755);
      expect(m.notice).toStartWith("Your changes were stashed, but the previous stash could not be removed:");
      expect(m.changes).toEqual([]);
      expect(await desktopStashes(sandbox)).toHaveLength(2);
      await stop();
    } finally {
      chmodSync(reflogDir, 0o755);
      await sandbox.cleanup();
    }
  }, 30_000);

  test("switching with changes asks once, and Leave stashes on the old branch", async () => {
    const sandbox = await seeded();
    try {
      await sandbox.git(["branch", "other"]);
      await sandbox.write("a.txt", "dirty\n");
      const { session, stop } = await start(sandbox);

      let m = await session.step({ t: "intent", name: "mission:checkout", payload: { branch: "other" } });
      expect(m.switchPrompt).toEqual({ seq: 1, branch: "other", current: "main", hasStash: false });
      expect((await sandbox.git(["branch", "--show-current"])).trim()).toBe("main");
      m = await session.step({ t: "intent", name: "mission:refresh", payload: {} });
      expect(m.switchPrompt).toBeNull();

      m = await session.step({ t: "intent", name: "mission:checkout", payload: { branch: "other", strategy: "leave" } });
      expect(m.current.branch).toBe("other");
      expect(m.changes).toEqual([]);
      expect(m.stash).toBeNull();
      expect(await desktopStashes(sandbox)).toEqual(["On main: !!GitHub_Desktop<main>"]);

      m = await session.step({ t: "intent", name: "mission:checkout", payload: { branch: "main" } });
      expect(m.switchPrompt).toBeNull();
      expect(m.current.branch).toBe("main");
      expect(m.stash?.branch).toBe("main");
      await stop();
    } finally {
      await sandbox.cleanup();
    }
  }, 30_000);

  test("a Leave whose checkout fails shows the clean-tree card, not the stashed file's header", async () => {
    const sandbox = await seeded();
    try {
      await sandbox.write("a.txt", "dirty\n");
      const { session, seed, stop } = await start(sandbox);
      expect(seed.diff.path).toBe("a.txt");

      const m = await session.step({ t: "intent", name: "mission:checkout", payload: { branch: "no-such-branch", strategy: "leave" } });
      expect(m.notice).not.toBe("");
      expect(m.current.branch).toBe("main");
      expect(m.stash?.branch).toBe("main");
      expect(m.changes).toEqual([]);
      expect(m.diff.kind).toBe("none");
      expect(m.diff.path).toBe("");
      await stop();
    } finally {
      await sandbox.cleanup();
    }
  }, 30_000);

  test("Bring carries changes through a temporary stash when checkout would overwrite them", async () => {
    const sandbox = await seeded();
    try {
      await sandbox.git(["checkout", "-b", "other"]);
      await sandbox.write("a.txt", "ONE\n2\n3\n4\n5\n");
      await sandbox.git(["commit", "-am", "other edits line 1"]);
      await sandbox.git(["checkout", "main"]);
      await sandbox.write("a.txt", "1\n2\n3\n4\nFIVE\n");
      const { session, stop } = await start(sandbox);

      const m = await session.step({ t: "intent", name: "mission:checkout", payload: { branch: "other", strategy: "bring" } });
      expect(m.current.branch).toBe("other");
      expect(readFileSync(join(sandbox.dir, "a.txt"), "utf8")).toBe("ONE\n2\n3\n4\nFIVE\n");
      expect(await desktopStashes(sandbox)).toEqual([]);
      await stop();
    } finally {
      await sandbox.cleanup();
    }
  }, 30_000);

  test("a detached HEAD never asks and brings the changes", async () => {
    const sandbox = await seeded();
    try {
      await sandbox.git(["branch", "other"]);
      await sandbox.git(["checkout", "--detach"]);
      await sandbox.write("a.txt", "dirty\n");
      const { session, seed, stop } = await start(sandbox);
      expect(seed.canStash).toBe(false);
      const m = await session.step({ t: "intent", name: "mission:checkout", payload: { branch: "other" } });
      expect(m.switchPrompt).toBeNull();
      expect(m.current.branch).toBe("other");
      expect(readFileSync(join(sandbox.dir, "a.txt"), "utf8")).toBe("dirty\n");
      await stop();
    } finally {
      await sandbox.cleanup();
    }
  }, 30_000);

  test("a stash made behind the driver's back shows after a git-status sweep", async () => {
    const sandbox = await seeded();
    try {
      const { session, seed, stop } = await start(sandbox);
      expect(seed.stash).toBeNull();
      await sandbox.write("a.txt", "elsewhere\n");
      await sandbox.git(["stash", "push", "-m", "!!GitHub_Desktop<main>"]);
      const m = await session.sweep();
      expect(m.stash?.branch).toBe("main");
      await stop();
    } finally {
      await sandbox.cleanup();
    }
  }, 30_000);
});
