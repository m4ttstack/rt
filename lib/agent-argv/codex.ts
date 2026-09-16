/**
 * lib/agent-argv/codex.ts -- codex CLI invocation building for `rt agent`.
 *
 * Confirmed against the installed codex-cli 0.153.4's own --help output, not
 * from memory. Usage lines: `codex exec [OPTIONS] [PROMPT]`,
 * `codex exec resume [OPTIONS] [SESSION_ID] [PROMPT]`, `codex [OPTIONS]
 * [PROMPT]`, `codex resume [OPTIONS] [SESSION_ID] [PROMPT]` -- flags always
 * precede positionals, matching the order this file emits them.
 *
 * codex mints its own session id and never accepts an externally chosen one
 * (see lib/daemon/handlers/agent.ts's session-id capture for how the real id
 * gets learned after the fact), so unlike claude.ts's builder this one never
 * emits inv.session.sessionId on start -- only resume takes it, positionally.
 */

import { homedir } from "os";
import { join } from "path";
import { shellSingleQuote } from "./claude.ts";
import type { AgentInvocation } from "./types.ts";

export function resolveCodexBin(): string {
  return Bun.which("codex") ?? join(process.env.HOME ?? homedir(), ".local", "bin", "codex");
}

/** Flags shared by every codex form (exec, exec resume, interactive, interactive resume). */
function codexFlags(inv: AgentInvocation): string[] {
  const args: string[] = [];
  if (inv.model) args.push("-m", inv.model);
  // codex has no dedicated --effort flag; model_reasoning_effort is a config
  // override (-c key=value), confirmed via `codex exec --help`'s -c examples.
  if (inv.effort) args.push("-c", `model_reasoning_effort=${inv.effort}`);
  if (inv.yolo) args.push("--dangerously-bypass-approvals-and-sandbox");
  if (inv.extraArgs) args.push(...inv.extraArgs.split(/\s+/).filter(Boolean));
  return args;
}

export function buildCodexArgv(inv: AgentInvocation, bins?: { codex?: string }): string[] {
  if (inv.headless && !inv.prompt) {
    throw new Error("headless launch requires a prompt (codex exec with no prompt blocks on stdin)");
  }
  const bin = bins?.codex ?? resolveCodexBin();
  const flags = codexFlags(inv);
  // --json is gated on inv.headless, mirroring claude.ts's claudeArgs gating
  // "-p --output-format json" the same way -- this function is also exercised
  // with headless: false in tests (matching buildClaudeArgv's own "plain
  // start, pane surface" test), so --json must not be unconditional.
  const jsonFlag = inv.headless ? ["--json"] : [];
  const args = inv.session.kind === "start"
    ? [bin, "exec", ...jsonFlag, ...flags]
    : [bin, "exec", "resume", ...jsonFlag, ...flags, inv.session.sessionId];
  if (inv.prompt) args.push(inv.prompt);
  return args;
}

export function buildCodexPaneCommand(cwd: string, inv: AgentInvocation): string {
  const flags = codexFlags(inv).map(shellSingleQuote);
  const head = inv.session.kind === "start"
    ? ["codex", ...flags]
    : ["codex", "resume", ...flags, shellSingleQuote(inv.session.sessionId)];
  const tail = inv.prompt ? [shellSingleQuote(inv.prompt)] : [];
  const env = Object.entries(inv.env ?? {}).map(([k, v]) => `${k}=${shellSingleQuote(v)}`);
  return `cd ${shellSingleQuote(cwd)} && ${[...env, ...head, ...tail].join(" ")}`;
}
