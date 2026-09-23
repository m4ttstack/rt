import { beforeAll, describe, expect, test } from "bun:test";
import { execSync } from "child_process";
import { mkdtempSync, realpathSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { mergeCleanupGap } from "../worktree/merge-cleanup-gap.ts";

const repoName = "remote:github.com%2Fo%2Fr";
let repo: string;

beforeAll(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), "rtgap-")));
  execSync("git init -q -b main && git remote add origin https://github.com/o/r.git", { cwd: repo, shell: "/bin/zsh" });
});

const tracked = { [repoName]: { mode: "poll" as const, caches: ["branches" as const] } };

describe("mergeCleanupGap", () => {
  test("an unreadable secrets store still reports a missing branches grant", async () => {
    expect(await mergeCleanupGap(repoName, repo, {}, null)).toEqual({ reason: "no-branches-grant", forge: "github", mode: "off", caches: [] });
  });

  test("an unreadable secrets store never claims the token is missing", async () => {
    expect(await mergeCleanupGap(repoName, repo, tracked, null)).toBeNull();
  });

  test("unreadable tracking still reports a missing token", async () => {
    expect(await mergeCleanupGap(repoName, repo, null, {})).toEqual({ reason: "no-token", forge: "github" });
  });

  test("tracked with a token has no gap", async () => {
    expect(await mergeCleanupGap(repoName, repo, tracked, { githubToken: "ghp" })).toBeNull();
  });
});
