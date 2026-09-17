import { describe, expect, it } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { simpleGit } from "simple-git";

describe("simple-git under Bun", () => {
  it("spawns git and reads a version", async () => {
    const v = await simpleGit().version();
    expect(v.major).toBeGreaterThanOrEqual(2);
  });

  it("init + status works in a temp dir", async () => {
    const dir = await mkdtemp(join(tmpdir(), "git-core-smoke-"));
    const git = simpleGit({ baseDir: dir });
    await git.init(["-b", "main"]);
    const status = await git.status();
    expect(status.isClean()).toBe(true);
  });
});
