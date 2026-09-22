import { describe, expect, it } from "bun:test";
import { makeSandbox } from "../../test-support/sandbox.ts";
import { createGitClient } from "../index.ts";

async function commit(sb: Awaited<ReturnType<typeof makeSandbox>>, file: string, content: string, message: string): Promise<string> {
  await sb.write(file, content);
  await sb.commitAll(message);
  return (await sb.git(["rev-parse", "HEAD"])).trim();
}

describe("commits()", () => {
  it("loads history newest first with short shas, parents, and identities", async () => {
    const sb = await makeSandbox();
    try {
      const first = await commit(sb, "a.txt", "1\n", "first");
      await commit(sb, "a.txt", "2\n", "second");
      const commits = await createGitClient(sb.dir).commits("HEAD", 100);
      expect(commits.map((c) => c.summary)).toEqual(["second", "first"]);
      expect(commits[1]!.sha).toBe(first);
      expect(commits[1]!.shortSha).toBe(first.slice(0, commits[1]!.shortSha.length));
      expect(commits[1]!.parentSHAs).toEqual([]);
      expect(commits[0]!.parentSHAs).toEqual([first]);
      expect(commits[0]!.author.email).toBe("test@example.com");
      expect(commits[0]!.authoredByCommitter).toBe(true);
      expect(commits[0]!.isMergeCommit).toBe(false);
    } finally {
      await sb.cleanup();
    }
  });

  it("parses tags, including a tag whose name contains a comma", async () => {
    const sb = await makeSandbox();
    try {
      await commit(sb, "a.txt", "1\n", "first");
      await commit(sb, "a.txt", "2\n", "second");
      await sb.git(["tag", "important"]);
      await sb.git(["tag", "rc,one", "HEAD~1"]);
      await sb.git(["tag", "tentative", "HEAD~1"]);
      const commits = await createGitClient(sb.dir).commits("HEAD", 100);
      expect(commits[0]!.tags).toEqual(["important"]);
      expect([...commits[1]!.tags].sort()).toEqual(["rc,one", "tentative"]);
    } finally {
      await sb.cleanup();
    }
  });

  it("ignores log.showSignature", async () => {
    const sb = await makeSandbox();
    try {
      await commit(sb, "a.txt", "1\n", "first");
      await sb.git(["config", "log.showSignature", "true"]);
      expect((await createGitClient(sb.dir).commits("HEAD", 100)).length).toBe(1);
    } finally {
      await sb.cleanup();
    }
  });

  it("an unborn HEAD yields an empty history", async () => {
    const sb = await makeSandbox();
    try {
      expect(await createGitClient(sb.dir).commits("HEAD", 100)).toEqual([]);
    } finally {
      await sb.cleanup();
    }
  });

  it("limit and skip page through history", async () => {
    const sb = await makeSandbox();
    try {
      for (const n of [1, 2, 3]) await commit(sb, "a.txt", `${n}\n`, `c${n}`);
      const client = createGitClient(sb.dir);
      expect((await client.commits("HEAD", 1, 1)).map((c) => c.summary)).toEqual(["c2"]);
      expect((await client.commits("HEAD", 100, 3)).length).toBe(0);
    } finally {
      await sb.cleanup();
    }
  });

  it("reads co-author trailers and flags a merge commit", async () => {
    const sb = await makeSandbox();
    try {
      await commit(sb, "a.txt", "1\n", "base");
      await sb.git(["checkout", "-b", "feature"]);
      await sb.write("f.txt", "f\n");
      await sb.git(["add", "-A"]);
      await sb.git(["commit", "-m", "feature work", "-m", "Co-authored-by: Sam <sam@example.com>"]);
      await sb.git(["checkout", "main"]);
      await commit(sb, "m.txt", "m\n", "main work");
      await sb.git(["merge", "--no-ff", "feature", "-m", "merge feature"]);
      const commits = await createGitClient(sb.dir).commits("HEAD", 100);
      expect(commits[0]!.isMergeCommit).toBe(true);
      const feature = commits.find((c) => c.summary === "feature work")!;
      expect(feature.coAuthors).toEqual([{ name: "Sam", email: "sam@example.com" }]);
    } finally {
      await sb.cleanup();
    }
  });

  // Port of GHD's log-revision-exclusions-test.ts.
  it("preserves revision inclusion when additional arguments exclude remotes", async () => {
    const sb = await makeSandbox();
    try {
      await commit(sb, "file.txt", "shared\n", "shared");
      await sb.git(["update-ref", "refs/remotes/origin/main", "HEAD"]);
      await sb.git(["update-ref", "refs/remotes/--remote/base", "HEAD"]);
      const first = await commit(sb, "file.txt", "first\n", "local first");
      const second = await commit(sb, "file.txt", "second\n", "local second");
      await sb.git(["update-ref", "refs/heads/--local", "HEAD"]);
      const client = createGitClient(sb.dir);

      for (const revision of ["HEAD", "--local", "--remote/base..HEAD"]) {
        for (const additionalArgs of [
          ["--not", "--remotes"],
          ["--not", "--remotes=origin"],
          ["--not", "--remotes=origin", "--not", "--tags"],
        ]) {
          const commits = await client.commits(revision, undefined, undefined, additionalArgs);
          expect(commits.map((c) => ({ sha: c.sha, summary: c.summary }))).toEqual([
            { sha: second, summary: "local second" },
            { sha: first, summary: "local first" },
          ]);
        }
        const paginated = await client.commits(revision, 1, 1, ["--grep=local", "--not", "--remotes=origin"]);
        expect(paginated.map((c) => c.sha)).toEqual([first]);
      }
    } finally {
      await sb.cleanup();
    }
  });
});

describe("localCommits()", () => {
  it("with an upstream, returns upstream..branch", async () => {
    const sb = await makeSandbox();
    try {
      await sb.addBareRemote();
      await commit(sb, "a.txt", "1\n", "pushed");
      await sb.git(["push", "-u", "origin", "main"]);
      await commit(sb, "a.txt", "2\n", "local one");
      await commit(sb, "a.txt", "3\n", "local two");
      const local = await createGitClient(sb.dir).localCommits({ name: "main", upstream: "origin/main" });
      expect(local.map((c) => c.summary)).toEqual(["local two", "local one"]);
    } finally {
      await sb.cleanup();
    }
  });

  it("without an upstream, returns commits no remote has", async () => {
    const sb = await makeSandbox();
    try {
      await sb.addBareRemote();
      await commit(sb, "a.txt", "1\n", "pushed");
      await sb.git(["push", "origin", "main"]);
      await sb.git(["checkout", "-b", "topic"]);
      await commit(sb, "a.txt", "2\n", "unpublished");
      const local = await createGitClient(sb.dir).localCommits({ name: "topic", upstream: null });
      expect(local.map((c) => c.summary)).toEqual(["unpublished"]);
    } finally {
      await sb.cleanup();
    }
  });

  it("a null branch (detached or unborn) yields []", async () => {
    const sb = await makeSandbox();
    try {
      await commit(sb, "a.txt", "1\n", "only");
      expect(await createGitClient(sb.dir).localCommits(null)).toEqual([]);
    } finally {
      await sb.cleanup();
    }
  });
});
