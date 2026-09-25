import { describe, expect, it, test } from "bun:test";
import { rename, symlink, unlink } from "node:fs/promises";
import { makeSandbox } from "../../test-support/sandbox.ts";
import { createGitClient } from "../index.ts";
import { rawGit } from "../exec.ts";
import { DiffSelection, DiffSelectionType } from "../vendor/ghd/diff-selection.ts";
import type { DiffHunk } from "../vendor/ghd/raw-diff.ts";

// The sandbox's `git()` helper has no stdin, but simulating a concurrent
// commit on `old.txt` needs `mktree`/`commit-tree`, which read the tree
// entries / commit message from it.
async function gitWithStdin(dir: string, args: string[], input: string): Promise<string> {
  const proc = Bun.spawn(["git", ...args], { cwd: dir, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  proc.stdin.write(input);
  proc.stdin.end();
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`git ${args.join(" ")} exited ${code}: ${err || out}`);
  return out;
}

function selectLine(hunks: ReadonlyArray<DiffHunk>, text: string, selection: DiffSelection): DiffSelection {
  for (const hunk of hunks) {
    const i = hunk.lines.findIndex((l) => l.text === text);
    if (i !== -1) return selection.withLineSelection(hunk.unifiedDiffStart + i, true);
  }
  throw new Error(`line ${text} not found in hunks`);
}

test("rawGit stdin pipes to the child and closes", async () => {
  const sb = await makeSandbox();
  try {
    const sha = await rawGit(sb.dir, ["hash-object", "--stdin"], { stdin: "hello\n" });
    expect(sha.trim()).toBe("ce013625030ba8dba906f756967f9e9ca394464a");
  } finally {
    await sb.cleanup();
  }
});

describe("stagingDiff / stageSelection / discardSelection", () => {
  it("1. stages one added line out of several, leaves the other unstaged", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("f.txt", "a\nb\nc\n");
      await sb.commitAll("base");
      await sb.write("f.txt", "a\nX\nb\nY\nc\n");
      const client = createGitClient(sb.dir);

      const diff = await client.stagingDiff("f.txt");
      const selection = selectLine(diff.hunks, "+X", DiffSelection.fromInitialSelection(DiffSelectionType.None));
      await client.stageSelection(diff, selection);

      const staged = await sb.git(["diff", "--cached"]);
      expect(staged).toContain("+X");
      expect(staged).not.toContain("+Y");
      const unstaged = await sb.git(["diff"]);
      expect(unstaged).toContain("+Y");
      expect(unstaged).not.toContain("+X");
    } finally {
      await sb.cleanup();
    }
  });

  it("2a. stages all lines of an untracked file", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("n.txt", "one\ntwo\nthree\n");
      const client = createGitClient(sb.dir);

      const diff = await client.stagingDiff("n.txt");
      expect(diff.untracked).toBe(true);
      await client.stageSelection(diff, DiffSelection.fromInitialSelection(DiffSelectionType.All));

      const nameStatus = await sb.git(["diff", "--cached", "--name-status"]);
      expect(nameStatus.trim()).toBe("A\tn.txt");
    } finally {
      await sb.cleanup();
    }
  });

  it("2b. stages a single selected line of an untracked file as a 1-line blob", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("n.txt", "one\ntwo\nthree\n");
      const client = createGitClient(sb.dir);

      const diff = await client.stagingDiff("n.txt");
      const selection = selectLine(diff.hunks, "+one", DiffSelection.fromInitialSelection(DiffSelectionType.None));
      await client.stageSelection(diff, selection);

      const cachedBlob = await sb.git(["show", ":n.txt"]);
      expect(cachedBlob).toBe("one\n");
    } finally {
      await sb.cleanup();
    }
  });

  it("3. discards one line, leaves the other as an unstaged change", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("f.txt", "a\nb\nc\n");
      await sb.commitAll("base");
      await sb.write("f.txt", "a\nX\nb\nY\nc\n");
      const client = createGitClient(sb.dir);

      const diff = await client.stagingDiff("f.txt");
      const selection = selectLine(diff.hunks, "+Y", DiffSelection.fromInitialSelection(DiffSelectionType.None));
      await client.discardSelection(diff, selection);

      const content = await Bun.file(`${sb.dir}/f.txt`).text();
      expect(content).toBe("a\nX\nb\nc\n");
      const unstaged = await sb.git(["diff"]);
      expect(unstaged).toContain("+X");
    } finally {
      await sb.cleanup();
    }
  });

  it("4. no-newline file roundtrips through stage with the marker preserved", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("nn.txt", "a\nb");
      await sb.commitAll("base");
      await sb.write("nn.txt", "a\nc");
      const client = createGitClient(sb.dir);

      const diff = await client.stagingDiff("nn.txt");
      await client.stageSelection(diff, DiffSelection.fromInitialSelection(DiffSelectionType.All));

      const cached = await sb.git(["diff", "--cached"]);
      expect(cached).toContain("\\ No newline at end of file");
      const status = await sb.git(["status", "--porcelain"]);
      expect(status.trim()).toBe("M  nn.txt");
    } finally {
      await sb.cleanup();
    }
  });

  it("5. rename pre-stage stages the rename plus the edit", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("old.txt", "a\nb\nc\n");
      await sb.commitAll("base");
      await sb.git(["mv", "old.txt", "new.txt"]);
      await sb.write("new.txt", "a\nB\nc\n");
      const client = createGitClient(sb.dir);

      const diff = await client.stagingDiff("new.txt");
      expect(diff.untracked).toBe(false);
      await client.stageSelection(diff, DiffSelection.fromInitialSelection(DiffSelectionType.All), {
        originalPath: "old.txt",
      });

      const nameStatus = await sb.git(["diff", "--cached", "--name-status", "-M"]);
      expect(nameStatus).toMatch(/^R\d*\told\.txt\tnew\.txt$/m);
      const cachedShow = await sb.git(["show", ":new.txt"]);
      expect(cachedShow).toBe("a\nB\nc\n");
    } finally {
      await sb.cleanup();
    }
  });

  it("5b. refuses originalPath staging against an untracked (fs-renamed, not git-mv'd) diff", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("old.txt", "a\nb\nc\n");
      await sb.commitAll("base");
      // Plain filesystem rename, not `git mv`: old.txt is a tracked
      // deletion, new.txt is untracked, so getStagingDiff computes the
      // new.txt diff against /dev/null rather than old.txt's content.
      await rename(`${sb.dir}/old.txt`, `${sb.dir}/new.txt`);
      await sb.write("new.txt", "a\nB\nc\n");
      const client = createGitClient(sb.dir);

      const diff = await client.stagingDiff("new.txt");
      expect(diff.untracked).toBe(true);

      const beforeCached = await sb.git(["diff", "--cached", "--name-status"]);
      await expect(
        client.stageSelection(diff, DiffSelection.fromInitialSelection(DiffSelectionType.All), {
          originalPath: "old.txt",
        }),
      ).rejects.toThrow(/new\.txt/);

      const afterCached = await sb.git(["diff", "--cached", "--name-status"]);
      expect(afterCached).toBe(beforeCached);
    } finally {
      await sb.cleanup();
    }
  });

  it("5c. refuses a rename whose source was only ever staged, never committed, without touching the index", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("base.txt", "base\n");
      await sb.commitAll("base");
      await sb.write("old.txt", "a\nb\nc\n");
      await sb.git(["add", "old.txt"]);
      await sb.git(["mv", "old.txt", "new.txt"]);
      const client = createGitClient(sb.dir);

      const diff = await client.stagingDiff("new.txt");
      expect(diff.untracked).toBe(false);

      const beforeCached = await sb.git(["diff", "--cached", "--name-status"]);
      await expect(
        client.stageSelection(diff, DiffSelection.fromInitialSelection(DiffSelectionType.All), {
          originalPath: "old.txt",
        }),
      ).rejects.toThrow(/rename source not in HEAD/);

      const afterCached = await sb.git(["diff", "--cached", "--name-status"]);
      expect(afterCached).toBe(beforeCached);
    } finally {
      await sb.cleanup();
    }
  });

  it("5d. rolls back the pre-staged rename atomically when the content patch is stale", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("old.txt", "a\nb\nc\n");
      await sb.commitAll("base");
      await sb.git(["mv", "old.txt", "new.txt"]);
      await sb.write("new.txt", "a\nB\nc\n");
      const client = createGitClient(sb.dir);

      const diff = await client.stagingDiff("new.txt");
      expect(diff.untracked).toBe(false);

      // Simulate old.txt's blob changing at HEAD concurrently (another
      // process landing a commit) between the diff capture above and the
      // stageSelection call below -- a `git apply --cached` failure can
      // only happen here because a `--unidiff-zero` patch checks the exact
      // deleted line, not the working tree, which stageSelection never
      // reads. Rewriting the working tree copy of old.txt after capture
      // (as opposed to its committed blob) would have no effect on the
      // patch's base and could never make it stale.
      await sb.write("old.txt", "a\nZ\nc\nextra\n");
      const blobSha = (await sb.git(["hash-object", "-w", "old.txt"])).trim();
      const newTree = (await gitWithStdin(sb.dir, ["mktree"], `100644 blob ${blobSha}\told.txt\n`)).trim();
      const headSha = (await sb.git(["rev-parse", "HEAD"])).trim();
      const newCommit = (
        await gitWithStdin(sb.dir, ["commit-tree", newTree, "-p", headSha, "-m", "concurrent"], "")
      ).trim();
      await sb.git(["update-ref", "HEAD", newCommit]);

      const beforeSnapshot = await sb.git(["ls-files", "-s", "--", "old.txt", "new.txt"]);
      await expect(
        client.stageSelection(diff, DiffSelection.fromInitialSelection(DiffSelectionType.All), {
          originalPath: "old.txt",
        }),
      ).rejects.toThrow();

      const afterSnapshot = await sb.git(["ls-files", "-s", "--", "old.txt", "new.txt"]);
      expect(afterSnapshot).toBe(beforeSnapshot);
    } finally {
      await sb.cleanup();
    }
  });

  it("6. refuses to line-stage a binary file", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("a.txt", "a\n");
      await sb.commitAll("base");
      await Bun.write(`${sb.dir}/bin.dat`, new Uint8Array([0, 1, 2, 255, 0]));
      const client = createGitClient(sb.dir);

      const diff = await client.stagingDiff("bin.dat");
      expect(diff.kind).toBe("binary");
      await expect(
        client.stageSelection(diff, DiffSelection.fromInitialSelection(DiffSelectionType.All)),
      ).rejects.toThrow(/bin\.dat/);
    } finally {
      await sb.cleanup();
    }
  });

  it("7. refuses to discard on an untracked file", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("u.txt", "one\ntwo\n");
      const client = createGitClient(sb.dir);

      const diff = await client.stagingDiff("u.txt");
      expect(diff.untracked).toBe(true);
      await expect(
        client.discardSelection(diff, DiffSelection.fromInitialSelection(DiffSelectionType.All)),
      ).rejects.toThrow(/u\.txt/);
    } finally {
      await sb.cleanup();
    }
  });

  // rt adopts GitHub Desktop's own staging model wholesale (ratified
  // 2026-09-21): the diff pane always shows a modified file's FULL change
  // (git diff HEAD), staged or not, because "staged" is no longer a
  // separate concept the display tracks -- it's purely the user's commit
  // SELECTION now. This is the real-repo defect that started the round:
  // a fully staged file's diff used to be worktree-vs-index (empty, by
  // definition, once nothing is left unstaged).
  it("8a. a FULLY staged modified file's diff shows its full change, not empty", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("f.txt", "a\nb\nc\n");
      await sb.commitAll("base");
      await sb.write("f.txt", "a\nB\nc\n");
      await sb.git(["add", "-A"]);
      const client = createGitClient(sb.dir);

      const diff = await client.stagingDiff("f.txt");
      expect(diff.hunks.length).toBeGreaterThan(0);
      const text = diff.hunks.flatMap((h) => h.lines.map((l) => l.text));
      expect(text).toContain("+B");
      expect(text).toContain("-b");
    } finally {
      await sb.cleanup();
    }
  });

  it("8b. a PARTIALLY staged file's diff shows staged and unstaged changes together", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("f.txt", "a\nb\nc\nd\n");
      await sb.commitAll("base");
      await sb.write("f.txt", "a\nB\nc\nd\n"); // b -> B
      await sb.git(["add", "-A"]); // stage the b->B edit
      await sb.write("f.txt", "a\nB\nc\nD\n"); // further, unstaged: d -> D
      const client = createGitClient(sb.dir);

      const diff = await client.stagingDiff("f.txt");
      const text = diff.hunks.flatMap((h) => h.lines.map((l) => l.text));
      expect(text).toContain("+B"); // the staged edit
      expect(text).toContain("-b");
      expect(text).toContain("+D"); // the unstaged edit
      expect(text).toContain("-d");
    } finally {
      await sb.cleanup();
    }
  });

  it("8c. a FULLY staged deletion still shows the deletion, not an empty diff (the same bug class as 8a, for deletes)", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("gone.txt", "bye\n");
      await sb.commitAll("base");
      await sb.git(["rm", "gone.txt"]); // deletes from disk AND stages the removal in one step
      const client = createGitClient(sb.dir);

      const diff = await client.stagingDiff("gone.txt");
      const text = diff.hunks.flatMap((h) => h.lines.map((l) => l.text));
      expect(text).toContain("-bye");
    } finally {
      await sb.cleanup();
    }
  });

  it("8d. a renamed file's diff still compares against the index, not HEAD (GHD's own acknowledged compromise)", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("old.txt", "a\nb\nc\n");
      await sb.commitAll("base");
      await sb.git(["mv", "old.txt", "new.txt"]); // stages the rename
      await sb.write("new.txt", "a\nB\nc\n"); // further, unstaged content edit
      const client = createGitClient(sb.dir);

      const diff = await client.stagingDiff("new.txt");
      // Index-based: only the unstaged b->B edit shows, not the rename
      // itself (which git diff -- new.txt never shows regardless -- the
      // rename is a name change, not a content line).
      const text = diff.hunks.flatMap((h) => h.lines.map((l) => l.text));
      expect(text).toContain("+B");
      expect(text).toContain("-b");
    } finally {
      await sb.cleanup();
    }
  });

  it("9a. stageFileFully stages a plain modified file's full content", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("f.txt", "a\nb\n");
      await sb.commitAll("base");
      await sb.write("f.txt", "a\nB\n");
      const client = createGitClient(sb.dir);

      await client.stageFileFully("f.txt");

      const cached = await sb.git(["show", ":f.txt"]);
      expect(cached).toBe("a\nB\n");
    } finally {
      await sb.cleanup();
    }
  });

  it("9b. stageFileFully stages an (unstaged) deletion", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("gone.txt", "bye\n");
      await sb.commitAll("base");
      await unlink(`${sb.dir}/gone.txt`); // an unstaged worktree-only delete
      const client = createGitClient(sb.dir);

      await client.stageFileFully("gone.txt");

      const nameStatus = await sb.git(["diff", "--cached", "--name-status"]);
      expect(nameStatus.trim()).toBe("D\tgone.txt");
    } finally {
      await sb.cleanup();
    }
  });

  it("9c. stageFileFully recreates a rename via its old path before adding the new one", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("old.txt", "a\nb\n");
      await sb.commitAll("base");
      await sb.git(["mv", "old.txt", "new.txt"]);
      await sb.git(["reset", "HEAD", "--", "old.txt", "new.txt"]); // unstage the rename (as a fresh reset --mixed HEAD would)
      const client = createGitClient(sb.dir);

      await client.stageFileFully("new.txt", "old.txt");

      const nameStatus = await sb.git(["diff", "--cached", "--name-status", "-M"]);
      expect(nameStatus).toMatch(/^R\d*\told\.txt\tnew\.txt$/m);
    } finally {
      await sb.cleanup();
    }
  });

  it("10. a file replaced by a symlink diffs as its delete then its add, and stages whole", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("f.txt", "one\ntwo\n");
      await sb.write("other.txt", "x\n");
      await sb.commitAll("base");
      await unlink(`${sb.dir}/f.txt`);
      await symlink("other.txt", `${sb.dir}/f.txt`);
      const client = createGitClient(sb.dir);

      const diff = await client.stagingDiff("f.txt", { withSources: true });

      expect(diff.kind).toBe("text");
      expect(diff.typechange).toBe(true);
      expect(diff.hunks.flatMap((h) => h.lines.map((l) => l.text))).toEqual([
        "@@ -1,2 +0,0 @@", "-one", "-two",
        "@@ -0,0 +1 @@", "+other.txt",
      ]);
      const starts = diff.hunks.flatMap((h) => h.lines.map((_, i) => h.unifiedDiffStart + i));
      expect(new Set(starts).size).toBe(starts.length);
      expect(diff.sources?.old).toBe("one\ntwo\n");
      expect(diff.sources?.new).toBeUndefined();

      await client.stageFileFully("f.txt");
      const raw = await sb.git(["diff", "--cached", "--raw"]);
      expect(raw).toMatch(/^:100644 120000 \S+ \S+ T\tf\.txt$/m);
    } finally {
      await sb.cleanup();
    }
  });

  it("10a. an ordinary diff is not flagged as a typechange", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("f.txt", "a\n");
      await sb.commitAll("base");
      await sb.write("f.txt", "b\n");
      const diff = await createGitClient(sb.dir).stagingDiff("f.txt");
      expect(diff.typechange).toBeUndefined();
    } finally {
      await sb.cleanup();
    }
  });
});
