import { describe, expect, test } from "bun:test";
import { TREE } from "../command-tree-def.ts";
import { listAgentSafe } from "../command-tree-resolve.ts";

describe("agent-safe surface", () => {
  test("every agent-safe leaf is listed here, so each addition is reviewed", () => {
    expect(listAgentSafe(TREE).map((e) => e.path.join(" ")).sort()).toEqual([
      "endpoint lookup",
      "herd status",
      "worktree list",
    ]);
  });

  test("each is a leaf that declares --json and can run without a person", () => {
    for (const { path, node } of listAgentSafe(TREE)) {
      const where = path.join(" ");
      expect(node.subcommands, where).toBeUndefined();
      expect((node.args ?? []).some((a) => a.flag === "--json"), `${where} declares --json`).toBe(true);
      expect(node.devOnly, where).toBeFalsy();
      expect(node.hidden, where).toBeFalsy();
      expect(node.requiresTTY, where).toBeFalsy();
    }
  });
});
