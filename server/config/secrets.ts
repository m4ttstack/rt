// server/config/secrets.ts: reads GITLAB_TOKEN and LINEAR_API_KEY, preferring
// env vars and falling back to the rt daemon's token-gated `secrets:read`
// verb (scope "extension"). Mirrors board's src/board-secrets.ts pattern --
// see that file for the fuller rationale. Summary:
//
// HOME is resolved at CALL time via `process.env.HOME ?? homedir()`, never
// at module load, so a test's HOME fake (or a real HOME change mid-process)
// is always honored.
//
// Unlike board's readBoardSecrets, a daemon failure here is not fatal: the
// caller runs with whatever env supplied and a one-line warning, never a
// thrown error -- boxscore keeps serving without GitLab/Linear configured
// rather than refusing to start.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { rtCommand, type RtResponse } from "@mattstack/rt-client";

interface ExtensionSecrets {
  gitlabToken?: string;
  linearApiKey?: string;
}

export interface SecretsResult {
  gitlabToken?: string;
  linearApiKey?: string;
  /** Present when the daemon path failed; the caller logs it once and runs as not-configured. */
  warning?: string;
}

export interface SecretsDeps {
  readApiToken?: () => string;
  post?: (payload: { token: string; scope: "extension" }) => Promise<RtResponse<ExtensionSecrets>>;
}

function home(): string {
  return process.env.HOME ?? homedir();
}

function apiTokenPath(): string {
  return join(home(), ".mattstack", "rt", "api-token");
}

function sockPath(): string {
  return join(home(), ".mattstack", "rt", "rt.sock");
}

function defaultReadApiToken(): string {
  return readFileSync(apiTokenPath(), "utf8").trim();
}

function defaultPost(payload: { token: string; scope: "extension" }): Promise<RtResponse<ExtensionSecrets>> {
  return rtCommand<ExtensionSecrets>("secrets:read", payload, { sockPath: sockPath(), timeoutMs: 15_000 });
}

function causeOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const DAEMON_DOWN_MESSAGE = "secrets need the rt daemon — rt daemon start";
const UPDATE_RT_MESSAGE = "the rt daemon predates the extension scope — update rt and restart the daemon";
// rtCommand never throws -- it collapses transport failures into
// `{ ok:false, error: "rt daemon unreachable at <sock>: <cause>" }` itself.
// That prefix is the only signal left distinguishing "never got a
// response" from "the daemon responded and refused" once it's just a string.
const UNREACHABLE_PREFIX = "rt daemon unreachable at";

export async function readSecrets(deps: SecretsDeps = {}): Promise<SecretsResult> {
  const gitlabToken = process.env.GITLAB_TOKEN?.trim() || undefined;
  const linearApiKey = process.env.LINEAR_API_KEY?.trim() || undefined;
  if (gitlabToken && linearApiKey) return { gitlabToken, linearApiKey };

  // Never reach the real socket from a test that didn't inject a post fn.
  if (process.env.VITEST && !deps.post) return { gitlabToken, linearApiKey };

  const readApiToken = deps.readApiToken ?? defaultReadApiToken;
  const post = deps.post ?? defaultPost;

  let apiToken: string;
  try {
    apiToken = readApiToken();
  } catch (err) {
    // Path/cause only -- the token itself never appears in an fs error.
    return { gitlabToken, linearApiKey, warning: `${DAEMON_DOWN_MESSAGE} (${causeOf(err)})` };
  }

  let res: RtResponse<ExtensionSecrets>;
  try {
    res = await post({ token: apiToken, scope: "extension" });
  } catch (err) {
    // Path/cause only -- the token travels in the request body, never in a
    // fetch/connect error.
    return { gitlabToken, linearApiKey, warning: `${DAEMON_DOWN_MESSAGE} (${causeOf(err)})` };
  }

  if (!res.ok) {
    const err = res.error ?? "unknown";
    let warning: string;
    if (err.startsWith(UNREACHABLE_PREFIX)) warning = `${DAEMON_DOWN_MESSAGE} (${err})`;
    // A daemon that predates secrets:read entirely refuses the verb itself,
    // not the scope -- caught here BEFORE the bad-scope/token checks below,
    // which all assume the daemon at least recognized the command.
    else if (err.startsWith("unknown command")) warning = UPDATE_RT_MESSAGE;
    else if (err === "bad-scope") warning = UPDATE_RT_MESSAGE;
    else if (err === "bad-token" || err === "missing-token")
      warning = `rt daemon refused the secrets request (${err}) — check ~/.mattstack/rt/api-token`;
    // Some other daemon-side failure (e.g. a 500): surface it verbatim --
    // the api-token advice above would misdirect a fix for this one.
    else warning = `rt daemon refused the secrets request: ${err}`;
    return { gitlabToken, linearApiKey, warning };
  }

  return {
    gitlabToken: gitlabToken ?? res.data?.gitlabToken,
    linearApiKey: linearApiKey ?? res.data?.linearApiKey,
  };
}
