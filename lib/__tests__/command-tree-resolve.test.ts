import { describe, expect, test } from "bun:test";
import type { CommandNode } from "../command-tree.ts";
import { listAgentSafe, lookupChild, resolveLeaf } from "../command-tree-resolve.ts";
import { TREE } from "../command-tree-def.ts";

const leaf = (extra: Partial<CommandNode> = {}): CommandNode => ({ description: "x", module: "./m.ts", ...extra });

const tree: Record<string, CommandNode> = {
  worktree: {
    description: "w",
    aliases: ["wt"],
    subcommands: { list: leaf({ agentSafe: true, aliases: ["ls"] }), dispose: leaf() },
  },
  version: leaf(),
};

describe("lookupChild", () => {
  test("direct and alias names resolve to the canonical key", () => {
    expect(lookupChild(tree, "worktree")?.key).toBe("worktree");
    expect(lookupChild(tree, "wt")?.key).toBe("worktree");
    expect(lookupChild(tree, "nope")).toBeNull();
  });

  test("prototype keys never resolve", () => {
    for (const name of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      expect(lookupChild(tree, name), name).toBeNull();
      expect(resolveLeaf(tree, [name]), name).toBeNull();
    }
  });
});

describe("resolveLeaf", () => {
  test("walks to the leaf and splits off its own args", () => {
    const r = resolveLeaf(tree, ["worktree", "list", "--repo", "x"]);
    expect(r?.path).toEqual(["worktree", "list"]);
    expect(r?.rest).toEqual(["--repo", "x"]);
    expect(r?.node.agentSafe).toBe(true);
  });

  test("aliases resolve at every level and the path is canonical", () => {
    expect(resolveLeaf(tree, ["wt", "ls"])?.path).toEqual(["worktree", "list"]);
  });

  test("a branch with no matching child stops at the branch", () => {
    const r = resolveLeaf(tree, ["worktree", "bogus"]);
    expect(r?.path).toEqual(["worktree"]);
    expect(r?.node.subcommands).toBeDefined();
    expect(r?.rest).toEqual(["bogus"]);
  });

  test("an unknown first arg resolves to nothing", () => {
    expect(resolveLeaf(tree, ["nope"])).toBeNull();
    expect(resolveLeaf(tree, ["--post-install", "worktree"])).toBeNull();
  });

  test("matches the real tree's dispatch for every alias in TREE", () => {
    const walk = (level: Record<string, CommandNode>, prefix: string[]) => {
      for (const [key, node] of Object.entries(level)) {
        for (const alias of node.aliases ?? []) {
          expect(resolveLeaf(TREE, [...prefix, alias])?.path).toEqual([...prefix, key]);
        }
        if (node.subcommands) walk(node.subcommands, [...prefix, key]);
      }
    };
    walk(TREE, []);
  });
});

describe("listAgentSafe", () => {
  test("lists agent-safe leaves by canonical path", () => {
    expect(listAgentSafe(tree).map((e) => e.path)).toEqual([["worktree", "list"]]);
  });
});
