// src/board-secrets.ts: the board's client for the rt daemon's token-gated
// `secrets:read` verb (scope "board"). Mirrors deck's src/edge/rt-secrets.ts
// pattern verbatim -- see that file for the fuller rationale. Summary:
//
// HOME is resolved at CALL time via `process.env.HOME ?? homedir()`, never
// at module load, so a test's HOME fake (or a real HOME change mid-process)
// is always honored.
//
// Four failure shapes, because they call for different fixes: daemon
// unreachable (socket down, or no api-token file yet) points at
// `rt daemon start`; a gate refusal (bad/missing token) points at the token
// file; an old daemon that predates the "board" scope entirely refuses the
// verb itself with "unknown command" (pre-verb) or the scope with
// "bad-scope" (pre-scope) -- both point at updating rt. Missing keys inside
// an otherwise-normal ok:true response is NOT a failure here: that's the
// legitimate not-configured state, left for the caller's own guard to skip
// quietly.
//
// Unlike deck, no ok:true-with-partial-keys "old daemon" heuristic: board's
// gitlabToken overlaps "extension" scope's own gitlabToken, so presence/
// absence can never discriminate old-daemon from nothing-configured here --
// a daemon this old would report slack/switchboard keys as simply not
// configured rather than "update rt" (accepted; the real pre-scope path is
// bad-scope, handled above).
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { rtCommand, type RtResponse } from "@mattstack/rt-client";

export interface BoardSecretsData {
  slackToken?: string;
  slackClientSecret?: string;
  slackSigningSecret?: string;
  gitlabToken?: string;
  switchboardToken?: string;
  switchboardAdminToken?: string;
}

export type BoardSecretsResult = ({ ok: true } & BoardSecretsData) | { ok: false; message: string };

export interface BoardSecretsDeps {
  readApiToken?: () => string;
  post?: (payload: { token: string; scope: "board" }) => Promise<RtResponse<BoardSecretsData>>;
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

function defaultPost(payload: { token: string; scope: "board" }): Promise<RtResponse<BoardSecretsData>> {
  return rtCommand<BoardSecretsData>("secrets:read", payload, { sockPath: sockPath(), timeoutMs: 15_000 });
}

function causeOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const DAEMON_DOWN_MESSAGE = "board secrets need the rt daemon — rt daemon start";
const UPDATE_RT_MESSAGE = "the rt daemon predates the board scope — update rt and restart the daemon";
// rtCommand never throws -- it collapses transport failures into
// `{ ok:false, error: "rt daemon unreachable at <sock>: <cause>" }` itself.
// That prefix is the only signal left distinguishing "never got a
// response" from "the daemon responded and refused" once it's just a string.
const UNREACHABLE_PREFIX = "rt daemon unreachable at";

export async function readBoardSecrets(deps: BoardSecretsDeps = {}): Promise<BoardSecretsResult> {
  const readApiToken = deps.readApiToken ?? defaultReadApiToken;
  const post = deps.post ?? defaultPost;

  let token: string;
  try {
    token = readApiToken();
  } catch (err) {
    // Path/cause only -- the token itself never appears in an fs error.
    return { ok: false, message: `${DAEMON_DOWN_MESSAGE} (${causeOf(err)})` };
  }

  let res: RtResponse<BoardSecretsData>;
  try {
    res = await post({ token, scope: "board" });
  } catch (err) {
    // Path/cause only -- the token travels in the request body, never in a
    // fetch/connect error.
    return { ok: false, message: `${DAEMON_DOWN_MESSAGE} (${causeOf(err)})` };
  }

  if (!res.ok) {
    const err = res.error ?? "unknown";
    if (err.startsWith(UNREACHABLE_PREFIX)) return { ok: false, message: `${DAEMON_DOWN_MESSAGE} (${err})` };
    // A daemon that predates secrets:read entirely refuses the verb itself,
    // not the scope -- caught here BEFORE the bad-scope/token checks below,
    // which all assume the daemon at least recognized the command.
    if (err.startsWith("unknown command")) return { ok: false, message: UPDATE_RT_MESSAGE };
    if (err === "bad-scope") return { ok: false, message: UPDATE_RT_MESSAGE };
    if (err === "bad-token" || err === "missing-token") {
      return {
        ok: false,
        message: `rt daemon refused the secrets request (${err}) — check ~/.mattstack/rt/api-token`,
      };
    }
    // Some other daemon-side failure (e.g. a 500): surface it verbatim --
    // the api-token advice above would misdirect a fix for this one.
    return { ok: false, message: `rt daemon refused the secrets request: ${err}` };
  }

  return { ok: true, ...(res.data ?? {}) };
}
