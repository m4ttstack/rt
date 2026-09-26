import { describe, expect, test } from "bun:test";
import { checkRegisteredTree, findTreeByRealpath, type TreeGuardDeps } from "../tree-guard.ts";

const deps: TreeGuardDeps = {
  repoIndex: () => ({ "remote:gitlab.com%2Facme%2Fapp": "/real/app" }),
  treeByPath: (p) => (p === "/real/pool/app-1" ? { repoName: "remote:gitlab.com%2Facme%2Fapp", tree: "app-1" } : null),
  realpath: (p) => { if (p.startsWith("/nope")) throw new Error("ENOENT"); return p.replace("/link/", "/real/"); },
};

describe("checkRegisteredTree", () => {
  test("accepts a registered checkout and a registered worktree, by realpath", () => {
    expect(checkRegisteredTree("/link/app", deps)).toEqual({ ok: true, path: "/real/app", repoName: "remote:gitlab.com%2Facme%2Fapp" });
    expect(checkRegisteredTree("/link/pool/app-1", deps)).toEqual({ ok: true, path: "/real/pool/app-1", repoName: "remote:gitlab.com%2Facme%2Fapp" });
  });
  test("refuses an unregistered directory, a relative path, a non-string and a missing path", () => {
    for (const bad of ["/real/other", "app", 3, undefined, "/nope/x"]) {
      const r = checkRegisteredTree(bad, deps);
      expect(r.ok, String(bad)).toBe(false);
    }
    expect((checkRegisteredTree("/real/other", deps) as { error: string }).error).toContain("registered");
  });
  test("a subdirectory of a registered tree is refused with a message naming the root", () => {
    const r = checkRegisteredTree("/link/app/src", deps);
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toContain("root");
    expect((r as { error: string }).error).toContain("registered");
  });
});

describe("findTreeByRealpath", () => {
  const realpath = (p: string) => {
    if (p === "/gone/app-2") throw new Error("ENOENT");
    return p.replace("/link/", "/real/");
  };
  const byRepo = {
    "remote:gitlab.com%2Facme%2Fapp": [
      { name: "app-1", path: "/link/pool/app-1" },
      { name: "app-2", path: "/gone/app-2" },
    ],
  };

  test("resolves an alias record to its realpath match", () => {
    expect(findTreeByRealpath("/real/pool/app-1", byRepo, realpath)).toEqual({
      repoName: "remote:gitlab.com%2Facme%2Fapp",
      tree: "app-1",
    });
  });

  test("skips a record whose path throws", () => {
    expect(findTreeByRealpath("/gone/app-2", byRepo, realpath)).toBeNull();
  });

  test("returns null when nothing matches", () => {
    expect(findTreeByRealpath("/real/pool/app-9", byRepo, realpath)).toBeNull();
  });
});
