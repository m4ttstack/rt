// src/edge/rt-secrets.ts: the deck-side client for the rt daemon's
// token-gated `secrets:read` verb (scope "deck"). Lazy by design -- called
// once per Access-sync, never cached, so a credential rotated via
// `rt secrets set deck cfApiToken` takes effect on the very next sync.
//
// HOME is resolved at CALL time via `process.env.HOME ?? homedir()`, per
// rt-client's settings/paths.ts convention -- NOT rt-client's own
// transport.ts DEFAULT_SOCK, which bakes `homedir()` in at module load
// (Bun caches it for the process) and can't be redirected by a test's HOME
// fake. That's why sockPath() below is always passed explicitly to
// rtCommand rather than relying on its default.
//
// Three failure shapes, because they call for different fixes:
// daemon unreachable (socket down, or no api-token file yet -- the daemon
// mints one on first start) points at `rt daemon start`; a gate refusal
// (bad/missing token) points at the token file; an old daemon points at
// updating rt itself, detected any of three ways -- a daemon old enough to
// not know the "secrets:read" verb AT ALL refuses with "unknown command"
// (pre-verb); one that knows the verb but not the "deck" scope refuses with
// "bad-scope" (pre-scope); one whose scope check silently no-ops answers
// ok:true holding only extension keys (linearApiKey / gitlabToken) and
// neither cf key. Missing keys inside an otherwise-normal ok:true response
// is NOT a failure here: that's the legitimate not-configured state, left
// for the caller's own guard to skip quietly.
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { rtCommand, type RtResponse } from "@mattstack/rt-client";

export interface DeckCfSecrets {
  cfApiToken?: string;
  cfZoneId?: string;
  railwayToken?: string;
}

interface RawDeckSecretsData extends DeckCfSecrets {
  linearApiKey?: string;
  gitlabToken?: string;
}

export type DeckSecretsResult = ({ ok: true } & DeckCfSecrets) | { ok: false; message: string };

export interface RtSecretsDeps {
  readApiToken?: () => string;
  post?: (payload: { token: string; scope: "deck" }) => Promise<RtResponse<RawDeckSecretsData>>;
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

function defaultPost(payload: { token: string; scope: "deck" }): Promise<RtResponse<RawDeckSecretsData>> {
  return rtCommand<RawDeckSecretsData>("secrets:read", payload, { sockPath: sockPath(), timeoutMs: 15_000 });
}

function causeOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const DAEMON_DOWN_MESSAGE = "Access sync needs the rt daemon — rt daemon start";
const UPDATE_RT_MESSAGE = "the rt daemon predates the deck scope — update rt and restart the daemon";
// rtCommand never throws -- it collapses transport failures into
// `{ ok:false, error: "rt daemon unreachable at <sock>: <cause>" }` itself.
// That prefix is the only signal left distinguishing "never got a
// response" from "the daemon responded and refused" once it's just a string.
const UNREACHABLE_PREFIX = "rt daemon unreachable at";

export async function readDeckSecrets(deps: RtSecretsDeps = {}): Promise<DeckSecretsResult> {
  const readApiToken = deps.readApiToken ?? defaultReadApiToken;
  const post = deps.post ?? defaultPost;

  let token: string;
  try {
    token = readApiToken();
  } catch (err) {
    // Path/cause only -- the token itself never appears in an fs error.
    return { ok: false, message: `${DAEMON_DOWN_MESSAGE} (${causeOf(err)})` };
  }

  let res: RtResponse<RawDeckSecretsData>;
  try {
    res = await post({ token, scope: "deck" });
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

  const data = res.data ?? {};
  const hasCfKeys = data.cfApiToken !== undefined || data.cfZoneId !== undefined;
  const hasExtensionKeys = data.linearApiKey !== undefined || data.gitlabToken !== undefined;
  // An old daemon (pre deck-scope) answers ok:true with the extension
  // fields it knows about and neither cf key -- indistinguishable from
  // "not configured" without this check. A real cf key always wins.
  if (!hasCfKeys && hasExtensionKeys) {
    return { ok: false, message: UPDATE_RT_MESSAGE };
  }

  return { ok: true, cfApiToken: data.cfApiToken, cfZoneId: data.cfZoneId, railwayToken: data.railwayToken };
}
