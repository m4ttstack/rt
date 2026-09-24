import { describe, test, expect, beforeEach } from "bun:test";
import { execSync } from "child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { classifyDirtForTriage, isVersionOnlyLockDiff } from "../dirt-class.ts";
import { DEFAULT_JUNK_GLOBS } from "../config.ts";

const GIT_ID = "-c user.email=t@t -c user.name=t";
const sh = (cmd: string, cwd: string) => execSync(cmd, { cwd, shell: "/bin/zsh", stdio: "pipe" }).toString();

const LOCK = `{
  "workspaces": {
    "packages/rt-client": {
      "name": "@mattstack/rt-client",
      "version": "0.28.0",
      "dependencies": {
        "jsonc-parser": "^3.3.1",
      },
    },
  },
}
`;

describe("classifyDirtForTriage", () => {
  let tree: string;
  beforeEach(() => {
    tree = realpathSync(mkdtempSync(join(tmpdir(), "rtdirt-")));
    sh("git init -q -b main .", tree);
    writeFileSync(join(tree, "bun.lock"), LOCK);
    writeFileSync(join(tree, "src.ts"), "export {}\n");
    sh(`git add -A && git ${GIT_ID} commit -q -m init`, tree);
  });

  test("a clean tree is none", async () => {
    expect((await classifyDirtForTriage(tree, DEFAULT_JUNK_GLOBS)).kind).toBe("none");
  });

  test("an untracked screenshot folder is junk and discardable", async () => {
    mkdirSync(join(tree, ".visual"));
    writeFileSync(join(tree, ".visual", "a.png"), "x");
    const d = await classifyDirtForTriage(tree, DEFAULT_JUNK_GLOBS);
    expect(d.kind).toBe("junk");
    expect(d.discardable).toEqual([".visual/a.png"]);
  });

  test("build output for a package the branch doesn't have is junk", async () => {
    for (const p of ["packages/tenant/node_modules/x/index.js", "packages/tenant/.turbo/turbo-build.log", "packages/tenant/build/index.js"]) {
      mkdirSync(join(tree, p, ".."), { recursive: true });
      writeFileSync(join(tree, p), "x");
    }
    expect((await classifyDirtForTriage(tree, DEFAULT_JUNK_GLOBS)).kind).toBe("junk");
  });

  test("an untracked folder with one source file among the build output is real", async () => {
    mkdirSync(join(tree, "packages/tenant/build"), { recursive: true });
    writeFileSync(join(tree, "packages/tenant/build/index.js"), "x");
    writeFileSync(join(tree, "packages/tenant/index.ts"), "x");
    const d = await classifyDirtForTriage(tree, DEFAULT_JUNK_GLOBS);
    expect(d.kind).toBe("real");
    expect(d.discardable).toEqual([]);
  });

  test("a bun.lock whose only change is a workspace version line is lockfile", async () => {
    writeFileSync(join(tree, "bun.lock"), LOCK.replace('"version": "0.28.0"', '"version": "0.29.0"'));
    const d = await classifyDirtForTriage(tree, DEFAULT_JUNK_GLOBS);
    expect(d.kind).toBe("lockfile");
    expect(d.discardable).toEqual(["bun.lock"]);
  });

  test("a bun.lock that changes a dependency range is real", async () => {
    writeFileSync(join(tree, "bun.lock"), LOCK.replace("^3.3.1", "^3.4.0"));
    expect((await classifyDirtForTriage(tree, DEFAULT_JUNK_GLOBS)).kind).toBe("real");
  });

  test("a lockfile change plus junk is still discardable, as lockfile", async () => {
    writeFileSync(join(tree, "bun.lock"), LOCK.replace('"version": "0.28.0"', '"version": "0.29.0"'));
    mkdirSync(join(tree, ".visual"));
    writeFileSync(join(tree, ".visual", "a.png"), "x");
    const d = await classifyDirtForTriage(tree, DEFAULT_JUNK_GLOBS);
    expect(d.kind).toBe("lockfile");
    expect(d.discardable.sort()).toEqual([".visual/a.png", "bun.lock"]);
  });

  test("a modified source file is real", async () => {
    writeFileSync(join(tree, "src.ts"), "export const a = 1\n");
    expect((await classifyDirtForTriage(tree, DEFAULT_JUNK_GLOBS)).kind).toBe("real");
  });

  test("a junk file whose name has spaces is reported by its real path", async () => {
    mkdirSync(join(tree, ".visual"));
    writeFileSync(join(tree, ".visual", "my shot.png"), "x");
    const d = await classifyDirtForTriage(tree, DEFAULT_JUNK_GLOBS);
    expect(d.kind).toBe("junk");
    expect(d.discardable).toEqual([".visual/my shot.png"]);
  });
});

describe("isVersionOnlyLockDiff", () => {
  test("accepts only +/- version lines", () => {
    expect(isVersionOnlyLockDiff('@@ -5 +5 @@\n-      "version": "0.28.0",\n+      "version": "0.29.0",\n')).toBe(true);
    expect(isVersionOnlyLockDiff('@@ -8 +8 @@\n-        "jsonc-parser": "^3.3.1",\n+        "jsonc-parser": "^3.4.0",\n')).toBe(false);
    expect(isVersionOnlyLockDiff("")).toBe(false);
  });
});
