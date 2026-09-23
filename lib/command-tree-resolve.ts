/**
 * Alias-aware tree walking with no TUI imports, so lib/mcp can resolve a verb
 * without loading lib/command-tree.ts (which pulls in the terminal UI).
 */
import type { CommandNode } from "./command-tree.ts";

export function lookupChild(tree: Record<string, CommandNode>, name: string): { key: string; node: CommandNode } | null {
  if (Object.hasOwn(tree, name)) return { key: name, node: tree[name]! };
  for (const [key, node] of Object.entries(tree)) {
    if (node.aliases?.includes(name)) return { key, node };
  }
  return null;
}

/** Walks from args[0] only; the first arg that names no child ends the path. */
export function resolveLeaf(
  tree: Record<string, CommandNode>,
  args: string[],
): { node: CommandNode; path: string[]; rest: string[] } | null {
  let level = tree;
  let node: CommandNode | null = null;
  const path: string[] = [];
  let i = 0;
  while (i < args.length) {
    const hit = lookupChild(level, args[i]!);
    if (!hit) break;
    node = hit.node;
    path.push(hit.key);
    i++;
    if (!hit.node.subcommands) break;
    level = hit.node.subcommands;
  }
  return node ? { node, path, rest: args.slice(i) } : null;
}

export function listAgentSafe(tree: Record<string, CommandNode>, prefix: string[] = []): { path: string[]; node: CommandNode }[] {
  return Object.entries(tree).flatMap(([key, node]) => {
    const path = [...prefix, key];
    if (node.subcommands) return listAgentSafe(node.subcommands, path);
    return node.agentSafe ? [{ path, node }] : [];
  });
}
