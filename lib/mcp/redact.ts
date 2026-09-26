import type { ToolResult } from "./shared.ts";

/** Forge payloads can carry live credentials (avatar URLs with a
    private_token query, remotes with oauth2:<token>@). Every tool result
    passes through here on its way into an agent transcript, so this is the
    one place a credential is stopped, whichever tool or field carried it. */
const URL_USERINFO = /(\b[a-z][a-z0-9+.-]*:\/\/)[^/\s"'@]+@/gi;
const CREDENTIAL_PARAM = /([?&;](?:private_token|access_token|job_token|oauth_token|token|api_key|apikey)=)[^&\s"'#]+/gi;
const TOKEN_SHAPE = /\b(?:glpat|gldt|glrt|glptt|glcbt|ghp|gho|ghu|ghs|ghr|github_pat)[-_][A-Za-z0-9_-]{16,}/g;

export function redactCredentials(text: string): string {
  return text
    .replace(URL_USERINFO, "$1[redacted]@")
    .replace(CREDENTIAL_PARAM, "$1[redacted]")
    .replace(TOKEN_SHAPE, "[redacted]");
}

export function toCallResult(res: ToolResult): { isError?: true; content: Array<{ type: "text"; text: string }> } {
  if (!res.ok) return { isError: true, content: [{ type: "text", text: redactCredentials(res.error ?? "failed") }] };
  return { content: [{ type: "text", text: redactCredentials(JSON.stringify(res.body ?? null)) }] };
}
