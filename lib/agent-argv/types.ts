export type AgentProvider = "claude" | "codex";

export interface AgentInvocation {
  model?: string;
  effort?: string;
  extraArgs?: string;
  session: { kind: "start"; sessionId: string } | { kind: "resume"; sessionId: string };
  headless: boolean;
  prompt?: string;
  /** Extra environment for the pane shell, exported before the agent head. Values are single-quoted verbatim. */
  env?: Record<string, string>;
  /** Maps to each provider's real bypass flag (see claude.ts / codex.ts). Start-time only -- never re-read on resume. */
  yolo?: boolean;
  /** claude-only: cswap account email. */
  account?: string;
  /** claude-only: reserved chat handle; interactive only, see claude.ts's claudeArgs. */
  name?: string;
  /** claude-only: absolute path to a --settings JSON file. */
  settingsPath?: string;
}
