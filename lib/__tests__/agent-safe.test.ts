import { describe, expect, test } from "bun:test";
import type { CommandNode } from "../command-tree.ts";
import { TREE } from "../command-tree-def.ts";
import { listAgentSafe } from "../command-tree-resolve.ts";

function flagged(tree: Record<string, CommandNode>, prefix: string[] = []): { path: string[]; node: CommandNode }[] {
  return Object.entries(tree).flatMap(([key, node]) => {
    const path = [...prefix, key];
    const below = node.subcommands ? flagged(node.subcommands, path) : [];
    return node.agentSafe === undefined ? below : [{ path, node }, ...below];
  });
}

describe("agent-safe surface", () => {
  test("every agent-safe leaf is listed here, so each addition is reviewed", () => {
    expect(listAgentSafe(TREE).map((e) => e.path.join(" ")).sort()).toEqual([
      "daemon status", "endpoint lookup", "events list", "gate list", "gate subscriptions", "git branches", "git log", "git status",
      "herd brief", "herd gates", "herd status", "pane list", "pane peek", "repos status", "runs find", "runs show",
      "settings explain", "settings get", "settings list", "setup status", "skills bind", "skills check", "skills compile",
      "skills surface", "skills sync", "skills writing-style show", "team status", "worktree await-ready", "worktree list", "worktree triage",
    ]);
  });

  test("agentSafe is set on leaves only, never on a branch", () => {
    const branch: CommandNode = { description: "b", agentSafe: true, subcommands: { leaf: { description: "l", module: "./m.ts" } } };
    expect(flagged({ branch }).map((e) => e.path.join(" "))).toEqual(["branch"]);
    for (const { path, node } of flagged(TREE)) {
      expect(node.subcommands, path.join(" ")).toBeUndefined();
    }
  });

  test("herd brief confines every caller-named path it writes or reads", () => {
    const brief = TREE.herd!.subcommands!.brief!;
    expect(brief.agentTempRootFlags).toEqual(["--out"]);
    expect([...(brief.agentReadRootFlags ?? [])].sort()).toEqual(["--method-file", "--strategies", "--template"]);
  });

  test("every confined flag names a declared text flag of its leaf", () => {
    for (const { path, node } of listAgentSafe(TREE)) {
      const textFlags = new Set((node.args ?? []).filter((a) => a.flag && a.type === "text").map((a) => a.flag));
      for (const flag of [...(node.agentTempRootFlags ?? []), ...(node.agentReadRootFlags ?? [])]) {
        expect(textFlags.has(flag), `${path.join(" ")} ${flag}`).toBe(true);
      }
    }
  });

  test("each declares --json and can run without a person", () => {
    for (const { path, node } of listAgentSafe(TREE)) {
      const where = path.join(" ");
      expect((node.args ?? []).some((a) => a.flag === "--json"), `${where} declares --json`).toBe(true);
      expect(node.devOnly, where).toBeFalsy();
      expect(node.hidden, where).toBeFalsy();
      expect(node.requiresTTY, where).toBeFalsy();
    }
  });
});
