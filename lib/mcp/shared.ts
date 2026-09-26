/**
 * Helpers shared by every MCP tool module (lib/mcp/tools.ts, run-tools.ts).
 * No MCP SDK import here, and no import of commands/herd.ts or
 * commands/chat.ts (both pull in TUI-adjacent modules that lib/mcp must
 * stay clear of).
 */
import { herdList } from "../../packages/rt-client/src/index.ts";
import type { RtResponse } from "../../packages/rt-client/src/index.ts";
import { explainError } from "../explain-error.ts";

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler(input: Record<string, unknown>, env: NodeJS.ProcessEnv): Promise<{ ok: boolean; body: unknown; error?: string }>;
}

export type ToolResult = { ok: boolean; body: unknown; error?: string };

export function ok(body: unknown): ToolResult {
  return { ok: true, body };
}

export function err(message: string): ToolResult {
  return { ok: false, body: undefined, error: message };
}

/** Runs a daemon error through explainError before returning it, so every
    tool in the roster gets the same CLI-shaped prose instead of a bare code
    (RT-172), not just the mr tools that happen to hit worktree verbs. An
    error explainError does not recognize passes through unchanged. */
export function fromResponse<T>(res: RtResponse<T>): ToolResult {
  return res.ok ? ok(res.data) : err(explainError(res.error ?? "request failed"));
}

export type FieldType = "string" | "number" | "boolean" | "object" | "array";

/** The server does not validate input against inputSchema, so a wrong-shaped
    required field must return an error rather than throw. */
export function checkRequired(input: Record<string, unknown>, fields: Array<{ name: string; type: FieldType }>): string | undefined {
  for (const f of fields) {
    const v = input[f.name];
    if (v === undefined || v === null) return `"${f.name}" is required`;
    if (f.type === "array" && !Array.isArray(v)) return `"${f.name}" must be an array`;
    else if (f.type === "object" && (typeof v !== "object" || Array.isArray(v))) return `"${f.name}" must be an object`;
    else if ((f.type === "string" || f.type === "number" || f.type === "boolean") && typeof v !== f.type) return `"${f.name}" must be a ${f.type}`;
  }
  return undefined;
}

/** Optional fields get the same check: a string "false" must never read as true. */
export function checkOptional(input: Record<string, unknown>, fields: Array<{ name: string; type: "string" | "number" | "boolean" }>): string | undefined {
  for (const f of fields) {
    const v = input[f.name];
    if (v !== undefined && typeof v !== f.type) return `"${f.name}" must be a ${f.type}`;
  }
  return undefined;
}

/** mr:action only checks typeof on jobId/pipelineId, so 0, negative, fractional or NaN
    would otherwise reach the forge as a 404 instead of a clear input error. iid gets the
    same check inside resolveMrTarget. */
export function checkPositiveInts(input: Record<string, unknown>, names: string[]): string | undefined {
  for (const name of names) {
    const v = input[name];
    if (v === undefined) continue;
    if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) return `"${name}" must be a positive integer`;
  }
  return undefined;
}

export function checkStringArray(input: Record<string, unknown>, name: string): string | undefined {
  const v = input[name];
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) return `"${name}" must be an array of strings`;
  return undefined;
}

export const HERD_ENV_ERROR = "HERD_ID and HERD_JOB are not set; this verb runs inside a herd worker pane";

/** Matches lib/daemon-client.ts's DISCUSSIONS_TIMEOUT_MS: a GitLab write is
    slower than rtCommand's 15s default, and a client-side abort here would
    still leave the daemon writing, so a retry would duplicate the write.
    Shared by every mr write tool for that reason. */
export const MR_WRITE_TIMEOUT_MS = 30_000;

export const REPO_NAME_RULE = "Name the target with repoName (the repo's serialized identity, e.g. remote:gitlab.com%2Facme%2Facme-dev, an absolute path to a local checkout or worktree, or a repo label that matches exactly one registered repo) or with mrUrl (the MR's https URL, which also supplies iid; its project must be registered with rt). Given both, they must agree.";

export const MR_TARGET_PROPS = {
  repoName: { type: "string", description: "Serialized identity, absolute checkout or worktree path, or a label matching exactly one registered repo." },
  iid: { type: "number", description: "The MR's iid; omit when mrUrl is given, which supplies it." },
  mrUrl: { type: "string", description: "The MR's https URL; supplies both the repo and iid." },
};

export const REPO_TARGET_PROPS = {
  repoName: MR_TARGET_PROPS.repoName,
  mrUrl: { type: "string", description: "An MR URL in the target project; names the repo, its iid is not used." },
};

/** A timed-out or gateway-timed-out create or post may still land daemon-side (see
    MR_WRITE_TIMEOUT_MS); the pattern also matches GitLab's own wording (e.g. "504 Gateway Timeout"). */
export function withLandingHint(res: ToolResult, check: string): ToolResult {
  if (res.ok || !/timed ?out|timeout/i.test(res.error ?? "")) return res;
  return err(`${res.error}; the write may still land, so check ${check} before retrying`);
}

export function requireJobEnv(env: NodeJS.ProcessEnv): { herd: string; job: string } | { error: string } {
  const herd = env.HERD_ID, job = env.HERD_JOB;
  if (!herd || !job) return { error: HERD_ENV_ERROR };
  return { herd, job };
}

export function requireWorkerEnv(env: NodeJS.ProcessEnv): { herd: string; job: string; session: string; pane?: string } | { error: string } {
  const j = requireJobEnv(env);
  if ("error" in j) return j;
  const session = env.CLAUDE_CODE_SESSION_ID;
  if (!session) return { error: "CLAUDE_CODE_SESSION_ID is not set; this verb runs inside a Claude Code session" };
  return { ...j, session, ...(env.HERDR_PANE_ID && { pane: env.HERDR_PANE_ID }) };
}

/** Mirrors herd.ts's soleHerdId without importing it (that module pulls in lib/repo-arg.ts). */
export async function resolveSoleHerd(): Promise<{ herd: string } | { error: string }> {
  const res = await herdList({});
  if (!res.ok) return { error: res.error ?? "rt daemon unreachable" };
  const herds = res.data?.herds ?? [];
  if (herds.length === 0) return { error: "no herds are active (rt herd list shows the herds)" };
  if (herds.length === 1) return { herd: herds[0]!.id };
  return { error: "more than one herd is active (rt herd list shows the herds)" };
}
