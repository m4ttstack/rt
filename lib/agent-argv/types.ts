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
  /** Maps to each provider's real bypass flag (see claude.ts / codex.ts). A
      resume re-applies whatever the record stored; what a resume never does is
      re-derive it from `agent.<provider>.yolo`, so a settings change after the
      launch does not retroactively arm or disarm an existing agent. */
  yolo?: boolean;
  /** claude-only: cswap account email. */
  account?: string;
  /** claude-only: accept cross-session inbox deliveries even under bypass permissions; interactive only, see claude.ts's claudeArgs. */
  inboundAccept?: boolean;
  /** claude-only: absolute path to a --settings JSON file. */
  settingsPath?: string;
}
