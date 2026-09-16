/**
 * lib/agent-argv/index.ts -- barrel + provider dispatch for `rt agent`.
 * lib/daemon/handlers/agent.ts calls buildAgentArgv/buildAgentPaneCommand
 * here instead of reaching into claude.ts or codex.ts directly.
 */
export * from "./types.ts";
export * from "./claude.ts";
export * from "./codex.ts";

import type { AgentInvocation, AgentProvider } from "./types.ts";
import { buildClaudeArgv, buildPaneCommand as buildClaudePaneCommand } from "./claude.ts";
import { buildCodexArgv, buildCodexPaneCommand } from "./codex.ts";

export function buildAgentArgv(
  provider: AgentProvider,
  inv: AgentInvocation,
  bins?: { claude?: string; cswap?: string; codex?: string },
): string[] {
  return provider === "codex" ? buildCodexArgv(inv, bins) : buildClaudeArgv(inv, bins);
}

export function buildAgentPaneCommand(provider: AgentProvider, cwd: string, inv: AgentInvocation): string {
  return provider === "codex" ? buildCodexPaneCommand(cwd, inv) : buildClaudePaneCommand(cwd, inv);
}
