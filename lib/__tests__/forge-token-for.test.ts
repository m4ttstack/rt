import { describe, expect, test } from "bun:test";
import { execSync } from "child_process";
import { mkdtempSync, realpathSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { defaultBranchOf, forgeTokenFor } from "../enrich.ts";

function sh(cmd: string, cwd: string): void {
  execSync(cmd, { cwd, shell: "/bin/zsh", stdio: "pipe" });
}

describe("defaultBranchOf", () => {
  test("reads origin/HEAD when the clone set it", () => {
    const src = realpathSync(mkdtempSync(join(tmpdir(), "rtdb-src-")));
    sh("git init -q -b trunk && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init", src);
    const clone = realpathSync(mkdtempSync(join(tmpdir(), "rtdb-clone-")));
    sh(`git clone -q ${src} .`, clone);
    return expect(defaultBranchOf(clone)).resolves.toBe("trunk");
  });

  test("falls back to origin/main when origin/HEAD was never set", () => {
    const src = realpathSync(mkdtempSync(join(tmpdir(), "rtdb-src-")));
    sh("git init -q -b main && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init", src);
    const repo = realpathSync(mkdtempSync(join(tmpdir(), "rtdb-add-")));
    sh(`git init -q -b work && git remote add origin ${src} && git fetch -q origin`, repo);
    return expect(defaultBranchOf(repo)).resolves.toBe("main");
  });
});

describe("forgeTokenFor", () => {
  test("a GitLab remote reads the stored gitlabToken", async () => {
    expect(await forgeTokenFor("git@gitlab.com:team/repo.git", { gitlabToken: "glpat" })).toEqual({ forge: "gitlab", token: "glpat" });
  });

  test("a GitLab remote with no token names the gap", async () => {
    expect(await forgeTokenFor("https://gitlab.com/team/repo.git", {})).toEqual({ forge: "gitlab", token: null });
  });

  test("a GitHub remote prefers the stored githubToken", async () => {
    expect(await forgeTokenFor("https://github.com/o/r.git", { githubToken: "ghp" })).toEqual({ forge: "github", token: "ghp" });
  });

  test("a GitHub remote with no token and no gh session names the gap", async () => {
    expect(await forgeTokenFor("git@github.com:o/r.git", {})).toEqual({ forge: "github", token: null });
  });

  test("a remote on neither forge is null", async () => {
    expect(await forgeTokenFor("https://example.com/o/r.git", { githubToken: "ghp" })).toBeNull();
    expect(await forgeTokenFor(undefined, {})).toBeNull();
  });
});
