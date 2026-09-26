import { err, type McpToolDef, type ToolResult } from "./shared.ts";

/** Forge payloads can carry live credentials (avatar URLs with a
    private_token query, remotes with oauth2:<token>@, tokens in job traces).
    Every tool result passes through here on its way into an agent
    transcript, so this is the one place a credential is stopped, whichever
    tool or field carried it. Strings are redacted before serialization:
    after JSON.stringify an escaped quote or \n sits against the value and
    the patterns would either eat the escape or miss the token. The
    lookbehinds and length caps keep every pattern linear on large traces. */
const URL_USERINFO = /(?<![a-z0-9+.-])([a-z][a-z0-9+.-]{0,31}):\/\/([^/\s"'@?#]{1,512})@/gi;
const CREDENTIAL_PARAM = /([?&;](?:private_token|access_token|job_token|oauth_token|feed_token|token|api_key|apikey|sig)=)[^&\s"'#\\<>]{1,2048}/gi;
const TOKEN_SHAPE = /(?<![A-Za-z0-9])(?:glpat|gldt|glrt|glptt|glcbt|glft|glsoat|gloas|glimt|glagent|glffct|glwt|ghp|gho|ghu|ghs|ghr|github_pat)[-_][A-Za-z0-9_-]{16,512}/g;
const CREDENTIAL_HEADER = /\b(PRIVATE-TOKEN|JOB-TOKEN|Authorization)(:[ \t]*)[^\r\n]{1,2048}/gi;

export function redactCredentials(text: string): string {
  return text
    .replace(URL_USERINFO, (whole, scheme: string, info: string) =>
      scheme.toLowerCase().startsWith("http") || info.includes(":") ? `${scheme}://[redacted]@` : whole)
    .replace(CREDENTIAL_PARAM, "$1[redacted]")
    .replace(TOKEN_SHAPE, "[redacted]")
    .replace(CREDENTIAL_HEADER, "$1$2[redacted]");
}

export function redactDeep(value: unknown): unknown {
  if (typeof value === "string") return redactCredentials(value);
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value !== null && typeof value === "object" && typeof (value as { toJSON?: unknown }).toJSON === "function") {
    return redactDeep((value as { toJSON: () => unknown }).toJSON());
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[redactCredentials(k)] = redactDeep(v);
    return out;
  }
  return value;
}

type CallResult = { isError?: true; content: Array<{ type: "text"; text: string }> };

export function toCallResult(res: ToolResult): CallResult {
  if (!res.ok) return { isError: true, content: [{ type: "text", text: redactCredentials(res.error ?? "failed") }] };
  return { content: [{ type: "text", text: JSON.stringify(redactDeep(res.body ?? null)) }] };
}

/** A throw inside a handler would otherwise reach the SDK, which sends its
    message to the client as a JSON-RPC error without passing through here. */
export async function callTool(tool: McpToolDef, args: Record<string, unknown>, env: NodeJS.ProcessEnv): Promise<CallResult> {
  try {
    return toCallResult(await tool.handler(args, env));
  } catch (e) {
    return toCallResult(err(e instanceof Error ? e.message : String(e)));
  }
}
