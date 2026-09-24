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
import { MissionDriver } from "../driver.ts";
import type { MissionModel } from "../model.ts";
import { LiveSession, makeSandbox, realDeps } from "./compose-harness.ts";

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
