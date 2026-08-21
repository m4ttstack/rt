// src/edge/rt-secrets.ts: the deck-side client for the rt daemon's
// token-gated `secrets:read` verb (scope "deck"). Lazy by design -- called
// once per Access-sync, never cached, so a credential rotated via
// `rt secrets set deck cfApiToken` takes effect on the very next sync.
//
// Two distinct failure shapes, because they call for different fixes:
// daemon unreachable (socket down, or no api-token file yet -- the daemon
// mints one on first start) points the caller at `rt daemon start`; a
// response the daemon actively sent back with ok:false (bad/missing token,
// wrong scope) points at the token file instead. Missing keys inside an
// ok:true response is NOT a failure here -- that's the legitimate
// not-configured state, left for the caller's own guard to skip quietly.
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export interface DeckCfSecrets {
  cfApiToken?: string;
  cfZoneId?: string;
}

export type DeckSecretsResult = ({ ok: true } & DeckCfSecrets) | { ok: false; message: string };

interface RtSecretsResponse {
  ok: boolean;
  data?: DeckCfSecrets;
  error?: string;
}

export interface RtSecretsDeps {
  readApiToken?: () => string;
  post?: (payload: { token: string; scope: "deck" }) => Promise<RtSecretsResponse>;
}

const API_TOKEN_PATH = join(homedir(), ".mattstack", "rt", "api-token");
const SOCK_PATH = join(homedir(), ".mattstack", "rt", "rt.sock");
const DAEMON_DOWN_MESSAGE = "Access sync needs the rt daemon — rt daemon start";

function defaultReadApiToken(): string {
  return readFileSync(API_TOKEN_PATH, "utf8").trim();
}

async function defaultPost(payload: { token: string; scope: "deck" }): Promise<RtSecretsResponse> {
  const res = await fetch("http://rt/secrets:read", {
    unix: SOCK_PATH,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    // Bun's `unix` fetch option isn't in the standard RequestInit type.
  } as RequestInit);
  return (await res.json()) as RtSecretsResponse;
}

export async function readDeckSecrets(deps: RtSecretsDeps = {}): Promise<DeckSecretsResult> {
  const readApiToken = deps.readApiToken ?? defaultReadApiToken;
  const post = deps.post ?? defaultPost;

  let token: string;
  try {
    token = readApiToken();
  } catch {
    return { ok: false, message: DAEMON_DOWN_MESSAGE };
  }

  let res: RtSecretsResponse;
  try {
    res = await post({ token, scope: "deck" });
  } catch {
    return { ok: false, message: DAEMON_DOWN_MESSAGE };
  }

  if (!res.ok) {
    return {
      ok: false,
      message: `rt daemon refused the secrets request (${res.error ?? "unknown"}) — check ~/.mattstack/rt/api-token`,
    };
  }

  return { ok: true, cfApiToken: res.data?.cfApiToken, cfZoneId: res.data?.cfZoneId };
}
