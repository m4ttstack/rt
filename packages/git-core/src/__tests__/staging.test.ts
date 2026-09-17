import { describe, expect, it, test } from "bun:test";
import { rename } from "node:fs/promises";
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
});
